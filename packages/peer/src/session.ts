import {
  concatBytes,
  createByteReader,
  randomBytes,
  STREAM_CHUNK_BYTES,
  ulid,
  x25519,
} from './deps.ts';
import {
  deriveSessionKeys,
  verifyHello,
  signHello,
  type DeviceIdentity,
  type HandshakeHalf,
} from './identity.ts';
import {
  MESSAGE_TYPE,
  ProtocolError,
  syncEntrySchema,
  type AttachmentBody,
  type Cursor,
  type Message,
  type SyncEntry,
} from './messages.ts';
import { projectsItself, type RowView } from './deps.ts';
import { honourRevocations } from './revocation.ts';
import type { PeerStore } from './store.ts';
import { PeerStreamError, type ConnectionPath, type PeerStream } from './transport.ts';
import {
  encodeHandshake,
  frameHandshake,
  MAX_BATCH_BYTES,
  openMessages,
  readHandshake,
  sealMessages,
  wireRowBytes,
} from './wire.ts';

/**
 * One sync, end to end: greet, say how far you have got, send what the other side lacks.
 *
 * The shape is the one ADR-14 §3 predicted — *"the sync layer can be a few hundred lines on
 * either transport"* — and the reason it stays that size is that three hard problems were
 * already solved elsewhere and are not re-solved here:
 *
 * - **Conflicts** do not exist. ADR-02 §Backup: "two rows with the same ULID are the same row,
 *   and a ULID is not guessed twice." There is no merge function in this file.
 * - **Resume** is not state. `store.ts` explains why the cursor is `max(id)` per device log
 *   and therefore cannot drift; an interrupted session needs no repair, only a redial.
 * - **The container** is `.tappbak`'s (`wire.ts`), so authentication, chunking and truncation
 *   detection arrive already written and already tested.
 *
 * What is left is a handshake, two pumps and a projection — and the pumps are symmetric, so a
 * session does not have a client and a server, only an initiator who spoke first.
 */

/** Rows per read. `PAGE_ROWS` in the backup, and the same reasoning: a page is not a load. */
const BATCH_ROWS = 200;

/**
 * How long a session may go with nothing sent and nothing received before it is called
 * interrupted. A dropped connection already ends a session; a *silent* one did not. QUIC's
 * keepalives hold a connection open while both endpoints are alive, so a peer that accepted and
 * then stopped answering held the session, and with it the whole sync run, for as long as it
 * stayed silent: 52 minutes and longer on the Galaxy M16 in sitting 4 (2026-10-08). Idle, not
 * total, so a photograph that takes a while on a slow link is never cut short while its chunks
 * keep coming.
 */
export const SESSION_IDLE_MS = 60_000;

/**
 * Bytes per attachment message.
 *
 * A message is a sealed chunk and a chunk is at most 64 KiB (`wire.ts`), so this is half the
 * ceiling rather than all of it: a phone that is also holding a Tier 1 model has better uses
 * for the other half (ADR-05 §G).
 */
const ATTACHMENT_CHUNK_BYTES = 32 * 1024;

/** `cursorsBodySchema.haveAttachments` refuses more than this, so no more is ever sent. */
const MAX_HAVE_ATTACHMENTS = 1024;

/**
 * What `runSession` needs: this device's identity and store, what it will tell this peer, and which
 * side speaks first.
 */
