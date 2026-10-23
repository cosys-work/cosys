/**
 * The mailbox's client: CouchDB reached with `fetch`, and nothing else.
 *
 * ADR-15 §1 is explicit that **PouchDB does not enter the patient app** — Hermes cannot compile
 * its design-document functions, and ADR-01 §7 does not admit a dependency of that size for a
 * feature that is four HTTP calls. Those four calls are here.
 *
 * What this module deliberately is not: a replicator. CouchDB's replication protocol exists to
 * make two databases agree, and the mailbox is not a database the device wants a copy of — it
 * is a queue the device drains and empties. The cursor that would make replication necessary
 * does not exist (ADR-14 §Outcome, finding 3): the receiver's position is `max(id)` in its own
 * `entries`, so `_local/` here holds one `update_seq` as a *hint*, and losing it costs one
 * wasted scan rather than a lost frame.
 *
 * Every response is treated as untrusted input. A mailbox is a server the operator runs, which makes it
 * exactly as trustworthy as ADR-15 says it is — trusted for availability, never for content —
 * and a client that believed a document because the server sent it would be the place that
 * assumption broke.
 */

export interface CouchResponse<T> {
  readonly status: number;
  readonly ok: boolean;
  readonly body: T;
}

/**
 * How a request proves who it is.
 *
 * ADR-15 §2: a challenge signed by the caller's Ed25519 key, exchanged for a short-lived ES256
 * JWT scoped to one database and one role. The token is fetched through this callback rather
 * than held, so a session that outlives a token refreshes without the caller noticing, and so
 * that nothing here ever sees the identity secret.
 */
export type TokenSource = () => Promise<string>;

/** What a `CouchClient` needs: one database, and how to authenticate to it. */
export interface CouchClientOptions {
  /** The database's URL, without a trailing slash: `https://host/mbx-<hex>`. */
  readonly database: string;
  /** Called for a bearer token before every request. */
  readonly token: TokenSource;
  /** Injected so tests need no server and the app needs no polyfill. */
  readonly fetch?: typeof globalThis.fetch;
  /** Bounds every request. A phone on a Nepali carrier is not a fast server. */
  readonly timeoutMs?: number;
}

export interface ChangeRow {
  readonly id: string;
  readonly seq: string;
  readonly deleted: boolean;
  readonly rev: string;
  readonly doc: Record<string, unknown> | null;
}

export interface Changes {
  readonly results: readonly ChangeRow[];
  readonly lastSeq: string;
}

