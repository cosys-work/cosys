import { z } from 'zod';

/**
 * The six things one device says to another, and the shapes they arrive in.
 *
 * Every message here came off a socket. ADR-02's restore already treats a `.tappbak` as
 * untrusted input because "the AEAD proves nobody edited it after it was written; it proves
 * nothing about what wrote it" (AGENTS.md rule 7) — and a peer is strictly worse than a file,
 * because a file at least came from the patient. So the same discipline, one step stricter:
 * parse before use, count what does not parse, and never let a rejected row reach the
 * database.
 *
 * The list is short on purpose. ADR-14 §3 says the sync layer is a few hundred lines because
 * the merge is `restore` and the container is `.tappbak`; a protocol that needed negotiation,
 * capability discovery or a schema exchange would mean one of those two claims was false.
 */

/** A ULID, or `settings`' name key. Same bound the backup's row schemas use. */
const id = z.string().min(1).max(64);
const timestamp = z.string().min(1).max(40);

/**
 * The row as it travels, and the two facts about a correction that never do, are the
 * substrate's entry shape (`@cosys/record/row`, 2026-10-22): a modality's projections are written
 * against it, and a modality cannot import this package to reach it.
 */
export {
  LOCAL_ONLY_FIELDS,
  syncEntrySchema,
  toWireRow,
  type LocalCorrectionFacts,
  type SyncEntry,
} from './deps.ts';

/** Where one device's log has got to, as far as the sender knows. */
export const cursorSchema: z.ZodObject<
  { deviceId: z.ZodString; lastUlid: z.ZodNullable<z.ZodString> },
  z.core.$strip
> = z.object({
  deviceId: z.string().min(1).max(64),
  /** The highest ULID held from that device, or null for "nothing yet". */
  lastUlid: id.nullable(),
});

/** One device log's cursor, as `cursorSchema` parses it. */
export type Cursor = z.infer<typeof cursorSchema>;

/**
 * Five, not six.
 *
 * The protocol had an `ack` — "I have applied this log through here" — until `store.ts`'s
 * cursor turned out not to exist: the receiver's `max(id)` per device log *is* what an ack
 * would have carried, it is already durable, and it is already correct after a crash. A
 * message whose only job is to restate a number both sides can compute is a message that can
 * disagree with it. Recorded in ADR-14 §Outcome.
 */
export const MESSAGE_TYPE = {
  /** "Here is what I already have, per device log." Sent first, by both sides. */
  cursors: 1,
  /** A batch of entries from one device's log, in ULID order. */
  batch: 2,
  /** The metadata for one attachment; its bytes follow in `chunk` messages. */
  attachment: 3,
  /** Bytes of the attachment named by the preceding `attachment` message. */
  chunk: 4,
  /** "I have nothing further to send." Not a close: the other direction may still run. */
  done: 5,
} as const;

export type MessageType = (typeof MESSAGE_TYPE)[keyof typeof MESSAGE_TYPE];

export const cursorsBodySchema: z.ZodObject<
  {
    have: z.ZodArray<typeof cursorSchema>;
    wantAttachments: z.ZodBoolean;
    haveAttachments: z.ZodArray<z.ZodString>;
  },
  z.core.$strip
> = z.object({
  /** ADR-14 §3: a frame is prefixed by `(device_id, last_ulid)` so the receiver can ask. */
  have: z.array(cursorSchema).max(512),
  /** False when the peer's projection gives it no attachments at all (§2). */
  wantAttachments: z.boolean(),
  /**
   * Digests already held, so they are not sent twice.
   *
   * Bounded, and therefore advisory: a store with more attachments than this sends its most
   * recent, and the sender re-sends anything it cannot see listed. Re-sending bytes is waste;
   * a protocol that could be made to allocate without limit by a peer is a vulnerability.
   */
  haveAttachments: z.array(z.string().regex(/^[0-9a-f]{64}$/)).max(1024),
});

/**
 * A batch, whose rows are deliberately *not* parsed here.
 *
 * `restore` counts a row it cannot validate and skips it, because "a row that does not parse is
 * counted and skipped rather than inserted" (AGENTS.md rule 7, `backup/rows.ts`). A schema that
 * validated the whole array would instead throw on the first bad row and take the other 199
 * with it — one malformed row from a peer running a newer build would end the session rather
 * than cost one reading. So the envelope is checked here and each row is checked on its own in
 * `session.ts`, which is where the counting lives.
 */