export interface SessionOptions {
  /** This device's identity, which signs its half of the handshake. */
  readonly identity: DeviceIdentity;
  /** Where rows are read from to send and applied to as they arrive. */
  readonly store: PeerStore;
  /** What this device is willing to tell this peer (§2). Applied before sealing. */
  readonly view: RowView;
  /**
   * Whether this store is a record this device **authors in** (ADR-15 §4, ADR-18 §1, §7).
   *
   * ADR-15 §4: *"A device forwards only logs authored under its own identity … the daughter's
   * phone never re-shares what it received from her mother, under any view, so the patient's
   * projection is enforced by the patient's software and nobody else's."* §Rejected says the
   * spike's forward-everything behaviour is replaced by that invariant — and until 2026-09-21
   * nothing implemented it: `outgoing()` iterated every device log the store held, so a
   * daughter who held her mother's record and also paired with her brother would have sent her
   * mother's rows onward, projected under the brother's view rather than her mother's.
   *
   * **It is a boolean rather than a list of device ids**, and ADR-18 §1 is why. An account is a
   * database, so every log inside one is the same person's: on a `mine` account they are the
   * patient's own, including logs restored from an older phone under a different `device_id` —
   * which a list of ids would have broken, because ADR-15 §4 explicitly covers the restored
   * phone. On a `held` account none of them are, and there is nothing to send.
   *
   * **Required, with no default.** A default of `true` is the behaviour this replaces, waiting
   * for somebody to forget; a default of `false` is a patient whose sharing silently stopped.
   */
  readonly authors: boolean;
  /**
   * Whether this side speaks first. The initiator picks the session id and the responder takes the
   * one it is sent.
   */
  readonly isInitiator: boolean;
  /** Whether to ask for attachment bytes. A phone on a metered connection may not. */
  readonly wantAttachments?: boolean;
  /**
   * Digests this side already holds, so the peer does not send them again (`haveAttachments`).
   *
   * Added 2026-09-23 with the direct transport (ADR-15 §9 step 3). The field has been on the
   * wire since the spike and the session always sent it empty, which was harmless while every
   * attachment it could be sent was one for a row in the same session. It stops being harmless
   * with `offerAttachments` below: a photograph offered on every direct session to a peer who
   * already has it would be the whole file, every time. Advisory and bounded, as the schema says.
   */
  readonly heldAttachments?: readonly string[];
  /**
   * Attachments to send for rows the peer **already holds**, beyond those for rows sent now.
   *
   * The mailbox cannot carry a photograph (ADR-15 §9, *"a `full` grant's photographs wait for
   * step 3"*), so a row delivered by the mailbox reaches a caregiver without its bytes. When a
   * direct session later runs, the peer's cursor is already past that row and the session would
   * never select it again, so without this *waiting for step 3* would mean waiting for ever.
   * The caller decides which attachments these are and has already asked the view about each
   * row; the session sends them only when this view carries attachments at all, and skips any
   * digest the peer said it holds.
   */
  readonly offerAttachments?: readonly AttachmentBody[];
  /**
   * Whether an arriving row may land here at all, asked of each row after it parses and before
   * anything is written or acted on. A refused row is counted as rejected.
   *
   * Added 2026-09-23 for the direct transport, because ADR-17's erasure work found that where a
   * destructive row lands matters and only the app knows where that is: a `revoke` or an
   * `erasure_request` names device ids the *sender* chose, so on an account that authors they
   * would name the patient's own rows. `src/data/peer/sync.ts` refuses them there for the
   * mailbox, and hands the same rule in here so a live session cannot be the way round it.
   * Absent means every parsed row is admitted, which is what this package's own tests and the
   * loopback want.
   */
  readonly admit?: (row: SyncEntry) => boolean;
  /** The session id the initiator sends. Default a fresh ULID; a responder ignores it. */
  readonly sessionId?: string;
  /** Rows per read from the store. Default 200. */
  readonly batchRows?: number;
  /** The clock, in ms, that `timings` is measured on. Default `Date.now`. */
  readonly now?: () => number;
  /** Silence after which the session is interrupted. Default `SESSION_IDLE_MS`. */
  readonly idleMs?: number;
}

/**
 * What one session did: whether it finished, what crossed in each direction, and where each device
 * log stands.
 */
