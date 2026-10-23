import { z } from 'zod';

import {
  isAuthoredByAnother,
  isControlKind,
  REVOCATION_MODES,
  revocationPayloadSchema,
  revocationScopeSchema,
  ulid,
  type RevocationMode,
  type RevocationPayload,
  scopeKindsOf,
  type RevocationScope,
} from './deps.ts';
import type { DeviceIdentity } from './identity.ts';
import type { SyncEntry } from './messages.ts';
import type { PeerStore } from './store.ts';

/**
 * Taking it back, as far as software can — and saying plainly how far that is.
 *
 * ADR-16 §1 is a decision about who chooses rather than about what is technically possible:
 * **the patient decides whether revoking a share removes what was already shared or only stops
 * what comes next.** The architecture offers both and picks neither, because data sovereignty
 * is the project's value and the two obvious engineering positions — "forward-only, because
 * retroactive deletion cannot be guaranteed" and "always delete, because that is what people
 * expect" — both take the decision away from the person whose readings they are.
 *
 * So a revocation carries a mode. And the mode that removes things carries a limit that is part
 * of the feature rather than a footnote: **a revocation is an instruction to software the
 * patient does not control.** A cooperating TApp install honours it. A modified build, a CSV
 * exported last week, a photograph of a screen, or a caretaker's paper notebook do not, and the
 * patient is told so in their own language *before* they choose, not after.
 *
 * It rides the ordinary machinery, which is the whole reason ADR-16 could specify it in a
 * paragraph: a revocation is an entry (ADR-02), so it merges by ULID, travels either transport,
 * survives an interrupted session, and reaches a peer that was switched off when it was issued.
 * Nothing in `session.ts` knows what a revocation is.
 */

/**
 * The revocation's shape is not this package's either, for the same reason the grant's is
 * (ADR-15 §4).
 *
 * `REVOCATION_MODES`, the scope and the payload are the substrate's record's
 * (`@cosys/record/schema/sharing`, 2026-10-22), borrowed through `deps.ts`; which kinds a scope
 * may name is the registry's (`isRevocableKind`), and the health modality's list of them is
 * `@tapp/record`'s `REVOCABLE_KINDS`. What stays here is what a revocation *does* — issuing one,
 * and honouring one that has arrived.
 */
export { REVOCATION_MODES, revocationPayloadSchema, revocationScopeSchema };
export type { RevocationMode, RevocationPayload, RevocationScope };

/**
 * The patient's revocation, as a row.
 *
 * `stop_sending` produces one too, even though nothing needs to travel for it: the patient's own
 * log is where "what am I sharing, and what did I stop" is answered, and an act that left no
 * trace would make that question unanswerable a month later.
 */
export function createRevocation(
  identity: DeviceIdentity,
  payload: RevocationPayload,
  now: number = Date.now(),
): SyncEntry {
  const at = new Date(now).toISOString();
  return {
    id: ulid(now),
    kind: 'revoke',
    occurredAt: at,
    recordedAt: at,
    deviceId: identity.deviceId,
    source: 'system',
    supersedesId: null,
    targetId: null,
    payload: JSON.stringify(revocationPayloadSchema.parse(payload)),
    glucoseMgdl: null,
    aiModelId: null,
    aiSuggestion: null,
  };
}

/** What a revocation actually did, so that a receiver can record it and a test can measure it. */
export interface RevocationReport {
  /** The mode of the revocation that was applied. */
  readonly mode: RevocationMode;
  /** Rows removed from this device. */
  readonly removed: number;
  /** Rows the scope did not cover, and which therefore stay. */
  readonly kept: number;
  /** Attachment blobs removed along with the rows that referenced them. */
  readonly attachmentsRemoved: number;
  /**
   * What this device cannot reach, named rather than omitted: anything exported, copied,
   * photographed or written down before the revocation arrived. Always true, never zero in
   * practice, and the reason §1's second sentence exists.
   */
  readonly beyondReach: 'exports, copies and anything written down';
}

/**
 * Compares two instants that were written by different code.
 *
 * `2026-07-01T00:00:00Z` and `2026-07-01T00:00:00.000Z` are the same moment and do not compare
 * equal as strings — `.` sorts below `Z`, so a bound written the first way silently excludes a
 * row written the second way. ULIDs can be compared as text because one generator makes them
 * all; timestamps that came from a patient's phone, a doctor's form and a test fixture cannot.
 */
const atOrBefore = (a: string, b: string): boolean => {
  const left = Date.parse(a);
  const right = Date.parse(b);
  if (Number.isNaN(left) || Number.isNaN(right)) return a <= b;
  return left <= right;
};

/**
 * Whether a row a peer holds falls inside a scope the patient named.
 *
 * Shared by revocation and by erasure (ADR-17 §3: *"the same shape ADR-16 §1 uses for
 * revocation"*), so the two can never disagree about which rows a scope covers.
 *
 * **No control row is ever in scope**, and this used to say only `revoke`. A revocation never
 * removes itself, or the peer could not show why the rows went; since 2026-09-23 the same holds
 * for an erasure request and for the receipt that answers it — a `stop_and_remove` with no
 * `kinds` would otherwise have taken the patient's earlier erasure request with it, and the
 * holder would then have nothing to say it had been asked. A grant never travels, so there is
 * none here to remove either way. *(2026-10-21, WP2: "control" is what a modality registered
 * as such with `@cosys/record/kinds`: the substrate's four acts about sharing and `assert`, and
 * the health modality's `holder_receipt`, the set `CONTROL_ENTRY_KINDS` names.)*
 *
 * **Nor is a clinic's signed row** (2026-10-16, the peer review of PR #121). A scope's device
 * ids are the sender's to write, and an unmodified patient app named the clinic's device in an
 * erasure scope, because the clinic's rows sit in the patient's own log beside hers. ADR-20 §9
 * keeps the clinic's own signed record through an erasure (C3), and a revocation has no more
 * claim on it, so no scope reaches a `clinic:` row whatever ids it names. *(2026-10-22: asked of
 * the registry, `isAuthoredByAnother`, which the clinic modality answers for its six `clinic:`
 * kinds and a bridge will answer for its own.)*
 */
