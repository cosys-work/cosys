import { CouchClient, type CouchClientOptions } from './client.ts';
import { bytesToHex, fromBase64, toBase64 } from '../deps.ts';
import type { Mailbox, MailboxItem, MailboxReceipt } from '../mailbox.ts';

/**
 * The mailbox, over CouchDB (ADR-15 §1, §2).
 *
 * One database per recipient key, one document per sealed frame — which is not a coincidence
 * but the shape ADR-14 finding 1 already forced on the wire format. The sealer had to be
 * changed to emit one flushed chunk per message so that an exchange whose first message is a
 * question could not deadlock; a message that is its own frame is also a message that is its
 * own document, so the mailbox transport reuses the framing with a document boundary standing
 * in for half-close.
 *
 * **The frame travels base64 in the document body.** A CouchDB document is JSON, and a sealed
 * frame is bytes; the alternative is an attachment per frame, which costs a second request on
 * a carrier where requests are the expensive part. The +33% is *only* paid on the mailbox path —
 * the direct transport sends the same frames as bytes.
 *
 * **A document is one deposit, and the bound is on the deposit** (corrected 2026-10-16, the
 * review of PR #121). This used to say a frame is bounded at 64 KiB by the container and the cap
 * below enforced that, but what is deposited is a whole sealed session: a handshake, a batch per
 * device log, and `done`. Nothing bounded the total, so an account with two logs' worth of
 * backlog built a deposit over the cap on every run and its cursor never moved. The cap is now
 * named for what it bounds (`MAX_DEPOSIT_BYTES`), and a depositor fills a deposit to it.
 */

/**
 * Whose mail this mailbox carries, besides the recipient's.
 *
 * ADR-16 §2: a mailbox is named for a **relationship**, not for a person, because CouchDB grants
 * read at the database level and a shared mailbox would let one peer see that another exists.
 * "My son can tell my daughter wrote to me" is not acceptable unless the patient has allowed it
 * — so by default a depositor is a member of one database and of nothing else, and a group that
 * the patient *has* allowed to see each other is the same mechanism with a wider membership.
 */
export type MailboxScope =
  | { readonly kind: 'peer'; readonly peerKey: Uint8Array }
  | { readonly kind: 'group'; readonly groupId: string };

/**
 * A mailbox database's name.
 *
 * ADR-15 §Spike verification: CouchDB database names match `^[a-z][a-z0-9_$()+/-]*$`, so there
 * is no uppercase and therefore no base64. A key is addressed in lowercase hex or not at all,
 * and a base64 name is refused by the server with a 400 rather than silently mangled. The pair
 * form is 133 characters, which CouchDB accepts (ADR-16 §Spike).
 */
export function mailboxDatabaseName(recipientKey: Uint8Array, scope: MailboxScope): string {
  const recipient = bytesToHex(recipientKey);
  if (scope.kind === 'group') {
    if (!/^[0-9a-f]{1,32}$/.test(scope.groupId)) {
      throw new TypeError('a group id is lowercase hex, because a database name is');
    }
    return `mbx-${recipient}-g${scope.groupId}`;
  }
  return `mbx-${recipient}-${bytesToHex(scope.peerKey)}`;
}

/**
 * What `createCouchMailbox` needs: the server, whose mailbox and which of theirs. The rest is
 * passed to `CouchClient`.
 */
export interface CouchMailboxOptions extends Omit<CouchClientOptions, 'database'> {
  /** The server's base URL, without a database: `https://mailbox.example`. */
  readonly server: string;
  /** Whose mailbox this object points at. */
  readonly recipientKey: Uint8Array;
  /** Which of that recipient's mailboxes: the one for this peer, or a group they allowed. */
  readonly scope: MailboxScope;
  /** The depositor's identity key, hex — recorded so the server can check the allowlist. */
  readonly fromKey?: Uint8Array;
  /**
   * How frames are removed once they have been applied.
   *
   * CouchDB reserves `_purge` for **server** admins (ADR-15 §Spike verification), and a phone
   * must never hold a server-admin credential — so in the app this is a call to the
   * provisioning service, which purges on the recipient's behalf against a fresh signature.
   * Left unset, the client tries CouchDB directly, which works only where a server-admin
   * credential legitimately exists: the clinic node, an operator's console, a test.
   */
  readonly purge?: (receipts: readonly MailboxReceipt[]) => Promise<void>;
}

/** A frame as it sits in the database. Parsed, never trusted. */
interface FrameDocument {
  readonly from?: unknown;
  readonly frame?: unknown;
  readonly _id?: unknown;
  readonly _rev?: unknown;
}

const MAX_DEPOSIT_BASE64 = 131_072;

/** The largest sealed blob `deposit` accepts, in raw bytes: what base64 of the cap decodes to. */
export const MAX_DEPOSIT_BYTES = (MAX_DEPOSIT_BASE64 / 4) * 3;

/** A refusal that says the mailbox is not there, from the service or from CouchDB. */
function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status: unknown }).status === 404
  );
}

