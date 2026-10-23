import {
  concatBytes,
  createByteReader,
  hkdfSha256,
  randomBytes,
  sha256,
  utf8,
  x25519,
} from './deps.ts';
import {
  certifyTransportKey,
  deriveTransportSeed,
  signHello,
  verifyHello,
  verifyTransportCertificate,
  SESSION_KEY_BYTES,
  type DeviceIdentity,
} from './identity.ts';
import { ProtocolError, type Message } from './messages.ts';
import { encodeHandshake, frameHandshake, openMessages, readHandshake, sealMessages } from './wire.ts';

/**
 * The always-on node's half of the protocol — and the reason it needs one.
 *
 * ADR-14 §2 fixes the always-on node as "a design input, not an afterthought", and §Context is
 * blunt about why: a daughter in Pokhara and a patient in Kathmandu are rarely awake to the
 * same minute. The spike found the consequence the ADR had not drawn out. `session.ts` derives
 * its key from an **ephemeral exchange in both directions** — which is the right thing between
 * two live phones, and impossible against a peer who is not there. Store-and-forward cannot
 * use the session handshake at all: there is nobody to answer it.
 *
 * So there is a second mode, and it changes nothing above it. Each device derives a **static
 * X25519 mailbox key from its identity seed** and publishes it certified by the Ed25519
 * identity — §2's "derived from, or certified by", both clauses at once. A sender does an
 * ephemeral-to-static exchange against that key, seals exactly the same messages into exactly
 * the same container, and hands the blob to the mirror addressed to the recipient's public
 * key. The mirror holds bytes it cannot open; the recipient dials in whenever it next has
 * signal and opens them with a key it never sent anywhere.
 *
 * What is lost, and should be said plainly rather than discovered later: the live session has
 * forward secrecy and this does not. A mailbox blob that is captured today, and a mailbox key
 * compromised in a year, is a blob that can be read — where the same capture of a live session
 * is not, because both ephemeral keys are long gone. That is the price of the daughter in
 * Pokhara, it is paid only by what goes through the mirror, and rotating the mailbox key
 * (a new `label`, re-certified) is what bounds it.
 */

const MAILBOX_LABEL = 'mailbox/v1';
const MAILBOX_INFO = utf8('tapp-peer/mailbox/v1');

/**
 * A device's static X25519 mailbox key pair, with the identity's certificate over the public key.
 */
export interface MailboxKey {
  /** The X25519 public key senders seal to. */
  readonly publicKey: Uint8Array;
  /** The X25519 secret key that opens what was sealed to `publicKey`. It is never sent anywhere. */
  readonly secretKey: Uint8Array;
  /** The identity's signature over the public key. A peer checks this before sealing to it. */
  readonly certificate: Uint8Array;
}

/**
 * The device's mailbox key, deterministic in its identity seed.
 *
 * Deterministic on purpose: a phone restored from a `.tappbak` onto new hardware derives the
 * same mailbox key and can still open what the mirror was holding for it while it was gone —
 * which is the whole lost-device story ADR-02 §Backup exists for, extended one step.
 */
export function mailboxKey(identity: DeviceIdentity, label = MAILBOX_LABEL): MailboxKey {
  const secretKey = deriveTransportSeed(identity, label);
  const publicKey = x25519.getPublicKey(secretKey);
  return { secretKey, publicKey, certificate: certifyTransportKey(identity, publicKey) };
}

/** What a sender needs to know about a recipient it cannot talk to. */
export interface MailboxAddress {
  /** The recipient's Ed25519 identity key. */
  readonly identityKey: Uint8Array;
  /** The recipient's X25519 mailbox public key. */
  readonly mailboxKey: Uint8Array;
  /**
   * The identity's signature over `mailboxKey`. `sealForMailbox` throws when it does not verify.
   */
  readonly certificate: Uint8Array;
}

/** The address a sender seals to for this identity, from its default mailbox key. */
export function addressOf(identity: DeviceIdentity): MailboxAddress {
  const key = mailboxKey(identity);
  return {
    identityKey: identity.publicKey,
    mailboxKey: key.publicKey,
    certificate: key.certificate,
  };
}

const mailboxSessionKey = (shared: Uint8Array, helloBytes: Uint8Array, recipient: Uint8Array) =>
  hkdfSha256(shared, sha256(concatBytes([helloBytes, recipient])), MAILBOX_INFO, SESSION_KEY_BYTES);

/**
 * Seals messages for a peer who is not online, as one blob the mirror can hold.
 *
 * The blob is a session with one half: the same magic, the same handshake header, the same
 * chunk-sealed frames. A reader that can open a live session can open this, which is what
 * keeps `wire.ts` from growing a second format (ADR-03 §Revisit).
 */
export async function* sealForMailbox(
  identity: DeviceIdentity,
  to: MailboxAddress,
  messages: AsyncIterable<Message>,
  sessionId: string,
): AsyncIterable<Uint8Array> {
  if (!verifyTransportCertificate(to.identityKey, to.mailboxKey, to.certificate)) {
    throw new ProtocolError('that mailbox key is not certified by that identity');
  }
  // Seeded from the app's CSPRNG (`expo-crypto`, via `deps.ts`). Unseeded, `@noble` reaches for
  // `globalThis.crypto`, which Hermes does not have: the first real sync on a Galaxy M16 threw
  // here while every Node test passed (2026-09-23).
  const ephemeral = x25519.keygen(randomBytes(32));
  const nonceBase = randomBytes(16);
  const helloBytes = encodeHandshake({
    sessionId,
    role: 'initiator',
    half: {
      identityKey: identity.publicKey,
      ephemeralKey: ephemeral.publicKey,
      nonceBase,
      signature: signHello(identity, sessionId, ephemeral.publicKey, nonceBase),
    },
  });

  const key = mailboxSessionKey(
    x25519.getSharedSecret(ephemeral.secretKey, to.mailboxKey),
    helloBytes,
    to.mailboxKey,
  );

  yield frameHandshake(helloBytes);
  yield* sealMessages(key, nonceBase, sha256(concatBytes([helloBytes, to.mailboxKey])), messages);
}