export const withinScope = (
  row: SyncEntry,
  scope: RevocationScope,
  authorDeviceIds: ReadonlySet<string>,
): boolean => {
  if (isControlKind(row.kind)) return false;
  if (isAuthoredByAnother(row.kind)) return false;
  if (!authorDeviceIds.has(row.deviceId)) return false;
  const kinds: readonly string[] | undefined = scope.kinds;
  if (kinds !== undefined && !scopeKindsOf(row.kind).some((kind) => kinds.includes(kind)))
    return false;
  if (scope.from !== undefined && !atOrBefore(scope.from, row.occurredAt)) return false;
  if (scope.to !== undefined && !atOrBefore(row.occurredAt, scope.to)) return false;
  return true;
};

const inScope = withinScope;

export { atOrBefore };

/**
 * Honours a revocation that has arrived.
 *
 * `stop_sending` removes nothing: the grantor simply stops, and this side keeps what it was
 * given. `stop_and_remove` deletes the rows in scope and the attachments they referenced.
 *
 * This is the one place a device destroys data it did not author. ADR-02 makes `purge` the only
 * destructive operation for exactly this reason, and a removal here is that operation applied to
 * somebody else's rows at their request — not an `UPDATE`, not a tombstone that leaves the value
 * in place, and not a filter in the UI that would leave the reading on the disk.
 *
 * **Two bounds the scope cannot widen** (2026-10-16, the review of PR #121):
 *
 * - **Only rows written before the revocation.** A revocation ends what was shared until it was
 *   issued; a row of a later share is not its business. The bound is what makes applying one
 *   twice harmless, and so what lets a receiver apply it on every delivery and fold over the ones
 *   it holds (`honourRevocations`) rather than only on the delivery that first landed it. That
 *   rule lost the removal for good when a run died between landing the row and acting on it.
 * - **Never this device's own rows** (`holderDeviceId`). The scope's device ids are the sender's
 *   to write, and the rows a holder wrote itself are not the sender's to take back.
 */
export async function applyRevocation(
  store: PeerStore,
  revocation: SyncEntry,
  options: { readonly holderDeviceId?: string } = {},
): Promise<RevocationReport> {
  const parsed = revocationPayloadSchema.safeParse(parseJson(revocation.payload));
  if (!parsed.success) {
    throw new Error('that revocation does not say what it revokes');
  }
  const { mode, scope } = parsed.data;

  if (mode === 'stop_sending') {
    return {
      mode,
      removed: 0,
      kept: await store.countRows(() => true),
      attachmentsRemoved: 0,
      beyondReach: 'exports, copies and anything written down',
    };
  }

  const removal = await store.removeRows(
    removalPredicate(revocation, scope, options.holderDeviceId),
  );
  return {
    mode,
    removed: removal.rows,
    kept: await store.countRows(() => true),
    attachmentsRemoved: removal.attachments,
    beyondReach: 'exports, copies and anything written down',
  };
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

function removalPredicate(
  revocation: SyncEntry,
  scope: RevocationScope,
  holderDeviceId: string | undefined,
): (row: SyncEntry) => boolean {
  const authors = new Set(scope.deviceIds);
  if (holderDeviceId !== undefined) authors.delete(holderDeviceId);
  return (row) => row.id < revocation.id && inScope(row, scope, authors);
}

/**
 * Every `stop_and_remove` among `rows`, honoured in one removal, for a receiver to run over the
 * revocations it holds (the fold `pendingErasures` already is for erasure).
 *
 * Idempotent by the bounds above: a revocation that was honoured removes nothing more. A row
 * that is not a revocation, or does not parse, is passed over rather than thrown on, because one
 * bad row from a peer must not stop the others being honoured.
 *
 * The caller decides whose revocations these are. On an account that authors, the revocations
 * are the patient's own farewells and must never be folded here.
 */
export async function honourRevocations(
  store: PeerStore,
  rows: Iterable<SyncEntry>,
  options: { readonly holderDeviceId?: string } = {},
): Promise<{ readonly removed: number; readonly attachmentsRemoved: number }> {
  const predicates: ((row: SyncEntry) => boolean)[] = [];
  for (const row of rows) {
    if (row.kind !== 'revoke') continue;
    const parsed = revocationPayloadSchema.safeParse(parseJson(row.payload));
    if (!parsed.success || parsed.data.mode !== 'stop_and_remove') continue;
    predicates.push(removalPredicate(row, parsed.data.scope, options.holderDeviceId));
  }
  if (predicates.length === 0) return { removed: 0, attachmentsRemoved: 0 };
  const removal = await store.removeRows((row) => predicates.some((covers) => covers(row)));
  return { removed: removal.rows, attachmentsRemoved: removal.attachments };
}
