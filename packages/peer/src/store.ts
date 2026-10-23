import { bytesToHex, sha256 } from './deps.ts';
import type { AttachmentBody, Cursor, SyncEntry } from './messages.ts';

/**
 * Everything the session needs from the database, and nothing it needs from Drizzle.
 *
 * AGENTS.md rule 5 keeps data access behind `src/data/repo`, and ADR-14 §2 puts this package
 * in the monorepo for two apps to share. Both point the same way: the session talks to this
 * interface, the pilot app implements it over the repositories, the clinic process implements
 * it over whatever it keeps, and the spike implements it in a Map.
 *
 * ## The cursor that does not exist
 *
 * The obvious design gives sync a cursor table: what we have received from each peer, updated
 * as batches land, consulted on resume. Writing it out made it disappear. Rows are streamed in
 * ULID order within one device's log, and ADR-02's merge inserts by ULID and never updates —
 * so `max(id) where device_id = ?` **is** the cursor, exactly, at all times, with no second
 * source of truth to fall out of step and nothing to rebuild after a crash. A session that
 * dies halfway through a batch resumes from the last row that actually landed, because that
 * is the only thing the number could mean.
 *
 * ADR-02 §Backup said a future sync layer would use the same merge semantic. It turns out to
 * get the resume for free as well.
 *
 * The exception is attachments, which are bytes rather than rows: a half-arrived file has no
 * ULID to be the high-water mark of, so `putAttachment` verifies the digest before it commits
 * and a partial one is simply re-fetched next session.
 */

/** What `PeerStore.applyRows` did with one batch. */
export interface RowApplyResult {
  /** Rows that were new and are now stored. */
  readonly inserted: number;
  /** Already present under the same id — the idempotent half of the merge. */
  readonly skipped: number;
  /** The ids that were new. A row that means something is acted on once, on the delivery that landed it. */
  readonly newIds: readonly string[];
}

/** The storage a sync session reads from and writes to; each app implements it over its own database. */
export interface PeerStore {
  /** Every device log this store holds, and how far it holds it. The resume state. */
  cursors(): Promise<readonly Cursor[]>;
  /** Rows from one device's log above `after`, in ULID order. */
  rowsSince(deviceId: string, after: string | null, limit: number): Promise<readonly SyncEntry[]>;
  /** Insert-if-new by ULID. Never updates: `entries` is append-only (AGENTS.md rule 3). */
  applyRows(rows: readonly SyncEntry[]): Promise<RowApplyResult>;
  /** Attachment metadata for rows being sent, so the receiver knows what bytes follow. */
  attachmentsFor(entryIds: readonly string[]): Promise<readonly AttachmentBody[]>;
  /** Whether the attachment with this lowercase SHA-256 hex digest is held. */
  hasAttachment(sha256Hex: string): Promise<boolean>;
  /** The bytes of the attachment with this lowercase SHA-256 hex digest, in chunks. */
  readAttachment(sha256Hex: string): AsyncIterable<Uint8Array>;
  /**
   * Commits only if the bytes hash to the name they arrived under.
   *
   * **An id already held is a success that touches nothing** (2026-10-16, the review of PR
   * #121). Re-delivery is part of the protocol, not an accident: `haveAttachments` is bounded,
   * and a sender re-sends what it cannot see listed. The app's store used to rewrite the file
   * under the existing name, fail the insert on the duplicate id, and then delete that file in its
   * cleanup, which destroyed the copy it already held.
   */
  putAttachment(meta: AttachmentBody, bytes: Uint8Array): Promise<boolean>;

