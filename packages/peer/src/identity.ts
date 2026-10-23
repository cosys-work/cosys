import { concatBytes, ed25519, hkdfSha256, sha256, utf8, x25519 } from './deps.ts';

/**
 * Who a device is, and how two of them agree on a key without either becoming a new secret.
 *
 * ADR-14 §2, first bullet: *"Identity is ours. The transport's key is derived from, or
 * certified by, the ADR-03 Ed25519 identity. A transport keypair never becomes a second root
 * secret."* That sentence has two halves and this module is both of them.
 *
 * **Derived** is the iroh case. An iroh endpoint id *is* an Ed25519 public key, so the
 * device's identity can be the endpoint — no second key exists to leak. Where a distinct
 * endpoint key is wanted (so that a rotation does not change who the patient is),
 * `deriveTransportSeed` produces one deterministically from the identity: the same phone
 * derives the same endpoint after a reinstall from backup, and losing the endpoint key loses
 * nothing the identity did not already hold.
 *
 * **Certified** is the Holepunch case. Hyperswarm and Hypercore mint their own keypairs and
 * will not accept ours, so the identity signs a statement naming the transport key; a peer
 * that dials that key checks the certificate before it believes the device is who it claims.
 *
 * The session key is neither. It is a fresh X25519 exchange per session, signed by the
 * identities, so a recording of yesterday's sync does not open with today's key and the
 * identity secret never touches the cipher.
 */

/** A device's identity: its per-install id and its Ed25519 keypair. */
export interface DeviceIdentity {
  /** ADR-02 §3's per-install id, carried on every row. Not secret, not a key. */
  readonly deviceId: string;
  /** The Ed25519 public key, 32 bytes. */
  readonly publicKey: Uint8Array;
  /** The Ed25519 seed, 32 bytes. Secret. */
  readonly secretKey: Uint8Array;
}

const HELLO_CONTEXT = utf8('tapp-peer/hello/v1');
const TRANSPORT_CONTEXT = utf8('tapp-peer/transport-cert/v1');
const TRANSPORT_SEED_INFO = utf8('tapp-peer/transport-seed/v1');
const SESSION_INFO = 'tapp-peer/session/v1';

export const PUBLIC_KEY_BYTES = 32;
export const SIGNATURE_BYTES = 64;
export const SESSION_KEY_BYTES = 32;

/** The identity a 32-byte Ed25519 seed gives. Throws `TypeError` for a seed of any other length. */
export function identityFromSeed(deviceId: string, seed: Uint8Array): DeviceIdentity {
  if (seed.length !== 32) throw new TypeError('an identity seed is 32 bytes');
  return { deviceId, publicKey: ed25519.getPublicKey(seed), secretKey: seed };
}

/**
 * A transport keypair's seed, derived from the identity.
 *
 * `label` separates one transport from another, so that the iroh endpoint key and a future
 * Hypercore key are different keys with the same root — a transport that is compromised does
 * not hand over the other.
 */
export function deriveTransportSeed(identity: DeviceIdentity, label: string): Uint8Array {
  return hkdfSha256(identity.secretKey, TRANSPORT_SEED_INFO, utf8(label), 32);
}

/** The identity's statement that a transport key is one of its own. */
export function certifyTransportKey(
  identity: DeviceIdentity,
  transportKey: Uint8Array,
): Uint8Array {
  return ed25519.sign(concatBytes([TRANSPORT_CONTEXT, transportKey]), identity.secretKey);
}

/**
 * Whether `certificate` is the identity's statement (`certifyTransportKey`) that `transportKey` is
 * its own. False for anything malformed; never throws.
 */
export function verifyTransportCertificate(
  identityKey: Uint8Array,
  transportKey: Uint8Array,
  certificate: Uint8Array,
): boolean {
  if (certificate.length !== SIGNATURE_BYTES) return false;
  try {
    return ed25519.verify(certificate, concatBytes([TRANSPORT_CONTEXT, transportKey]), identityKey);
  } catch {
    return false;
  }
}