/** A mailbox request that the server refused, or answered with something this client cannot use. */
export class CouchError extends Error {
  /** The HTTP status the mailbox answered with. */
  readonly status: number;
  /** `message` says which request failed and how. */
  constructor(status: number, message: string) {
    super(message);
    this.name = 'CouchError';
    this.status = status;
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;
/** A long-poll holds the socket open on purpose; it gets its own, longer bound. */
const LONGPOLL_SLACK_MS = 10_000;

/**
 * One mailbox database over `fetch`: deposit, the change feed, purge, attachments and the
 * checkpoint. Every request fetches a fresh bearer token and has its own timeout, which aborts it.
 */
export class CouchClient {
  readonly #database: string;
  readonly #token: TokenSource;
  readonly #fetch: typeof globalThis.fetch;
  readonly #timeoutMs: number;

  /** Trailing slashes are stripped from the database URL; the timeout defaults to 30 seconds. */
  constructor(options: CouchClientOptions) {
    this.#database = options.database.replace(/\/+$/, '');
    this.#token = options.token;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async #request<T>(
    path: string,
    init: { method?: string; body?: string | Uint8Array; contentType?: string; timeoutMs?: number },
  ): Promise<CouchResponse<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? this.#timeoutMs);
    try {
      const response = await this.#fetch(`${this.#database}${path}`, {
        method: init.method ?? 'GET',
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${await this.#token()}`,
          'content-type': init.contentType ?? 'application/json',
          accept: 'application/json',
        },
        ...(init.body === undefined ? {} : { body: init.body as BodyInit }),
      });

      const text = await response.text();
      let body: unknown = null;
      if (text !== '') {
        try {
          body = JSON.parse(text);
        } catch {
          // A mailbox that answers a JSON request with something else is not a mailbox this
          // build understands; that is a failure, not a body.
          throw new CouchError(
            response.status,
            'the mailbox answered with something that is not JSON',
          );
        }
      }
      return { status: response.status, ok: response.ok, body: body as T };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Deposits frames. One document per frame, which is what the wire format already is. */
  async bulkDocs(
    docs: readonly Record<string, unknown>[],
  ): Promise<readonly { id: string; rev?: string; error?: string }[]> {
    const response = await this.#request<unknown>('/_bulk_docs', {
      method: 'POST',
      body: JSON.stringify({ docs }),
    });
    if (!response.ok) throw new CouchError(response.status, 'the mailbox refused the deposit');
    if (!Array.isArray(response.body)) {
      throw new CouchError(response.status, 'the mailbox did not say what it stored');
    }
    return response.body.map((row: Record<string, unknown>) => ({
      id: String(row.id ?? ''),
      ...(typeof row.rev === 'string' ? { rev: row.rev } : {}),
      ...(typeof row.error === 'string' ? { error: row.error } : {}),
    }));
  }

  /**
   * Reads the change feed.
   *
   * `longpoll` is what lets a phone wait for a frame without polling a carrier's data plan to
   * death, and `includeDocs` is what makes collection one request instead of two — measured at
   * 326 ms end to end in ADR-15 §Spike verification.
   */
  async changes(
    options: {
      readonly since?: string;
      readonly longpoll?: boolean;
      readonly timeoutMs?: number;
      readonly includeDocs?: boolean;
      readonly limit?: number;
    } = {},
  ): Promise<Changes> {
    const query = new URLSearchParams({ since: options.since ?? '0' });
    if (options.includeDocs !== false) query.set('include_docs', 'true');
    if (options.limit !== undefined) query.set('limit', String(options.limit));
    if (options.longpoll === true) {
      query.set('feed', 'longpoll');
      query.set('timeout', String(options.timeoutMs ?? this.#timeoutMs));
    }

    const response = await this.#request<{ results?: unknown; last_seq?: unknown }>(
      `/_changes?${query.toString()}`,
      { timeoutMs: (options.timeoutMs ?? this.#timeoutMs) + LONGPOLL_SLACK_MS },
    );
    if (!response.ok) throw new CouchError(response.status, 'the mailbox refused to be read');

    const raw = Array.isArray(response.body?.results) ? response.body.results : [];
    const results: ChangeRow[] = [];
    for (const row of raw as Record<string, unknown>[]) {
      const changes = Array.isArray(row.changes) ? (row.changes as Record<string, unknown>[]) : [];
      const rev = changes[0]?.rev;
      if (typeof row.id !== 'string' || typeof rev !== 'string') continue;
      results.push({
        id: row.id,
        seq: String(row.seq ?? ''),
        deleted: row.deleted === true,
        rev,
        doc:
          typeof row.doc === 'object' && row.doc !== null
            ? (row.doc as Record<string, unknown>)
            : null,
      });
    }
    return { results, lastSeq: String(response.body?.last_seq ?? '0') };
  }

  /**
   * Removes frames outright.
   *
   * **Not `DELETE`.** ADR-15 §Spike verification found that a deleted CouchDB document is still
   * readable by its previous revision, byte-identical, until compaction — so a mailbox that
   * promised "deleted on collection" and issued a `DELETE` would be keeping the ciphertext and
   * saying it was not. `_purge` is what makes the promise true, and the integration test reads
   * the old revision back and requires a 404.
   */
  async purge(revisions: Readonly<Record<string, readonly string[]>>): Promise<void> {
    if (Object.keys(revisions).length === 0) return;
    const response = await this.#request<unknown>('/_purge', {
      method: 'POST',
      body: JSON.stringify(revisions),
    });
    if (!response.ok) throw new CouchError(response.status, 'the mailbox would not purge');
  }

  /**
   * Stores `bytes` as attachment `name` on document `id` at revision `rev`, and returns the
   * document's new revision. Throws `CouchError` when the mailbox refuses it.
   */
  async putAttachment(
    id: string,
    rev: string,
    name: string,
    bytes: Uint8Array,
  ): Promise<{ rev: string }> {
    const response = await this.#request<{ rev?: unknown }>(
      `/${encodeURIComponent(id)}/${encodeURIComponent(name)}?rev=${encodeURIComponent(rev)}`,
      { method: 'PUT', body: bytes, contentType: 'application/octet-stream' },
    );
    if (!response.ok) throw new CouchError(response.status, 'the mailbox refused the attachment');
    return { rev: String(response.body?.rev ?? '') };
  }

  /**
   * Reads attachment `name` of document `id` as raw bytes. Throws `CouchError` when it cannot be
   * read.
   */
  async getAttachment(id: string, name: string): Promise<Uint8Array> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(
        `${this.#database}/${encodeURIComponent(id)}/${encodeURIComponent(name)}`,
        {
          signal: controller.signal,
          headers: { authorization: `Bearer ${await this.#token()}` },
        },
      );
      if (!response.ok) throw new CouchError(response.status, 'the attachment could not be read');
      return new Uint8Array(await response.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * The checkpoint, which is a hint and never a source of truth.
   *
   * `_local/` documents do not replicate and do not appear in the change feed, which is exactly
   * right for something the device keeps for its own convenience. If it is lost, the next drain
   * starts from `0` and the ULID merge makes every re-delivered frame a no-op.
   */
  async readCheckpoint(name: string): Promise<{ seq: string; rev?: string }> {
    const response = await this.#request<{ seq?: unknown; _rev?: unknown }>(
      `/_local/${encodeURIComponent(name)}`,
      {},
    );
    if (response.status === 404) return { seq: '0' };
    if (!response.ok) return { seq: '0' };
    return {
      seq: String(response.body?.seq ?? '0'),
      ...(typeof response.body?._rev === 'string' ? { rev: response.body._rev } : {}),
    };
  }

  /**
   * Writes `seq` as the checkpoint `name`, with `rev` to replace the one already there. A write the
   * mailbox refuses is ignored; a request that fails outright still rejects.
   */
  async writeCheckpoint(name: string, seq: string, rev?: string): Promise<void> {
    await this.#request<unknown>(`/_local/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify({ seq, ...(rev === undefined ? {} : { _rev: rev }) }),
    });
    // A checkpoint that will not write is not an error worth failing a drain over: it is an
    // optimisation, and the next drain simply scans further than it needed to.
  }
}