export interface SyncResult {
  /** `complete` means both sides said `done`; anything else is a dropped call, not a fault. */
  readonly status: 'complete' | 'interrupted';
  /** The identity key the peer signed its handshake with. */
  readonly peerIdentityKey: Uint8Array | null;
  /** How the connection ran, as the stream reported it when the session ended. */
  readonly path: ConnectionPath;
  /** Rows and attachments this side sent, and the sealed bytes it wrote after the handshake. */
  readonly sent: { readonly rows: number; readonly attachments: number; readonly bytes: number };
  /**
   * What arrived: rows in batches; of those, how many were inserted, already held (`skipped`) or
   * refused (`rejected`, which also counts attachments not stored); attachments stored, and their
   * chunk bytes.
   */
  readonly received: {
    readonly rows: number;
    readonly inserted: number;
    readonly skipped: number;
    readonly rejected: number;
    readonly attachments: number;
    readonly bytes: number;
    /** Rows this session destroyed because a peer revoked them (ADR-16 §1). */
    readonly revoked: number;
  };
  /** Where each device log stands once the session ends. ADR-14 §Owed measurements. */
  readonly cursors: readonly Cursor[];
  /**
   * What the peer said it held when the session began, per device log; empty if it never said.
   *
   * The receiver's `max(id)` is durable and crash-correct (finding 3), so this is a floor the
   * sender may move its own store-and-forward cursor up to: every row at or below it is a row
   * the peer already has, whichever transport carried it.
   */
  readonly peerHave: readonly Cursor[];
  /**
   * How far this side's send loop read each device log, dropped rows included; empty unless the
   * session completed.
   *
   * The direct-path counterpart of the mailbox's *"the cursor moves only after the server took
   * the frame"*: every row up to here was either sealed onto a stream both sides then finished,
   * or dropped by the view. It is not proof the peer applied them (a phone that dies between
   * reading and writing loses them), and the next direct session repairs that from the peer's own
   * cursor, which is the same repair the mailbox relies on.
   */
  readonly sentThrough: readonly Cursor[];
  /** The view name the peer's batches declared (ADR-18 §6), or null if none did. */
  readonly peerView: string | null;
  /** How long the session took, in ms from when it started. */
  readonly timings: {
    /** Dial answered to both handshakes verified — "pairing to first byte", the app's half. */
    readonly handshakeMs: number;
    readonly firstMessageMs: number | null;
    readonly totalMs: number;
  };
  /** Why an interrupted session stopped. Never key material (ADR-03 rule 8). */
  readonly reason?: string;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // A rejection that nobody has awaited yet is not an unhandled rejection here: the sending
  // pump always awaits it, and Node only complains if the turn ends with no handler attached.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

/**
 * Runs one session over an already-dialled stream.
 *
 * Never throws for a network reason. A peer that hangs up mid-attachment, a handshake that
 * never arrives, a tunnel — all of them return `status: 'interrupted'` with what did land,
 * because at this layer they are the same event and the recovery for all of them is to dial
 * again later. It still throws for a protocol or cryptographic failure, which is a different
 * thing entirely: a peer that cannot be authenticated is not a peer having a bad signal.
 */
export async function runSession(stream: PeerStream, options: SessionOptions): Promise<SyncResult> {
  const guard = quietGuard(stream, options.idleMs ?? SESSION_IDLE_MS);
  try {
    return await runGuarded(guard.stream, options);
  } finally {
    guard.stop();
  }
}

/**
 * The stream, with a deadline on silence. Every send and every received chunk re-arms it; when
 * it expires the pending send or read fails with `PeerStreamError`, which the session reports as
 * `interrupted` (or, during the handshake, throws to a caller that falls back to the mailbox),
 * and the stream is closed underneath it.
 */
function quietGuard(stream: PeerStream, idleMs: number): { stream: PeerStream; stop(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let fail: (error: PeerStreamError) => void = () => {};
  const tripped = new Promise<never>((_resolve, reject) => {
    fail = reject;
  });
  // Nobody may be waiting when it trips; the next race still observes the rejection.
  tripped.catch(() => {});
  let stopped = false;
  const arm = () => {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      fail(new PeerStreamError('the peer went quiet'));
      void stream.close().catch(() => {});
    }, idleMs);
  };
  const guarded = <T>(work: Promise<T>): Promise<T> => Promise.race([work, tripped]);

