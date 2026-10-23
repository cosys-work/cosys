/**
 * X25519 and HKDF-SHA-256, behind the ADR-03 seam.
 *
 * The app does not use these itself. They are here because `packages/peer` does, and ADR-15 §8
 * said its one-file `@noble` exemption in `deps.ts` would end when the package shipped, with
 * these imports moving into `src/lib/crypto`. The package ships in 1.0 (ADR-11 §The peer network,
 * 2026-09-19), so the exemption ended on 2026-09-24 and ADR-03 rule 1 holds without exception:
 * `src/lib/crypto` is the only directory in the repository that imports `@noble`.
 *
 * Ed25519 is in `./signing`, which telemetry already used. The functions here are the other
 * three primitives the peer protocol needs: mailbox sealing and the session handshake agree
 * X25519 keys and expand the shared secret with HKDF-SHA-256.
 *
 * @module
 */

import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

/** An X25519 key pair, 32 bytes each. */
export interface X25519KeyPair {
  /** The 32-byte secret key. */
  readonly secretKey: Uint8Array;
  /** The 32-byte public key, safe to send to the other side. */
  readonly publicKey: Uint8Array;
}

/**
 * An X25519 key pair from a 32-byte seed.
 *
 * **The seed is required.** Called without one, `@noble` draws from
 * `globalThis.crypto.getRandomValues`, which Hermes does not have. That is the crash
 * `packages/peer/src/entropy.test.ts` records from the M16 (2026-09-23). A caller passes
 * `randomBytes(32)` from this module, which is `expo-crypto` on a phone (ADR-03).
 */
export function x25519KeyPair(seed: Uint8Array): X25519KeyPair {
  const { secretKey, publicKey } = x25519.keygen(seed);
  return { secretKey, publicKey };
}

/** The X25519 public key for a secret key. */
export function x25519PublicKey(secretKey: Uint8Array): Uint8Array {
  return x25519.getPublicKey(secretKey);
}

/**
 * The X25519 shared secret between a secret key and the other side's public key.
 *
 * Throws on a low-order public key (an all-zero result), as `@noble` does. Callers that take a
 * key off the wire already treat a throw as a failed handshake.
 */
export function x25519SharedSecret(secretKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  return x25519.getSharedSecret(secretKey, publicKey);
}

/** HKDF (RFC 5869) over SHA-256: extract with `salt`, expand with `info` to `length` bytes. */
export function hkdfSha256(
  ikm: Uint8Array,
  salt: Uint8Array | undefined,
  info: Uint8Array | undefined,
  length: number,
): Uint8Array {
  return hkdf(sha256, ikm, salt, info, length);
}
