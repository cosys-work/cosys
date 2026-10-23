import { bytesToHex, ed25519, fromBase64, toBase64, utf8 } from './deps.ts';
import { verifyTransportCertificate, type DeviceIdentity } from './identity.ts';
/**
 * The directory: where a peer is, signed by the peer.
 *
 * ADR-15 §2 gives the directory one job and takes another away from it. It maps an identity to
 * its mailbox, its relay address and its certified mailbox key — and it **does not vouch for
 * anyone's public key**. Pairing is a QR plus a verification code (ADR-16), so a directory that
 * lied about a key would be caught by two people reading four words to each other, and a
 * directory that is compromised cannot insert itself into a conversation.
 *
 * That is why every record is signed by the identity it describes and verified here before a
 * single byte is sent anywhere it names. The server is trusted to *hold* records and to be
 * available; it is not trusted to have written them.
 *
 * The one thing a hostile directory can still do is withhold — return nothing, or return an old
 * record with a rotated key. It cannot read mail and cannot redirect it to a key it controls,
 * but it can make a peer unreachable. Availability is what ADR-15 §Context says these servers
 * are trusted for, and this is the shape of that trust when it is abused.
 */

export interface DirectoryRecord {
  /** The identity this record describes, lowercase hex. */
  readonly identity: string;
  /**
   * The mailbox prefix for this identity — `mbx-<hex>`. One mailbox hangs off it per
   * relationship (ADR-16 §2), so the full database name is this plus the depositor or the
   * allowed group, and a peer learns only the name of the one it is entitled to write to.
   */
  readonly mailbox: string;
  /** The static X25519 mailbox key (ADR-14 finding 4), base64. */
  readonly mailboxKey: string;
  /** The identity's signature over `mailboxKey`, base64 — `certifyTransportKey`. */
  readonly mailboxCertificate: string;
  /**
   * ~~iroh's `EndpointAddr` as the relay knows it, or null while the direct path is unbuilt.~~
   * *2026-09-23 (ADR-15 §9 step 3):* the iroh **endpoint id** alone, lowercase hex, or null when
   * this device cannot be dialled. Not the relay URL: every build dials through its own one relay,
   * and a relay named in somebody else's record would be a host this device could be steered to.
   * The id is derived from the identity (`irohEndpointId`) and is covered by this record's
   * signature, which is what ties the endpoint to the person.
   */
  readonly endpoint: string | null;
  /** Identity keys permitted to deposit, lowercase hex. The server enforces it; this declares it. */
  readonly deposits: readonly string[];
  /**
   * Groups the patient has explicitly allowed to share a mailbox, and so to see that each other
   * wrote (ADR-16 §2). Absent or empty is the default and the norm: one mailbox per
   * relationship, and no peer able to tell that another peer exists.
   *
   * It lives in the *signed* record because it is a consent decision. A server that could add a
   * member to a group could undo the default, and nothing it says here is believed unless the
   * patient's own signature covers it.
   */
  readonly groups?: Readonly<Record<string, readonly string[]>>;
  /**
   * A bridge's one-time intake (ADR-22 §4, decided 2026-10-22): the pairing codes it offered, as
   * their digests (`pairingCodeDigest`), and the group mailbox a code opens. Whoever presents one
   * of these codes is given one deposit token into that group, once, without being in `deposits`:
   * a bridge does not know a patient before the patient's first message. Absent on every record
   * but a bridge's, and then the record's bytes are what they were before it existed.
   */
  readonly intake?: DirectoryIntake;
  /** ISO 8601. A record older than the client's tolerance is refused as stale. */
  readonly updatedAt: string;
}

/** A bridge's one-time intake, as published in its directory record (see `DirectoryRecord.intake`). */
export interface DirectoryIntake {
  /** The group the intake deposits into; `groups` names it, with no members. */
  readonly group: string;
  /**
   * The codes on offer, each as its digest (`pairingCodeDigest`) and the time it stops being
   * accepted, a parseable date string.
   */
  readonly offers: readonly { readonly digest: string; readonly until: string }[];
}

/** The bytes a record's signature covers: the record, canonically, without the signature. */
function recordBytes(record: DirectoryRecord): Uint8Array {
  return utf8(
    JSON.stringify({
      identity: record.identity,
      mailbox: record.mailbox,
      mailboxKey: record.mailboxKey,
      mailboxCertificate: record.mailboxCertificate,
      endpoint: record.endpoint,
      deposits: [...record.deposits].sort(),
      groups: Object.fromEntries(
        Object.entries(record.groups ?? {})
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([id, members]) => [id, [...members].sort()]),
      ),
      ...(record.intake === undefined
        ? {}
        : {
            intake: {
              group: record.intake.group,
              offers: [...record.intake.offers]
                .sort((a, b) => (a.digest < b.digest ? -1 : a.digest > b.digest ? 1 : 0))
                .map((offer) => ({ digest: offer.digest, until: offer.until })),
            },
          }),
      updatedAt: record.updatedAt,
    }),
  );
}

/** A directory record with its identity's signature over it. */
export interface SignedDirectoryRecord {
  /** The record the signature covers. */
  readonly record: DirectoryRecord;
  /** base64 Ed25519 over `recordBytes`. */
  readonly signature: string;
}

/**
 * Signs a record with the device's identity key. The `identity` and `mailbox` fields are filled in
 * from the key, so a device cannot sign a record naming another identity's mailbox.
 */