  arm();
  return {
    stream: {
      remoteKey: stream.remoteKey,
      path: () => stream.path(),
      async send(bytes) {
        arm();
        await guarded(stream.send(bytes));
        arm();
      },
      finish: () => guarded(stream.finish()),
      receive() {
        const inner = stream.receive()[Symbol.asyncIterator]();
        return {
          [Symbol.asyncIterator]() {
            return {
              async next() {
                const result = await guarded(inner.next());
                arm();
                return result;
              },
              async return() {
                return (await inner.return?.()) ?? { done: true as const, value: undefined };
              },
            };
          },
        };
      },
      close: () => stream.close(),
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

async function runGuarded(stream: PeerStream, options: SessionOptions): Promise<SyncResult> {
  const now = options.now ?? (() => Date.now());
  const started = now();
  const batchRows = options.batchRows ?? BATCH_ROWS;

  const sent = { rows: 0, attachments: 0, bytes: 0 };
  const received = {
    rows: 0,
    inserted: 0,
    skipped: 0,
    rejected: 0,
    attachments: 0,
    bytes: 0,
    revoked: 0,
  };
  let firstMessageMs: number | null = null;
  let reason: string | undefined;
  let peerSaidDone = false;
  let weSaidDone = false;

  let peerHave: readonly Cursor[] = [];
  let peerView: string | null = null;
  const readThrough = new Map<string, string>();

  const reader = createByteReader(stream.receive());

  // What this side told the peer it holds, exactly as sent, and what it committed during the
  // session. An attachment message for one of these digests arrives without bytes (below).
  const advertised = new Set(
    [...new Set(options.heldAttachments ?? [])].slice(0, MAX_HAVE_ATTACHMENTS),
  );
  const committed = new Set<string>();

  // Seeded from the app's CSPRNG (`expo-crypto`, via `deps.ts`). Unseeded, `@noble` reaches for
  // `globalThis.crypto`, which Hermes does not have: the first real sync on a Galaxy M16 threw
  // here while every Node test passed (2026-09-23).
  const ephemeral = x25519.keygen(randomBytes(32));
  const nonceBase = randomBytes(16);

  const mine = (sessionId: string): HandshakeHalf => ({
    identityKey: options.identity.publicKey,
    ephemeralKey: ephemeral.publicKey,
    nonceBase,
    signature: signHello(options.identity, sessionId, ephemeral.publicKey, nonceBase),
  });

  // The initiator names the session and speaks first; the responder answers under that name,
  // which is what binds the two halves into one transcript.
  let sessionId: string;
  let myHelloBytes: Uint8Array;
  let peer: Awaited<ReturnType<typeof readHandshake>>;

  if (options.isInitiator) {
    sessionId = options.sessionId ?? ulid();
    myHelloBytes = encodeHandshake({ sessionId, role: 'initiator', half: mine(sessionId) });
    await stream.send(frameHandshake(myHelloBytes));
    peer = await readHandshake(reader);
    if (peer.sessionId !== sessionId || peer.role !== 'responder') {
      throw new ProtocolError('the peer answered a different session');
    }
  } else {
    peer = await readHandshake(reader);
    if (peer.role !== 'initiator') throw new ProtocolError('both sides tried to initiate');
    sessionId = peer.sessionId;
    myHelloBytes = encodeHandshake({ sessionId, role: 'responder', half: mine(sessionId) });
    await stream.send(frameHandshake(myHelloBytes));
  }

  if (!verifyHello(sessionId, peer.half)) {
    throw new ProtocolError('the peer did not sign its own handshake');
  }
  // ADR-14 §2: identity is ours. The transport authenticated *a* key; this is the check that
  // it is the key the application knows the peer by, and not merely someone who can dial.
  if (
    stream.remoteKey.length === peer.half.identityKey.length &&
    !stream.remoteKey.every((byte, index) => peer.half.identityKey[index] === byte)
  ) {
    throw new ProtocolError('the peer signed with an identity the transport did not present');
  }

  const keys = deriveSessionKeys({
    ephemeralSecret: ephemeral.secretKey,
    peerEphemeralKey: peer.half.ephemeralKey,
    initiatorHello: options.isInitiator ? myHelloBytes : peer.bytes,
    responderHello: options.isInitiator ? peer.bytes : myHelloBytes,
    isInitiator: options.isInitiator,
  });
  const handshakeMs = now() - started;

  const peerCursors = deferred<{
    have: readonly Cursor[];
    wantAttachments: boolean;
    haveAttachments: readonly string[];
  }>();

  /** What we will say, in order. Blocks once on the peer's cursors, then streams. */
  async function* outgoing(): AsyncIterable<Message> {
    yield {
      type: MESSAGE_TYPE.cursors,
      body: {
        have: [...(await options.store.cursors())],
        wantAttachments: options.wantAttachments ?? true,
        haveAttachments: [...advertised],
      },
    };

    const want = await peerCursors.promise;
    const wantedFrom = new Map(want.have.map((cursor) => [cursor.deviceId, cursor.lastUlid]));
    const sentIds: string[] = [];
    let batches = 0;

    // ADR-15 §4's forwarding invariant, and the only place it can be enforced: a projection
    // narrows a row, and nothing narrows a row that should not have been selected at all.
    for (const cursor of options.authors ? await options.store.cursors() : []) {
      let after = wantedFrom.get(cursor.deviceId) ?? null;
      for (;;) {
        const rows = await options.store.rowsSince(cursor.deviceId, after, batchRows);
        if (rows.length === 0) break;
        const batchStart = after;
        after = rows[rows.length - 1]!.id;
        readThrough.set(cursor.deviceId, after);

        // The projection happens here, before anything is sealed, and it is the only place a
        // row can be narrowed. There is no path from `store` to `stream` that misses it.
        const projected: SyncEntry[] = [];
        for (const row of rows) {
          const shown = options.view.project(row);
          if (shown === null) continue;
          projected.push(shown);
          // A row's attachments follow it only when it travels as itself: a retraction under a
          // correction's id is news about the correction, and its photographs stay here.
          if (projectsItself(options.view, row)) sentIds.push(row.id);
        }

        // A batch is one sealed chunk, so it is filled by bytes rather than by row count: a
        // hundred notes and a hundred readings are not the same size, and the row count that
        // fits one would overflow the other.
        let held: SyncEntry[] = [];
        let heldBytes = 0;
        let heldAfter = batchStart;

        const flush = (): Message | null => {
          if (held.length === 0) return null;
          const message: Message = {
            type: MESSAGE_TYPE.batch,
            // The view's name travels with the rows, as it does in a mailbox deposit, so the
            // receiving screens can tell "not shared" from "nothing yet" (ADR-18 §6).
            body: {
              deviceId: cursor.deviceId,
              after: heldAfter,
              rows: held,
              view: options.view.name,
            },
          };
          heldAfter = held[held.length - 1]!.id;
          sent.rows += held.length;
          batches += 1;
          held = [];
          heldBytes = 0;
          return message;
        };

        for (const row of projected) {
          const size = wireRowBytes(row);
          if (held.length > 0 && heldBytes + size > MAX_BATCH_BYTES) {
            const message = flush();
            if (message !== null) yield message;
          }
          held.push(row);
          heldBytes += size;
        }
        const last = flush();
        if (last !== null) yield last;
        if (rows.length < batchRows) break;
      }
    }

    // **One empty batch to say what the window is**, when nothing else would (ADR-18 §6). The
    // mailbox does this on its first deposit; a live session is cheap enough to do it every
    // time, and a receiver that already knows is told the same fact again.
    if (options.authors && batches === 0) {
      yield {
        type: MESSAGE_TYPE.batch,
        body: {
          deviceId: options.identity.deviceId,
          after: null,
          rows: [],
          view: options.view.name,
        },
      };
    }

    if (options.view.attachments && want.wantAttachments) {
      const held = new Set(want.haveAttachments);
      const offered = options.authors ? (options.offerAttachments ?? []) : [];
      const queued = new Set<string>();
      const announced = new Set<string>();
      for (const item of [...(await options.store.attachmentsFor(sentIds)), ...offered]) {
        if (announced.has(item.id)) continue;
        announced.add(item.id);
        // **The digest names the bytes, not the attachment** (2026-10-16, the review of PR #121).
        // Two entries can carry the same file, and skipping the second because its bytes were
        // already there dropped its metadata too, so the peer never learned the entry had a file.
        // The metadata always goes; the bytes go once, and not at all to a peer that holds them.
        // The receiver reads the same two sets, so it knows when no bytes will follow.
        yield { type: MESSAGE_TYPE.attachment, body: item };
        if (held.has(item.sha256) || queued.has(item.sha256)) continue;
        queued.add(item.sha256);
        for await (const chunk of options.store.readAttachment(item.sha256)) {
          // Re-cut whatever the store hands back: a store is free to read a file in the size
          // that suits its disk, and the wire's size is not its business.
          for (let offset = 0; offset < chunk.length; offset += ATTACHMENT_CHUNK_BYTES) {
            yield {
              type: MESSAGE_TYPE.chunk,
              bytes: chunk.subarray(
                offset,
                Math.min(offset + ATTACHMENT_CHUNK_BYTES, chunk.length),
              ),
            };
          }
        }
        sent.attachments += 1;
      }
    }

    weSaidDone = true;
    yield { type: MESSAGE_TYPE.done };
  }

  async function send(): Promise<void> {
    for await (const frame of sealMessages(keys.send, nonceBase, keys.transcript, outgoing())) {
      sent.bytes += frame.length;
      await stream.send(frame);
    }
    // See `transport.ts`. The container's reader ends by checking that nothing follows the
    // final chunk, and only a half-close can answer that. Without this line both phones sit
    // holding the line, each having said everything it had to say.
    await stream.finish();
  }

  /**
   * An attachment whose bytes this store already holds under another attachment, filed under
   * its own id. Through `putAttachment`, so the digest is checked again and an id already held
   * is the no-op the store's contract makes it.
   */
  async function linkHeld(meta: AttachmentBody): Promise<boolean> {
    if (!(await options.store.hasAttachment(meta.sha256))) return false;
    const parts: Uint8Array[] = [];
    for await (const part of options.store.readAttachment(meta.sha256)) parts.push(part);
    return options.store.putAttachment(meta, concatBytes(parts));
  }

  /** An attachment being assembled. Nothing is committed until the digest matches. */
  let pending: { meta: AttachmentBody; parts: Uint8Array[]; length: number } | null = null;

  async function receive(): Promise<void> {
    for await (const message of openMessages(
      keys.receive,
      peer.half.nonceBase,
      keys.transcript,
      reader.rest(),
    )) {
      firstMessageMs ??= now() - started;

      switch (message.type) {
        case MESSAGE_TYPE.cursors:
          peerHave = message.body.have;
          peerCursors.resolve({
            have: message.body.have,
            wantAttachments: message.body.wantAttachments,
            haveAttachments: message.body.haveAttachments,
          });
          break;

        case MESSAGE_TYPE.batch: {
          if (message.body.view !== undefined) peerView = message.body.view;
          received.rows += message.body.rows.length;
          // Row by row, and a row that does not parse costs one row. See `batchBodySchema`.
          const rows: SyncEntry[] = [];
          for (const row of message.body.rows) {
            const parsed = syncEntrySchema.safeParse(row);
            if (!parsed.success) received.rejected += 1;
            // Parsed is not the same as admitted: see `SessionOptions.admit`.
            else if (options.admit !== undefined && !options.admit(parsed.data))
              received.rejected += 1;
            else rows.push(parsed.data);
          }
          const result = await options.store.applyRows(rows);
          received.inserted += result.inserted;
          received.skipped += result.skipped;

          // A revocation is an ordinary row that happens to mean something. It is applied after
          // it has landed, **on every delivery**, not only the one that first inserted it
          // (2026-10-16, the review of PR #121): a session that died between the two left the
          // row stored and the removal undone, and acting only on new rows meant it stayed
          // undone. Applying it again removes nothing the first application removed, because a
          // revocation covers only rows written before it (`applyRevocation`).
          const revocations = rows.filter((row) => row.kind === 'revoke');
          if (revocations.length > 0) {
            const report = await honourRevocations(options.store, revocations, {
              holderDeviceId: options.identity.deviceId,
            });
            received.revoked += report.removed;
          }
          break;
        }

        case MESSAGE_TYPE.attachment: {
          const meta = message.body;
          // No bytes follow for a digest this side said it holds, or already took this session:
          // the attachment is a second name for bytes that are here (see the send loop).
          if (advertised.has(meta.sha256) || committed.has(meta.sha256)) {
            pending = null;
            const ok = await linkHeld(meta);
            if (ok) received.attachments += 1;
            else received.rejected += 1;
            break;
          }
          // An unfinished one is abandoned rather than committed short: its digest is its
          // name, and the next session will simply not see it in `haveAttachments`.
          pending = { meta, parts: [], length: 0 };
          break;
        }

        case MESSAGE_TYPE.chunk: {
          if (pending === null) throw new ProtocolError('attachment bytes with no attachment');
          received.bytes += message.bytes.length;
          pending.parts.push(message.bytes);
          pending.length += message.bytes.length;
          if (pending.length >= pending.meta.byteSize) {
            const ok = await options.store.putAttachment(pending.meta, concatBytes(pending.parts));
            if (ok) {
              received.attachments += 1;
              committed.add(pending.meta.sha256);
            } else received.rejected += 1;
            pending = null;
          }
          break;
        }

        case MESSAGE_TYPE.done:
          peerSaidDone = true;
          break;
      }
    }
  }

  // The send pump waits on the peer's cursors, which only the receive pump can deliver. When
  // receiving stops for any reason (the peer hung up, or went quiet past `idleMs`) the send pump
  // is released there and then; releasing it only after both settled was a deadlock whenever the
  // peer stopped before sending its cursors (sitting 4, 2026-10-08). A no-op once they arrived.
  const [sendOutcome, receiveOutcome] = await Promise.allSettled([
    send(),
    receive().finally(() =>
      peerCursors.reject(new PeerStreamError('the session ended before the peer sent its cursors')),
    ),
  ]);

  // A send that is still blocked on cursors the peer never sent has to be released, or the
  // session would hold the process open waiting for a phone that has already hung up.
  peerCursors.reject(new PeerStreamError('the session ended before the peer sent its cursors'));

  for (const outcome of [receiveOutcome, sendOutcome]) {
    if (outcome.status === 'rejected') {
      const error: unknown = outcome.reason;
      const name = error instanceof Error ? error.name : 'Error';
      // A protocol or crypto failure is not a dropped call and must not be reported as one.
      if (error instanceof ProtocolError || name === 'DecryptionError') throw error;
      reason ??= name;
    }
  }

  try {
    await stream.close();
  } catch {
    // Closing a stream that is already gone is the normal ending of an interrupted session.
  }

  const complete = peerSaidDone && weSaidDone && reason === undefined;

  return {
    status: complete ? 'complete' : 'interrupted',
    peerIdentityKey: peer.half.identityKey,
    path: stream.path(),
    sent,
    received,
    cursors: await options.store.cursors(),
    peerHave,
    sentThrough: complete
      ? [...readThrough].map(([deviceId, lastUlid]) => ({ deviceId, lastUlid }))
      : [],
    peerView,
    timings: { handshakeMs, firstMessageMs, totalMs: now() - started },
    ...(complete ? {} : { reason: reason ?? 'the peer stopped before saying it was done' }),
  };
}

/** Exported for the harness: the container's chunk size, which bounds a send's memory. */
export const SESSION_CHUNK_BYTES = STREAM_CHUNK_BYTES;
