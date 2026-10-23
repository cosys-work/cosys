import {
  BEYOND_REACH,
  bytesToHex,
  concatBytes,
  ed25519,
  erasureReceiptPayloadSchema,
  erasureRequestPayloadSchema,
  hexToBytes,
  revocationScopeSchema,
  sha256,
  ulid,
  utf8,
  type ErasureHolder,
  type ErasureReceiptPayload,
  type ErasureRequestPayload,
  type KeptRecord,
  type RevocationScope,
  type RowView,
} from './deps.ts';
import type { DeviceIdentity } from './identity.ts';
import type { SyncEntry } from './messages.ts';
import { withinScope } from './revocation.ts';
import type { PeerStore } from './store.ts';

/**
 * Asking a holder to destroy what it holds, and the holder's signed answer (ADR-17 §3, §4).
 *
 * ## Its own act, not a mode of revocation
 *
 * ADR-16's `stop_and_remove` bundles *should they keep receiving?* with *must they destroy what
 * they hold?*, and bundled they cannot say "delete what the clinic holds but I am still their
 * patient", or "I ended that share last year and now I want it gone". So an erasure request is
 * a row of its own, and "stop and remove" on the relationship screen is a revocation that stops
 * sending **plus** one of these, issued together (§3).
 *
 * ## The receipt is a statement, and nothing on a screen may call it more
 *
 * §4, in the sentence this module exists to keep true: a receipt *"establishes that a specific
 * holder made a specific statement at a specific time, in a way they cannot later deny and a
 * third party cannot forge. It does not establish that any byte was destroyed."* The signature
 * below buys the first half and cannot buy the second. So the receipt says who answered, what
 * they say they removed, what they say is left, and what no software can reach, and the
 * patient-facing copy says *their app says* rather than *it was deleted*.
 *
 * ## Why every row signs itself
 *
 * A mailbox frame is authenticated by its sender, and that authentication is gone once the
 * frame is opened and purged. The receipt is kept for months as the patient's evidence (§8
 * finding 3), so it has to carry its own proof of authorship, and the request likewise has to
 * carry the patient's, because §3 requires a holder to be able to refuse a request the patient
 * did not make.
 *
 * The signed bytes are a fixed-order JSON array behind a domain-separation prefix, never the
 * payload's own JSON: key order in a JSON object is a property of whoever serialised it, and a
 * signature over it would break on the first peer that parsed and re-wrote the row.
 */

const REQUEST_CONTEXT = utf8('tapp-peer/erasure-request/v1');
const RECEIPT_CONTEXT = utf8('tapp-peer/erasure-receipt/v1');

/** §6: a holder honours a request within seven days, or on its next start if it was offline. */
export const ERASURE_ANSWER_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

const canonicalScope = (scope: RevocationScope) => [
  [...scope.deviceIds],
  scope.kinds === undefined ? null : [...scope.kinds],
  scope.from ?? null,
  scope.to ?? null,
];

/** The row fields a signature binds, so a statement cannot be moved to another row. */
const rowHeader = (row: Pick<SyncEntry, 'id' | 'kind' | 'deviceId' | 'occurredAt'>) => [
  row.id,
  row.kind,
  row.deviceId,
  row.occurredAt,
];

type Unsigned<T> = Omit<T, 'signature'>;

function requestMessage(
  row: Pick<SyncEntry, 'id' | 'kind' | 'deviceId' | 'occurredAt'>,
  payload: Unsigned<ErasureRequestPayload>,
): Uint8Array {
  return concatBytes([
    REQUEST_CONTEXT,
    utf8(
      JSON.stringify([
        ...rowHeader(row),
        payload.peer,
        payload.requester,
        payload.requestedAt,
        canonicalScope(payload.scope),
      ]),
    ),
  ]);
}