  /**
   * Destroys rows this device did not author, at their author's request (ADR-16 §1).
   *
   * The only destructive operation in the package, and deliberately the only one: ADR-02 makes
   * `purge` the single way data leaves, and a revocation is that operation aimed at one peer's
   * rows. It is not a tombstone — a tombstone would leave the reading on the disk and hide it
   * in the UI, which is not what a patient who asked for removal has asked for — and it takes
   * the attachments those rows referenced with them, because a lab report is the row's contents
   * rather than a separate thing the revocation forgot about.
   */
  removeRows(predicate: (row: SyncEntry) => boolean): Promise<{
    rows: number;
    attachments: number;
    /**
     * Attachment bytes the store could not remove after their rows went (ADR-17 §6, added
     * 2026-09-23). A file that will not delete is the ordinary way a holder ends up doing part
     * of what it was asked, and an erasure receipt has to say so rather than count it as done.
     * Absent means none.
     */
    attachmentsLeft?: number;
  }>;
  /** How many rows match, for reporting what a revocation left behind. */
  countRows(predicate: (row: SyncEntry) => boolean): Promise<number>;
}

/** The spike's store: the same semantics, in Maps, so the session can be tested without a DB. */
export function createMemoryStore(rows: readonly SyncEntry[] = []): PeerStore & {
  readonly rows: Map<string, SyncEntry>;
  readonly blobs: Map<string, Uint8Array>;
  readonly meta: Map<string, AttachmentBody>;
} {
  const store = new Map<string, SyncEntry>();
  const blobs = new Map<string, Uint8Array>();
  const meta = new Map<string, AttachmentBody>();
  for (const row of rows) store.set(row.id, row);

  const byDevice = (deviceId: string) =>
    [...store.values()]
      .filter((row) => row.deviceId === deviceId)
      .sort((a, b) => (a.id < b.id ? -1 : 1));

  return {
    rows: store,
    blobs,
    meta,
    async cursors() {
      const highest = new Map<string, string>();
      for (const row of store.values()) {
        const current = highest.get(row.deviceId);
        if (current === undefined || row.id > current) highest.set(row.deviceId, row.id);
      }
      return [...highest].map(([deviceId, lastUlid]) => ({ deviceId, lastUlid }));
    },
    async rowsSince(deviceId, after, limit) {
      return byDevice(deviceId)
        .filter((row) => after === null || row.id > after)
        .slice(0, limit);
    },
    async applyRows(incoming) {
      let skipped = 0;
      const newIds: string[] = [];
      for (const row of incoming) {
        if (store.has(row.id)) skipped += 1;
        else {
          store.set(row.id, row);
          newIds.push(row.id);
        }
      }
      return { inserted: newIds.length, skipped, newIds };
    },
    async attachmentsFor(entryIds) {
      const wanted = new Set(entryIds);
      return [...meta.values()].filter((item) => wanted.has(item.entryId));
    },
    async hasAttachment(digest) {
      return blobs.has(digest);
    },
    async *readAttachment(digest) {
      const bytes = blobs.get(digest);
      if (bytes === undefined) return;
      for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
        yield bytes.subarray(offset, Math.min(offset + 64 * 1024, bytes.length));
      }
    },
    async countRows(predicate) {
      return [...store.values()].filter(predicate).length;
    },
    async removeRows(predicate) {
      const doomed = [...store.values()].filter(predicate);
      let attachments = 0;
      for (const row of doomed) {
        store.delete(row.id);
        for (const [id, item] of [...meta.entries()]) {
          if (item.entryId !== row.id) continue;
          meta.delete(id);
          // The bytes go too, and only when nothing else points at them.
          const stillReferenced = [...meta.values()].some((other) => other.sha256 === item.sha256);
          if (!stillReferenced) blobs.delete(item.sha256);
          attachments += 1;
        }
      }
      return { rows: doomed.length, attachments };
    },
    async putAttachment(item, bytes) {
      // The name is the digest, so a truncated or tampered file cannot be committed under it.
      if (bytes.length !== item.byteSize) return false;
      if (bytesToHex(sha256(bytes)) !== item.sha256) return false;
      if (meta.has(item.id)) return true;
      blobs.set(item.sha256, bytes);
      meta.set(item.id, item);
      return true;
    },
  };
}