/** What `openFromMailbox` found in a blob: who sealed it, and the messages inside. */
export interface MailboxDelivery {
  /** The identity key the sender signed its handshake with. */
  readonly senderIdentityKey: Uint8Array;
  /**
   * The messages, opened as the iteration reads them. It throws at the end if the blob stopped
   * early.
   */
  readonly messages: AsyncIterable<Message>;
}

/** Opens a blob the mirror was holding. Throws if it was not sealed to this device. */
export async function openFromMailbox(
  identity: DeviceIdentity,
  blob: AsyncIterable<Uint8Array>,
): Promise<MailboxDelivery> {
  const reader = createByteReader(blob);
  const hello = await readHandshake(reader);
  if (!verifyHello(hello.sessionId, hello.half)) {
    throw new ProtocolError('the sender did not sign its own handshake');
  }
  const own = mailboxKey(identity);
  const key = mailboxSessionKey(
    x25519.getSharedSecret(own.secretKey, hello.half.ephemeralKey),
    hello.bytes,
    own.publicKey,
  );
  return {
    senderIdentityKey: hello.half.identityKey,
    messages: openMessages(
      key,
      hello.half.nonceBase,
      sha256(concatBytes([hello.bytes, own.publicKey])),
      reader.rest(),
    ),
  };
}

/**
 * The mailbox, as an interface: one recipient's queue, seen from one side of it.
 *
 * ADR-15 §2 replaced the spike's in-memory blind mirror, and finding 8 is why — that mirror
 * authorised nothing, so anything could deposit for anyone and anyone who knew a public key
 * could collect that key's mail before the real device did. The replacement is a CouchDB
 * database per recipient key with a deposit allowlist and role-scoped tokens, and the shape of
 * *this* interface follows from how those tokens work: a token is scoped to one database and
 * one role, so an object here is always one mailbox seen from one side. A sender holds one
 * pointed at the recipient with a `deposit` token; the recipient holds one pointed at itself
 * with a `collect` token. There is no object that can do both, because there is no token that
 * can.
 *
 * **Purged after application, not on collection.** ADR-15 §3 says "purged on collection" and
 * the implementation is deliberately one step more careful: `collect` returns receipts, the
 * caller applies the frames to its own database, and only then calls `purgeCollected`. A phone
 * that dies between the two re-collects the same frames on the next drain, and the ULID merge
 * (ADR-14 finding 3) makes the second application a no-op. The other order loses mail to a
 * flat battery, which is the failure a patient would never see and never be able to report.
 */

/** What a purge needs to name a frame: CouchDB's document id and the revision collected. */
export interface MailboxReceipt {
  /** CouchDB's document id. */
  readonly id: string;
  /** The revision that was collected. */
  readonly rev: string;
}

/** One frame waiting in a mailbox, with the receipt that purges it. */
export interface MailboxItem {
  /** What `purgeCollected` takes to remove this frame. */
  readonly receipt: MailboxReceipt;
  /** The sealed blob, exactly as `sealForMailbox` produced it. */
  readonly blob: Uint8Array;
  /** The depositor's identity key, as the server recorded it for the allowlist check. */
  readonly from: string;
}

/**
 * One recipient's queue seen from one side: a depositor's or the owner's, as the token's role
 * allows.
 */
export interface Mailbox {
  /** Leaves one sealed blob for this mailbox's owner. Needs a `deposit`-scoped token. */
  deposit(blob: Uint8Array): Promise<void>;
  /** Everything waiting, oldest first. Needs a `collect`-scoped token. */
  collect(options?: { readonly limit?: number }): Promise<readonly MailboxItem[]>;
  /** Removes collected frames for good. Called *after* the frames have been applied. */
  purgeCollected(receipts: readonly MailboxReceipt[]): Promise<void>;
  /** Blocks until mail arrives or the timeout passes. Returns what it found. */
  waitForMail(options?: { readonly timeoutMs?: number }): Promise<readonly MailboxItem[]>;
}

/** A mailbox in a Map. Tests only — the real one authorises, and this cannot. */
export function createMemoryMailbox(): Mailbox & { readonly held: () => number } {
  const held = new Map<string, { blob: Uint8Array; from: string; rev: string }>();
  let counter = 0;

  return {
    held: () => held.size,
    async deposit(blob) {
      counter += 1;
      held.set(`frame-${counter}`, { blob, from: 'memory', rev: `1-${counter}` });
    },
    async collect(options) {
      const limit = options?.limit ?? Number.POSITIVE_INFINITY;
      return [...held.entries()]
        .slice(0, limit)
        .map(([id, item]) => ({
          receipt: { id, rev: item.rev },
          blob: item.blob,
          from: item.from,
        }));
    },
    async purgeCollected(receipts) {
      for (const receipt of receipts) held.delete(receipt.id);
    },
    async waitForMail() {
      return this.collect();
    },
  };
}