/** One side's half of the handshake, before it is encoded. */
export interface HandshakeHalf {
  /** The sender's Ed25519 identity key, 32 bytes. */
  readonly identityKey: Uint8Array;
  /** The sender's fresh X25519 public key for this session, 32 bytes. */
  readonly ephemeralKey: Uint8Array;
  /** The random bytes the sender's sealed chunks take their nonces from. */
  readonly nonceBase: Uint8Array;
  /** The identity's Ed25519 signature (`signHello`) over the session id, ephemeral key and nonce base. */
  readonly signature: Uint8Array;
}

/** What the signature covers: the ephemeral key and the nonce base, bound to this session. */
function helloTranscript(
  sessionId: string,
  ephemeralKey: Uint8Array,
  nonceBase: Uint8Array,
): Uint8Array {
  return concatBytes([HELLO_CONTEXT, utf8(sessionId), ephemeralKey, nonceBase]);
}

/** Signs one side's hello: its ephemeral key and nonce base, bound to `sessionId`. */
export function signHello(
  identity: DeviceIdentity,
  sessionId: string,
  ephemeralKey: Uint8Array,
  nonceBase: Uint8Array,
): Uint8Array {
  return ed25519.sign(helloTranscript(sessionId, ephemeralKey, nonceBase), identity.secretKey);
}

/**
 * Whether a received hello is signed by the identity key it carries, for this `sessionId`. False
 * for wrong key or signature lengths or a bad signature; never throws.
 */
export function verifyHello(sessionId: string, half: HandshakeHalf): boolean {
  if (half.identityKey.length !== PUBLIC_KEY_BYTES) return false;
  if (half.ephemeralKey.length !== PUBLIC_KEY_BYTES) return false;
  if (half.signature.length !== SIGNATURE_BYTES) return false;
  try {
    return ed25519.verify(
      half.signature,
      helloTranscript(sessionId, half.ephemeralKey, half.nonceBase),
      half.identityKey,
    );
  } catch {
    return false;
  }
}

/**
 * The two directional keys, from the exchange and the transcript.
 *
 * One key per direction, because `sealStream` numbers its chunks from zero and a nonce is
 * never reused under a key: two halves of one session sealing under the same key would
 * collide on chunk 0. The transcript hash is the salt, so the keys are bound to the exact
 * handshake bytes both sides saw — a mixed-and-matched pair of hellos derives different keys
 * and the first frame fails to open.
 */
export interface SessionKeys {
  /** Seals what this device sends. */
  readonly send: Uint8Array;
  /** Opens what the peer sends. */
  readonly receive: Uint8Array;
  /** The associated data for every sealed chunk in both directions. */
  readonly transcript: Uint8Array;
}

/**
 * Derives the session's two directional keys from this side's ephemeral X25519 secret, the peer's
 * ephemeral key and both encoded hellos. `isInitiator` picks which key is `send` and which is
 * `receive`, so the two sides get matching pairs.
 */
export function deriveSessionKeys(options: {
  readonly ephemeralSecret: Uint8Array;
  readonly peerEphemeralKey: Uint8Array;
  readonly initiatorHello: Uint8Array;
  readonly responderHello: Uint8Array;
  readonly isInitiator: boolean;
}): SessionKeys {
  const shared = x25519.getSharedSecret(options.ephemeralSecret, options.peerEphemeralKey);
  const transcript = sha256(concatBytes([options.initiatorHello, options.responderHello]));
  const key = (role: 'initiator' | 'responder') =>
    hkdfSha256(shared, transcript, utf8(`${SESSION_INFO}/${role}`), SESSION_KEY_BYTES);
  const initiator = key('initiator');
  const responder = key('responder');
  return options.isInitiator
    ? { send: initiator, receive: responder, transcript }
    : { send: responder, receive: initiator, transcript };
}