/**
 * A `Mailbox` over one CouchDB database, the one `mailboxDatabaseName` names. A mailbox nobody has
 * deposited into yet reads as empty. A deposit needs `fromKey`, and throws without it, when it is
 * over `MAX_DEPOSIT_BYTES`, or when the server refuses it.
 */
export function createCouchMailbox(options: CouchMailboxOptions): Mailbox {
  const database = `${options.server.replace(/\/+$/, '')}/${mailboxDatabaseName(options.recipientKey, options.scope)}`;
  const client = new CouchClient({ ...options, database });
  const from = options.fromKey === undefined ? undefined : bytesToHex(options.fromKey);

  const readFrames = (
    rows: readonly {
      id: string;
      rev: string;
      deleted: boolean;
      doc: Record<string, unknown> | null;
    }[],
  ): MailboxItem[] => {
    const items: MailboxItem[] = [];
    for (const row of rows) {
      if (row.deleted || row.doc === null) continue;
      if (row.id.startsWith('_design/')) continue;
      const doc = row.doc as FrameDocument;
      if (typeof doc.frame !== 'string' || typeof doc.from !== 'string') continue;
      if (doc.frame.length > MAX_DEPOSIT_BASE64) continue;
      let blob: Uint8Array;
      try {
        blob = fromBase64(doc.frame);
      } catch {
        // A frame that is not base64 was not written by a TApp device. It is left in place
        // rather than purged: this client does not delete what it cannot account for.
        continue;
      }
      items.push({ receipt: { id: row.id, rev: row.rev }, blob, from: doc.from });
    }
    return items;
  };

  /**
   * Reads the queue from the beginning, every time.
   *
   * The first version of this kept a `_local/` checkpoint and resumed from it, which is what a
   * replicator does — and it lost mail. The checkpoint advances when frames are *read*, but a
   * frame is only safe once it has been *applied* on the device, and the gap between those two
   * is exactly where a flat battery lives. A phone that died in that gap came back, resumed
   * from the checkpoint, and never saw the frames again.
   *
   * So there is no checkpoint on this path. A mailbox is a queue that is purged as it is
   * drained, so scanning it from the start reads only what is still owed — and if that is ever
   * expensive, the purge is broken and that is the thing to fix. `waitForMail` still passes a
   * `since` to the long poll, but it holds it in memory for the life of one wait, where losing
   * it costs nothing.
   */
  const drain = async (options_: {
    limit?: number;
    longpoll?: boolean;
    timeoutMs?: number;
    since?: string;
  }) => {
    let changes;
    try {
      changes = await client.changes({
        since: options_.since ?? '0',
        includeDocs: true,
        ...(options_.limit === undefined ? {} : { limit: options_.limit }),
        ...(options_.longpoll === true ? { longpoll: true } : {}),
        ...(options_.timeoutMs === undefined ? {} : { timeoutMs: options_.timeoutMs }),
      });
    } catch (error) {
      // A mailbox nobody has deposited into yet does not exist, and the service no longer
      // makes one just to be read (ADR-15 §3, 2026-10-20). Its 404, or CouchDB's for a
      // database removed since, is an empty queue rather than a failed sync.
      if (isNotFound(error)) return { items: [], lastSeq: options_.since ?? '0' };
      throw error;
    }
    return { items: readFrames(changes.results), lastSeq: changes.lastSeq };
  };

  return {
    async deposit(blob) {
      if (from === undefined) {
        throw new Error('a deposit names its sender: construct the mailbox with fromKey');
      }
      const frame = toBase64(blob);
      if (frame.length > MAX_DEPOSIT_BASE64) {
        throw new Error(
          `a deposit is bounded at ${MAX_DEPOSIT_BYTES} bytes; this one is ${blob.length}`,
        );
      }
      const [result] = await client.bulkDocs([{ from, frame, at: new Date().toISOString() }]);
      if (result?.error !== undefined) {
        // The server is the authority on the allowlist (ADR-15 §2). A refusal here is the
        // design working, not a bug to retry around.
        throw new Error(`the mailbox refused the deposit: ${result.error}`);
      }
    },

    async collect(collectOptions) {
      const { items } = await drain({
        ...(collectOptions?.limit === undefined ? {} : { limit: collectOptions.limit }),
      });
      return items;
    },

    async waitForMail(waitOptions) {
      // Anything already waiting is mail; only an empty queue is worth holding a socket for.
      const first = await drain({});
      if (first.items.length > 0) return first.items;
      const woken = await drain({
        longpoll: true,
        since: first.lastSeq,
        ...(waitOptions?.timeoutMs === undefined ? {} : { timeoutMs: waitOptions.timeoutMs }),
      });
      return woken.items;
    },

    async purgeCollected(receipts: readonly MailboxReceipt[]) {
      if (receipts.length === 0) return;
      if (options.purge !== undefined) {
        await options.purge(receipts);
        return;
      }
      const revisions: Record<string, string[]> = {};
      for (const receipt of receipts) revisions[receipt.id] = [receipt.rev];
      await client.purge(revisions);
    },
  };
}