/** The longest view name a batch may declare. Every name a grant can produce is well inside it. */
export const VIEW_NAME_MAX_LENGTH = 120;

export const batchBodySchema: z.ZodObject<
  {
    deviceId: z.ZodString;
    after: z.ZodNullable<z.ZodString>;
    rows: z.ZodArray<z.ZodUnknown>;
    view: z.ZodOptional<z.ZodString>;
  },
  z.core.$strip
> = z.object({
  deviceId: z.string().min(1).max(64),
  /** The cursor this batch continues from, so an out-of-order batch is detectable. */
  after: id.nullable(),
  rows: z.array(z.unknown()).max(512),
  /**
   * The view this batch was projected through — `grant:full`, `grant:glucose_band`, and so on.
   *
   * **Added 2026-09-22, because ADR-18 §6 asks a receiving device a question nothing had ever
   * answered.** §6 says an empty screen on a caregiver's phone must distinguish *not shared*
   * from *nothing here yet*, and that *"both are facts the app holds"*. The second is: she can
   * see what has arrived. The first was not, and could not be — a grant is a row on the
   * patient's own log and `TRAVELS` marks it as not travelling, correctly, so nothing ever told
   * her phone what she was entitled to. Before this, an empty Plan screen meant either "she
   * does not share her plan" or "she has not written one down", and the app could not tell
   * which.
   *
   * It is the view's **name**, not the grant: no peer, no period, no kinds list, and nothing
   * about anybody else. What a caregiver is told is the shape of her own window.
   *
   * Optional, so a sender on an older build is read rather than refused — in which case the
   * receiving screens fall back to what they did before, which is to say nothing about why a
   * screen is empty.
   *
   * *Bounded at `VIEW_NAME_MAX_LENGTH` since 2026-10-16* (the review of PR #121). It was 40, and
   * the grant schema accepts combinations that name more than that: the Band level with
   * close-watch on is `grant:glucose_band+medication_taken+close_watch`, 47 characters. A batch
   * that fails this schema ends the session's reader, so every session under such a grant was
   * interrupted and the peer received nothing. `grants.test.ts` checks every name a grant can
   * produce against the bound.
   */
  view: z.string().min(1).max(VIEW_NAME_MAX_LENGTH).optional(),
});

export const attachmentBodySchema: z.ZodObject<
  {
    id: z.ZodString;
    entryId: z.ZodString;
    mime: z.ZodString;
    sha256: z.ZodString;
    byteSize: z.ZodInt;
    createdAt: z.ZodString;
  },
  z.core.$strip
> = z.object({
  id,
  entryId: id,
  mime: z.string().min(1).max(120),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'expected a lowercase sha-256 hex digest'),
  byteSize: z
    .int()
    .min(0)
    .max(64 * 1024 * 1024),
  createdAt: timestamp,
});

export type CursorsBody = z.infer<typeof cursorsBodySchema>;
export type BatchBody = z.infer<typeof batchBodySchema>;
/** An `attachment` message's body, as `attachmentBodySchema` parses it. */
export type AttachmentBody = z.infer<typeof attachmentBodySchema>;

/** A decoded sync message: its `MESSAGE_TYPE` and its parsed body, or raw bytes for a `chunk`. */
export type Message =
  | { readonly type: typeof MESSAGE_TYPE.cursors; readonly body: CursorsBody }
  | { readonly type: typeof MESSAGE_TYPE.batch; readonly body: BatchBody }
  | { readonly type: typeof MESSAGE_TYPE.attachment; readonly body: AttachmentBody }
  | { readonly type: typeof MESSAGE_TYPE.chunk; readonly bytes: Uint8Array }
  | { readonly type: typeof MESSAGE_TYPE.done };

/**
 * The other side broke the sync protocol: a handshake or message that is malformed, unsigned or
 * out of place. The message says what was wrong.
 */
export class ProtocolError extends Error {
  /** A protocol error with `message` as its explanation. */
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}