function receiptMessage(
  row: Pick<SyncEntry, 'id' | 'kind' | 'deviceId' | 'occurredAt'>,
  payload: Unsigned<ErasureReceiptPayload>,
): Uint8Array {
  return concatBytes([
    RECEIPT_CONTEXT,
    utf8(
      JSON.stringify([
        ...rowHeader(row),
        payload.peer,
        payload.requester,
        payload.requestId,
        payload.requestHash,
        payload.holder,
        payload.outcome,
        canonicalScope(payload.scope),
        payload.rowsRemoved,
        payload.attachmentsRemoved,
        payload.rowsRemaining,
        payload.attachmentsRemaining,
        payload.completedAt,
        payload.software,
        payload.backups === undefined
          ? null
          : [payload.backups.retentionDays, payload.backups.lastCopyExpiresAt],
        payload.beyondReach,
        // ADR-20 §9, 2026-10-02. Appended only when present, so a receipt signed before the
        // field existed still verifies byte for byte.
        ...(payload.kept === undefined
          ? []
          : [
              [
                [...payload.kept.categories].sort(),
                payload.kept.clinicRows,
                payload.kept.retentionYears,
              ],
            ]),
      ]),
    ),
  ]);
}

const verifies = (signatureHex: string, message: Uint8Array, keyHex: string): boolean => {
  try {
    return ed25519.verify(hexToBytes(signatureHex), message, hexToBytes(keyHex));
  } catch {
    return false;
  }
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const blankRow = (
  identity: DeviceIdentity,
  kind: 'erasure_request' | 'erasure_receipt',
  now: number,
): Omit<SyncEntry, 'payload'> => {
  const at = new Date(now).toISOString();
  return {
    id: ulid(now),
    kind,
    occurredAt: at,
    recordedAt: at,
    deviceId: identity.deviceId,
    // A request is the patient's own act, like a grant. A receipt is what software did.
    source: kind === 'erasure_request' ? 'manual' : 'system',
    supersedesId: null,
    targetId: null,
    glucoseMgdl: null,
    aiModelId: null,
    aiSuggestion: null,
  };
};

// ── The request ─────────────────────────────────────────────────────────────────────────────

/**
 * The patient's request, as a row on their own log, signed by their identity.
 *
 * **No reason field, and no free text** (§3). A patient does not owe anyone an explanation for
 * asking for their own record back, and a reason field is a field that ends up in a log.
 */
export function createErasureRequest(
  identity: DeviceIdentity,
  request: { readonly peer: string; readonly scope: RevocationScope },
  now: number = Date.now(),
): SyncEntry {
  const row = blankRow(identity, 'erasure_request', now);
  const unsigned: Unsigned<ErasureRequestPayload> = {
    peer: request.peer,
    requester: bytesToHex(identity.publicKey),
    scope: revocationScopeSchema.parse(request.scope),
    requestedAt: row.occurredAt,
  };
  const signature = bytesToHex(ed25519.sign(requestMessage(row, unsigned), identity.secretKey));
  return {
    ...row,
    payload: JSON.stringify(erasureRequestPayloadSchema.parse({ ...unsigned, signature })),
  };
}

/**
 * A request, read and verified, or null.
 *
 * Null for anything that is not an `erasure_request`, does not parse, or was not signed by the
 * key it names as its requester — which covers a request somebody edited after it was signed
 * and one somebody wrote in the patient's name. Whether that requester is somebody this holder
 * should listen to is a separate question, and it is the caller's (`pendingErasures`).
 */
export function readErasureRequest(row: SyncEntry): ErasureRequestPayload | null {
  if (row.kind !== 'erasure_request') return null;
  const parsed = erasureRequestPayloadSchema.safeParse(parseJson(row.payload));
  if (!parsed.success) return null;
  const { signature, ...unsigned } = parsed.data;
  return verifies(signature, requestMessage(row, unsigned), unsigned.requester)
    ? parsed.data
    : null;
}

/**
 * The request's digest, which a receipt names alongside its id (§4).
 *
 * Over the signed bytes **and** the signature, so two requests that differ in anything, down to
 * which of two valid signatures they carry, have different digests.
 */
export function erasureRequestDigest(row: SyncEntry): string {
  const payload = readErasureRequest(row);
  if (payload === null) throw new Error('that is not a request anybody signed');
  const { signature, ...unsigned } = payload;
  return bytesToHex(sha256(concatBytes([requestMessage(row, unsigned), hexToBytes(signature)])));
}

// ── Honouring one ───────────────────────────────────────────────────────────────────────────

/** What a holder says about itself in every receipt it signs (§4, §5). */
export type HolderDetails =
  | { readonly holder: 'install'; readonly software: string }
  | {
      readonly holder: 'archive';
      readonly software: string;
      /**
       * The operator's configured window (§5), stated in every receipt. **Mandatory**: the
       * schema refuses an archive receipt without it, because an archive with no stated
       * window is exactly the vague promise §5 was written to rule out.
       */
      readonly backups: { readonly retentionDays: number };
      /**
       * ADR-20 §9: a clinic archive's own record, kept and named in the receipt. Absent for
       * the operator's holders, which keep nothing of a patient's.
       */
      readonly kept?: KeptRecord;
    };

/**
 * Honours a verified request and returns the signed receipt, which the caller stores and sends.
 *
 * **The destructive path is `applyRevocation`'s**, through the same `PeerStore.removeRows` and
 * the same scope predicate (`withinScope`), so there is one answer to "which rows does a scope
 * cover" and, in the app, one way past the append-only trigger (`withPurgeMarker`).
 *
 * **A partial answer is still an answer** (§6). The rows in scope are counted before and after,
 * so a store that removed some and failed on the rest, or a file that would not delete, turns
 * into a receipt that says what is left rather than an exception and a silence. The count is
 * taken again after the removal rather than trusted from it, because "what is left" is the
 * claim the receipt makes and is the thing to measure.
 */
export async function honourErasure(
  store: PeerStore,
  request: SyncEntry,
  identity: DeviceIdentity,
  details: HolderDetails,
  now: number = Date.now(),
): Promise<SyncEntry> {
  const asked = readErasureRequest(request);
  if (asked === null) throw new Error('that erasure request does not verify');
  const holderKey = bytesToHex(identity.publicKey);
  if (asked.peer !== holderKey)
    throw new Error('that erasure request is addressed to another holder');

  // **Never the holder's own rows**, whatever device ids the request names (2026-10-16, the
  // review of PR #121). A signature proves who asked; it does not prove the ids are the asker's,
  // and an unmodified patient app named the clinic's device. `withinScope` also refuses every
  // `clinic:` row, which covers a clinic whose other computers signed under other ids.
  const authors = new Set(asked.scope.deviceIds);
  authors.delete(identity.deviceId);
  const covered = (row: SyncEntry) => withinScope(row, asked.scope, authors);

  const before = await store.countRows(covered);
  let attachmentsRemoved = 0;
  let attachmentsRemaining = 0;
  try {
    const removal = await store.removeRows(covered);
    attachmentsRemoved = removal.attachments;
    attachmentsRemaining = removal.attachmentsLeft ?? 0;
  } catch {
    // The store rolled back, or got part of the way. What is left is measured below; what the
    // attachments did is unknown and is not claimed either way.
  }
  const rowsRemaining = await store.countRows(covered);
  const rowsRemoved = Math.max(0, before - rowsRemaining);

  const row = blankRow(identity, 'erasure_receipt', now);
  const unsigned: Unsigned<ErasureReceiptPayload> = {
    peer: holderKey,
    requester: asked.requester,
    requestId: request.id,
    requestHash: erasureRequestDigest(request),
    holder: details.holder,
    outcome: rowsRemaining === 0 && attachmentsRemaining === 0 ? 'complete' : 'partial',
    // An install evaluates every field the scope can carry, so it read the scope as sent. An
    // archive that reads one narrowly writes its own reading here instead (§4).
    scope: asked.scope,
    rowsRemoved,
    attachmentsRemoved,
    rowsRemaining,
    attachmentsRemaining,
    completedAt: row.occurredAt,
    software: details.software,
    ...(details.holder === 'archive'
      ? {
          backups: {
            retentionDays: details.backups.retentionDays,
            lastCopyExpiresAt: new Date(now + details.backups.retentionDays * DAY_MS).toISOString(),
          },
        }
      : {}),
    ...(details.holder === 'archive' && details.kept !== undefined ? { kept: details.kept } : {}),
    beyondReach: BEYOND_REACH,
  };
  const signature = bytesToHex(ed25519.sign(receiptMessage(row, unsigned), identity.secretKey));
  return {
    ...row,
    payload: JSON.stringify(erasureReceiptPayloadSchema.parse({ ...unsigned, signature })),
  };
}

/**
 * A receipt, read and checked against the request it claims to answer, or null.
 *
 * Checks that the holder who signed it is the holder the request was addressed to, that it is
 * for this requester, and that it names this request by id **and** by digest. A receipt that
 * fails any of those is not an answer to this request, whatever it says.
 */
export function readErasureReceipt(
  receipt: SyncEntry,
  request: SyncEntry,
): ErasureReceiptPayload | null {
  if (receipt.kind !== 'erasure_receipt') return null;
  const asked = readErasureRequest(request);
  if (asked === null) return null;
  const parsed = erasureReceiptPayloadSchema.safeParse(parseJson(receipt.payload));
  if (!parsed.success) return null;
  const { signature, ...unsigned } = parsed.data;
  if (unsigned.peer !== asked.peer) return null;
  if (unsigned.requester !== asked.requester) return null;
  if (unsigned.requestId !== request.id) return null;
  if (unsigned.requestHash !== erasureRequestDigest(request)) return null;
  return verifies(signature, receiptMessage(receipt, unsigned), unsigned.peer) ? parsed.data : null;
}

/** The request a receipt says it answers, by id, without trusting anything else in it yet. */
export function receiptRequestId(receipt: SyncEntry): string | null {
  if (receipt.kind !== 'erasure_receipt') return null;
  const parsed = erasureReceiptPayloadSchema.safeParse(parseJson(receipt.payload));
  return parsed.success ? parsed.data.requestId : null;
}

/**
 * The requests this holder owes an answer to, oldest first.
 *
 * **A fold over what the holder holds, not over what just arrived.** A request that landed in a
 * session that died before it was honoured is still owed an answer on the next one; a request
 * re-delivered after it was answered is owed nothing, and removes nothing further. That is the
 * same pair of properties revocation asserts, got here by asking "is there a receipt" rather
 * than "was this row new".
 *
 * `trusted` is the caller's answer to *whose requests does this holder act on*. A signature
 * proves who asked; it does not make them somebody whose record this holder keeps.
 */
export function pendingErasures(
  rows: Iterable<SyncEntry>,
  holderKey: string,
  trusted: (requester: string) => boolean,
): readonly SyncEntry[] {
  const all = [...rows];
  const answered = new Set<string>();
  for (const row of all) {
    if (row.kind !== 'erasure_receipt') continue;
    const parsed = erasureReceiptPayloadSchema.safeParse(parseJson(row.payload));
    if (parsed.success && parsed.data.peer === holderKey) answered.add(parsed.data.requestId);
  }
  return all
    .filter((row) => {
      if (answered.has(row.id)) return false;
      const asked = readErasureRequest(row);
      return asked !== null && asked.peer === holderKey && trusted(asked.requester);
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ── Where a request stands, for the patient ─────────────────────────────────────────────────

/**
 * §6's states, less the one a mailbox cannot observe.
 *
 * `waiting` covers both *sent* and *delivered*: a mailbox deposit is acknowledged by the
 * server, never by the holder, so "delivered" is a state this transport has no way to learn and
 * a screen that showed it would be guessing. *Not yet sent* is the app's to add, from its own
 * record of what it deposited, since only it knows.
 */
export type ErasureStatus = 'waiting' | 'answered' | 'overdue';

/** One erasure request on the patient's log and where it stands, as `resolveErasures` reads it. */
export interface ErasureState {
  /** The request row itself. */
  readonly request: SyncEntry;
  /** The request's parsed payload: who was asked, by whom, and when. */
  readonly asked: ErasureRequestPayload;
  /** Where the request stands. */
  readonly status: ErasureStatus;
  /** The verified answer, when there is one. */
  readonly receipt: { readonly row: SyncEntry; readonly payload: ErasureReceiptPayload } | null;
}

/**
 * Every erasure request on the patient's log, with its answer if one has arrived.
 *
 * `requester` narrows to one identity's own requests, which is every request on a `mine`
 * account. **Overdue is a fact about the request, stated as one** (§6, ADR-09 §B): seven days
 * without an answer, no alarm, and the subject is the request rather than the patient.
 */
export function resolveErasures(
  rows: Iterable<SyncEntry>,
  options: { readonly requester?: string; readonly now?: number } = {},
): readonly ErasureState[] {
  const all = [...rows];
  const now = options.now ?? Date.now();
  const receipts = all.filter((row) => row.kind === 'erasure_receipt');
  const states: ErasureState[] = [];

  for (const request of all) {
    const asked = readErasureRequest(request);
    if (asked === null) continue;
    if (options.requester !== undefined && asked.requester !== options.requester) continue;

    let receipt: ErasureState['receipt'] = null;
    for (const candidate of receipts) {
      if (receiptRequestId(candidate) !== request.id) continue;
      const payload = readErasureReceipt(candidate, request);
      // The latest verified answer wins. A holder answers once; two would mean a re-run, and
      // the later one is the one describing the holder as it now is.
      if (payload !== null && (receipt === null || candidate.id > receipt.row.id)) {
        receipt = { row: candidate, payload };
      }
    }

    const age = now - Date.parse(asked.requestedAt);
    const status: ErasureStatus =
      receipt !== null ? 'answered' : age > ERASURE_ANSWER_DAYS * DAY_MS ? 'overdue' : 'waiting';
    states.push({ request, asked, status, receipt });
  }
  return states.sort((a, b) => (a.request.id < b.request.id ? -1 : 1));
}

// ── How each travels ────────────────────────────────────────────────────────────────────────

const addressedTo = (row: SyncEntry, peer: string): boolean => {
  const asked = readErasureRequest(row);
  return asked !== null && asked.peer === peer;
};

/**
 * A peer's view, with the erasure requests addressed to it added.
 *
 * `TRAVELS` (since 2026-10-21 `SUBSTRATE_KINDS` in `@cosys/record/kinds`) keeps both erasure
 * kinds off the grant route, and said why: *"when that ships it will want a route of its own with
 * its own decision, not this one by inheritance."* This is that route. It sends a request to the
 * one holder it names, whatever the grant's state, because §3's two cases are erasure with a live
 * share and erasure long after one ended, and a route that depended on the grant would serve
 * neither.
 *
 * `inner` is the grant's view, or null where there is none, in which case the requests are all
 * that goes.
 *
 * **And what a holder was asked to erase is never sent to it again.** `requests` is the log's
 * erasure requests, and a row that existed when one addressed to this peer was made, and falls
 * inside its scope, is dropped here even under a live grant. Without this, erasure with the
 * share still running (§3's first case) lasts only until the patient's phone re-sends from an
 * earlier cursor, and it will: `peer_cursors` is not in `.tappbak`, so a restored phone starts
 * every peer from the beginning and would hand the holder back everything it had destroyed.
 * Rows written after the request still flow, which is what "I am still their patient" means.
 */
export function erasureRoute(
  peer: string,
  inner: RowView | null,
  requests: Iterable<SyncEntry> = [],
): RowView {
  const erased: { readonly id: string; readonly covers: (row: SyncEntry) => boolean }[] = [];
  for (const row of requests) {
    const asked = readErasureRequest(row);
    if (asked === null || asked.peer !== peer) continue;
    const authors = new Set(asked.scope.deviceIds);
    erased.push({
      id: row.id,
      covers: (candidate) => withinScope(candidate, asked.scope, authors),
    });
  }

  return {
    name: inner?.name ?? 'erasure',
    attachments: inner?.attachments ?? false,
    project: (row) => {
      if (row.kind === 'erasure_request') return addressedTo(row, peer) ? row : null;
      if (inner === null) return null;
      if (erased.some((request) => row.id < request.id && request.covers(row))) return null;
      return inner.project(row);
    },
  };
}

/**
 * The only thing a holder sends the requester: its own answers to that requester.
 *
 * A holder authors nothing else it may forward (ADR-15 §4, ADR-18 §7), so this is not a widening
 * of what a held account sends. It is the one row a held account writes about itself, going to
 * the one person it is about.
 */
export function receiptRoute(requester: string, holderDeviceId: string): RowView {
  return {
    name: 'erasure:receipt',
    attachments: false,
    project: (row) => {
      if (row.kind !== 'erasure_receipt' || row.deviceId !== holderDeviceId) return null;
      const parsed = erasureReceiptPayloadSchema.safeParse(parseJson(row.payload));
      return parsed.success && parsed.data.requester === requester ? row : null;
    },
  };
}

export type { ErasureHolder, ErasureReceiptPayload, ErasureRequestPayload };