export function signDirectoryRecord(
  identity: DeviceIdentity,
  record: Omit<DirectoryRecord, 'identity' | 'mailbox'>,
): SignedDirectoryRecord {
  const full: DirectoryRecord = {
    ...record,
    identity: bytesToHex(identity.publicKey),
    mailbox: `mbx-${bytesToHex(identity.publicKey)}`,
  };
  return { record: full, signature: toBase64(ed25519.sign(recordBytes(full), identity.secretKey)) };
}

/**
 * Checks a record end to end before anything acts on it.
 *
 * Three things have to hold, and all three are about the same question — did the identity
 * itself say this? The signature must verify under the key the record claims to describe; the
 * mailbox name must be the one that key derives (so a record cannot point a sender at someone
 * else's database); and the mailbox key must carry the identity's own certificate, which is
 * what ADR-15 §2 means by "certified mailbox key".
 */
export function verifyDirectoryRecord(signed: SignedDirectoryRecord): boolean {
  const { record, signature } = signed;
  if (!/^[0-9a-f]{64}$/.test(record.identity)) return false;
  if (record.mailbox !== `mbx-${record.identity}`) return false;

  let identityKey: Uint8Array;
  let mailboxKey: Uint8Array;
  let certificate: Uint8Array;
  let signatureBytes: Uint8Array;
  try {
    identityKey = Uint8Array.from(record.identity.match(/../g)!.map((b) => parseInt(b, 16)));
    mailboxKey = fromBase64(record.mailboxKey);
    certificate = fromBase64(record.mailboxCertificate);
    signatureBytes = fromBase64(signature);
  } catch {
    return false;
  }

  if (!verifyTransportCertificate(identityKey, mailboxKey, certificate)) return false;
  try {
    return ed25519.verify(signatureBytes, recordBytes(record), identityKey);
  } catch {
    return false;
  }
}

/** How `createDirectoryClient` reaches the directory server. */
export interface DirectoryClientOptions {
  /** The directory server's base URL; trailing slashes are dropped. */
  readonly server: string;
  /** The `fetch` to call. Defaults to the global one. */
  readonly fetch?: typeof globalThis.fetch;
  /** How long a lookup or a publish may take before it is aborted. Default 15 seconds. */
  readonly timeoutMs?: number;
  /** How old a record may be before it is refused. Default seven days. */
  readonly maxAgeMs?: number;
  /** The clock a record's age is measured against, in epoch milliseconds. Defaults to `Date.now`. */
  readonly now?: () => number;
}

/** A directory lookup or publish that failed, or a record that was refused; the message says which. */
export class DirectoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DirectoryError';
  }
}

/** What `createDirectoryClient` returns. Each method is described where it is implemented. */
export interface DirectoryClient {
  /**
   * Fetches the record for an identity key and returns it only once it verifies, describes that
   * identity and is no older than `maxAgeMs`. Rejects with `DirectoryError` otherwise, or when
   * the server has no record.
   */
  lookup(identityKey: Uint8Array): Promise<DirectoryRecord>;
  /**
   * Signs this device's record and stores it on the server, resolving to what was stored.
   * Rejects with `DirectoryError` when the server refuses it.
   */
  publish(
    identity: DeviceIdentity,
    record: Omit<DirectoryRecord, 'identity' | 'mailbox'>,
  ): Promise<SignedDirectoryRecord>;
}

/** A client for the directory server: looks peers' records up and publishes this device's own. */
export function createDirectoryClient(options: DirectoryClientOptions): DirectoryClient {
  const server = options.server.replace(/\/+$/, '');
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxAgeMs = options.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000;
  const now = options.now ?? (() => Date.now());

  return {
    /** Looks a peer up and refuses anything it cannot verify. Never returns a bad record. */
    async lookup(identityKey: Uint8Array): Promise<DirectoryRecord> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let payload: unknown;
      try {
        const response = await doFetch(`${server}/directory/${bytesToHex(identityKey)}`, {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });
        if (!response.ok) throw new DirectoryError('the directory has no record for that peer');
        payload = await response.json();
      } finally {
        clearTimeout(timer);
      }

      const signed = payload as SignedDirectoryRecord;
      if (typeof signed?.signature !== 'string' || typeof signed?.record !== 'object') {
        throw new DirectoryError('the directory returned something that is not a record');
      }
      if (signed.record.identity !== bytesToHex(identityKey)) {
        throw new DirectoryError('the directory answered about a different peer');
      }
      if (!verifyDirectoryRecord(signed)) {
        throw new DirectoryError('that record is not signed by the identity it describes');
      }
      // A stale record is how a withholding directory pins a peer to a rotated key.
      const age = now() - Date.parse(signed.record.updatedAt);
      if (!Number.isFinite(age) || age > maxAgeMs) {
        throw new DirectoryError('that record is too old to act on');
      }
      return signed.record;
    },

    /** Publishes this device's own record. The server stores what it cannot forge. */
    async publish(identity: DeviceIdentity, record: Omit<DirectoryRecord, 'identity' | 'mailbox'>) {
      const signed = signDirectoryRecord(identity, record);
      // The same deadline as `lookup`. Without one, a PUT whose connection died mid-request (a
      // relay or service restart, `adb reverse` dropping on a USB blip) waited until the OS gave
      // up, 52 minutes on the Galaxy M16, and every sync run queued behind it (sitting 4,
      // 2026-10-08). A publish is the first network call of a run, so its stall was the run's.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await doFetch(`${server}/directory/${bytesToHex(identity.publicKey)}`, {
          method: 'PUT',
          signal: controller.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(signed),
        });
        if (!response.ok) throw new DirectoryError('the directory would not take the record');
        return signed;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
