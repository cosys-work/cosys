import { z } from 'zod';

import {
  bytesToHex,
  grantPayloadSchema,
  travelsUnderGrant,
  ulid,
  viewSpec,
  type GrantPayload,
  type RowView,
  type ViewContext,
} from './deps.ts';
import type { DeviceIdentity } from './identity.ts';
import type { SyncEntry } from './messages.ts';
import { atOrBefore, revocationPayloadSchema } from './revocation.ts';

/**
 * The share act (ADR-16 §3).
 *
 * A share is something a patient *does*, with a scope, and never something that happens because
 * two devices are paired — ADR-15 §3 is explicit that there is no ambient replication. So a
 * grant names the peer, the view, the period, the kinds and whether attachments travel, and it
 * is a row on the patient's own log rather than a setting: it versions like everything else, it
 * is in the `.tappbak`, and "what am I sharing, with whom" is a query a month later rather than
 * a screen that happens to be showing the truth.
 *
 * Narrowing a grant is a new grant. Ending one is a revocation (`revocation.ts`), which the
 * patient chooses the shape of.
 */

/**
 * The grant's shape is not this package's (ADR-15 §4, 2026-09-21).
 *
 * `GRANT_VIEWS` and `grantPayloadSchema` used to be declared here, which meant a row validated
 * on the wire and the same row validated before it reached `entries` were two objects kept in
 * step by hand. They are one object now, which this package borrows through `deps.ts` like it
 * borrows the cipher: since 2026-10-22 the substrate's (`@cosys/record/schema/sharing`), whose
 * `view` is any view a loaded modality registered. The list of views is the modality's
 * (`@tapp/record`'s `GRANT_VIEWS`). What stays here is the *act* — making a grant, folding the
 * log, resolving the view.
 */
export { grantPayloadSchema };
export type { GrantPayload };

/**
 * Writes a grant row on this device's log, timestamped `now` (epoch milliseconds). The payload is
 * parsed against `grantPayloadSchema` first, so a grant that does not parse throws rather than
 * being written.
 */
export function createGrant(
  identity: DeviceIdentity,
  payload: GrantPayload,
  now: number = Date.now(),
): SyncEntry {
  const at = new Date(now).toISOString();
  return {
    id: ulid(now),
    kind: 'grant',
    occurredAt: at,
    recordedAt: at,
    deviceId: identity.deviceId,
    source: 'manual',
    supersedesId: null,
    targetId: null,
    payload: JSON.stringify(grantPayloadSchema.parse(payload)),
    glucoseMgdl: null,
    aiModelId: null,
    aiSuggestion: null,
  };
}

/**
 * What the grant's scope is evaluated against.
 *
 * For an ordinary row that is the row itself. **For a tombstone it is the row being
 * retracted**, and the difference is a defect this file carried until 2026-09-21: a tombstone's
 * own `kind` is `tombstone` and its own `occurred_at` is the moment of deletion, so a grant
 * naming `kinds: ['glucose']`, or ending before the patient changed their mind, dropped the
 * retraction and left a deleted reading on the peer's phone for good.
 *
 * `projection.ts` passes tombstones through on purpose, for exactly that reason. This filter ran
 * first and undid it, and `full` had no protection at all.
 *
 * `targetOccurredAt` was added to the tombstone payload so this can be answered synchronously
 * (ADR-16 §Two defects). The rejected alternative was resolving the target row here: `project`
 * is synchronous, a real store is not, and threading a resolver through `PeerStore` for one
 * field is a seam change bought with a fallback path that would be subtly wrong.
 *
 * **What cannot be read travels.** A tombstone whose payload is missing the field, or is not
 * readable at all, is treated as in scope — a retraction that travels when it need not is inert
 * on the receiver, and one that does not travel is a lie on their screen.
 */
interface ScopeSubject {
  /** Null when it cannot be determined, which means the kind filter does not apply. */
  readonly kind: string | null;
  /** Null when it cannot be determined, which means the period bounds do not apply. */
  readonly occurredAt: string | null;
}

const tombstoneSubjectSchema = z.object({
  targetKind: z.string().min(1).max(40),
  targetOccurredAt: z.string().max(40).optional(),
});

function scopeSubjectOf(row: SyncEntry): ScopeSubject {
  if (row.kind !== 'tombstone') return { kind: row.kind, occurredAt: row.occurredAt };
  let parsed;
  try {
    parsed = tombstoneSubjectSchema.safeParse(JSON.parse(row.payload));
  } catch {
    return { kind: null, occurredAt: null };
  }
  if (!parsed.success) return { kind: null, occurredAt: null };
  return { kind: parsed.data.targetKind, occurredAt: parsed.data.targetOccurredAt ?? null };
}

/**
 * The projection each grant view names, as the modality that registered it makes it
 * (`@cosys/record/views`, 2026-10-22).
 *
 * This was a `switch` with no default over the health views, so that a view added without a
 * projection was a type error rather than a grant that quietly fell back to `full`, which is the
 * one wrong answer here. The same rule holds a step earlier now: a view nobody registered does not
 * parse (`grantPayloadSchema`), the health views are a total map over their list (`@tapp/record`'s
 * `views.ts`), and a view this process cannot make is an error rather than `full`.
 *
 * AGENTS.md rule 11: this package has no idea what a target band should be. A view that needs
 * one throws when the app did not hand it over, which is a bug rather than a default.
 */
function projectionFor(view: string, context: ViewContext): RowView {
  const spec = viewSpec(view);
  if (spec === undefined)
    throw new RangeError(`no loaded modality registered the view \`${view}\``);
  return spec.make(context);
}

/**
 * What each view is made from, for the rule that views combined in one grant may not overlap.
 *
 * `full` is every kind, so it combines with nothing. The rest each read one kind, and two views
 * that read the same one are refused together: that is what keeps a combined view to **at most
 * one projected row per source row**. The session's cursor is the highest id it sent from a log,
 * and two rows under one id would be a merge conflict on the peer's phone.
 */
function readsOf(view: string): string {
  return viewSpec(view)?.reads ?? '*';
}

/**
 * The projection a grant names: its `view`, and any `alsoViews` beside it (PLAN M11 F05, the
 * *Band* level is the band view and the medicines-taken view). A combination whose views share
 * a source is refused, rather than resolved by picking one.
 */
function combinedProjection(grant: GrantPayload, context: ViewContext): RowView {
  const views = [grant.view, ...(grant.alsoViews ?? [])];
  if (views.length === 1) return projectionFor(grant.view, context);
  const sources = views.map(readsOf);
  if (sources.includes('*') || new Set(sources).size !== sources.length) {
    throw new RangeError(`views that overlap cannot share one grant: ${views.join(', ')}`);
  }
  const projections = views.map((view) => projectionFor(view, context));
  return {
    name: views.join('+'),
    attachments: projections.some((projection) => projection.attachments),
    project: (row) => {
      for (const projection of projections) {
        const shown = projection.project(row);
        if (shown !== null) return shown;
      }
      return null;
    },
  };
}

/**
 * Which kinds may leave the phone at all, asked of **every** kind rather than of two by name.
 *
 * This used to be `row.kind === 'grant' || row.kind === 'revoke'`, written when those were the
 * only control kinds there were. Migration `0006_` added `erasure_request` and
 * `erasure_receipt` on 2026-09-21 and neither name was in that comparison — so under a `full`
 * grant, an erasure request would have been projected and sent, which is the patient telling
 * her clinic to destroy her record, delivered to her son. Nothing had to be wrong for that to
 * happen; the filter simply went on asking its original question after the world had added an
 * answer.
 *
 * The fix was a total map over `EntryKind` here, `TRAVELS`, so a kind added to the app was a type
 * error until somebody said whether it travelled. *2026-10-21, the handoff's WP2:* **the map is a
 * registry now** (`@cosys/record/kinds`), filled by the modality that owns each kind, and the
 * answers and their reasons moved with it: the substrate's own kinds in `SUBSTRATE_KINDS`, the
 * health and clinic kinds in `@tapp/record`'s `kinds.ts`, each a total map over its own kinds so
 * the type error is still there, one modality at a time. A kind nobody registered does not travel.
 * `@tapp/record`'s `kinds.test.ts` holds the registry to the table this was, kind for kind.
 *
 * So the question is `travelsUnderGrant(kind)`, asked below in the two places a row is let out.
 */

/**
 * The view a grant produces, which is what the session actually sends through.
 *
 * Scope and projection are applied in one place and in this order: a row outside the grant's
 * kinds or period is not narrowed, it is *not sent* — and only then is what remains projected.
 * Doing it the other way would mean computing a band for a reading the peer was never entitled
 * to know the existence of.
 */
function inGrantScope(grant: GrantPayload, subject: ScopeSubject): boolean {
  // Widened to `string` on purpose: `subject.kind` may have come off a tombstone payload that
  // arrived from a peer, so it is whatever that peer wrote, and a value outside `ENTRY_KINDS` is
  // a question this comparison answers rather than one the type system can.
  const kinds: readonly string[] | undefined = grant.kinds;
  if (kinds !== undefined && subject.kind !== null && !kinds.includes(subject.kind)) return false;
  if (subject.occurredAt !== null) {
    if (grant.from !== undefined && !atOrBefore(grant.from, subject.occurredAt)) return false;
    if (grant.to !== undefined && !atOrBefore(subject.occurredAt, grant.to)) return false;
  }
  return true;
}

/**
 * The retraction a correction owes a peer when the correction itself will not travel
 * (ADR-16 §Open questions, founder's option (a), 2026-09-24).
 *
 * Two shapes reach it: a supersede that moves `occurred_at` out of a grant's period, and a
 * `reclassify` to a kind the grant or its projection does not carry (a meter photo corrected to a
 * meal under a band share). In both the peer may hold the replaced row, and before this nothing
 * told it the row had been replaced, so the old reading stayed current on its screen for good.
 *
 * **The retraction is a tombstone with the correction's own id**, targeting the replaced row and
 * carrying its kind and time exactly as `tombstone()` would have written them. The id is what
 * keeps the cursor invariant: it is a real ULID in this device's log, so `max(id)` still means
 * what `store.ts` says, and re-sending it is idempotent. The receiver's `current_entries` hides
 * the old row the moment it lands, which is the same mechanism a deletion uses.
 *
 * **Null when the replaced row's kind and time are unknown** (a row written before migration
 * `0010_`), which is the behaviour before this existed: the correction travels if it is in scope
 * and nothing is retracted if it is not. The caller decides scope; this only builds the row.
 */
function retractionFor(row: SyncEntry): SyncEntry | null {
  if (row.supersedesId === null || row.kind === 'tombstone') return null;
  const kind = row.supersededKind;
  if (kind === null || kind === undefined) return null;
  // A replaced row of a kind that never travels was never on the peer, so there is nothing to
  // retract, and saying so would describe the patient's own control log.
  if (!travelsUnderGrant(kind)) return null;
  const payload: { targetId: string; targetKind: string; targetOccurredAt?: string } = {
    targetId: row.supersedesId,
    targetKind: kind,
  };
  if (row.supersededOccurredAt !== null && row.supersededOccurredAt !== undefined) {
    payload.targetOccurredAt = row.supersededOccurredAt;
  }
  return {
    id: row.id,
    kind: 'tombstone',
    occurredAt: row.recordedAt,
    recordedAt: row.recordedAt,
    deviceId: row.deviceId,
    source: 'manual',
    supersedesId: null,
    targetId: row.supersedesId,
    payload: JSON.stringify(payload),
    glucoseMgdl: null,
    aiModelId: null,
    aiSuggestion: null,
  };
}

/**
 * The view a grant produces, which is what the session sends through: rows outside the grant's
 * kinds or period are not sent, control rows never are, and what remains is projected by the
 * grant's view (and any `alsoViews`). A correction that will not travel is replaced by the
 * retraction it owes the peer. Throws `RangeError` when a view is not registered or the views
 * overlap, and a view that needs something from `context` throws when it is missing.
 */
export function grantView(grant: GrantPayload, context: ViewContext = {}): RowView {
  const projection = combinedProjection(grant, context);

  return {
    name: `grant:${projection.name}`,
    attachments: projection.attachments && grant.attachments,
    project: (row) => {
      // The patient's own control rows are the patient's business (`travelsUnderGrant`).
      if (!travelsUnderGrant(row.kind)) return null;

      // Scope is a question about the row a patient shared, so a retraction is scoped by what it
      // retracts. `kinds: ['tombstone']` therefore matches nothing, which is correct: a
      // retraction is not a thing a patient shares, it is news about one.
      const shown = inGrantScope(grant, scopeSubjectOf(row)) ? projection.project(row) : null;
      if (shown !== null) return shown;

      // The correction does not travel. If what it replaced did, the peer is holding a row the
      // patient has since corrected, and it is told the way a deletion tells it. Scoped by the
      // *replaced* row on both counts (the grant's kinds and period, and the projection's own
      // carried kind), so a correction of a row this peer never had sends nothing at all.
      const retraction = retractionFor(row);
      if (retraction === null || !inGrantScope(grant, scopeSubjectOf(retraction))) return null;
      return projection.project(retraction);
    },
  };
}

/**
 * What a peer is currently entitled to, from the patient's own log.
 *
 * Three states rather than two, because a share that has ended is not the same as a share that
 * never existed: an ended one still owes the peer one last thing, which is the news that it
 * ended (§1, founder call of 2026-09-18 — *tell them, but do not alert them*).
 *
 * Later grants win, and a revocation covering this peer ends the story — so the answer is a fold
 * over the log rather than a field somebody has to remember to clear.
 */
export type GrantState =
  | { readonly status: 'active'; readonly grant: GrantPayload }
  | { readonly status: 'revoked'; readonly revocationIds: readonly string[] }
  | { readonly status: 'none' };

/**
 * Folds the log into where the share with `peerKey` (bytes or lowercase hex) stands: the latest
 * grant naming that peer, ended by any later revocation that names that peer or nobody. Always
 * `none` when `authors` is false. Throws when a grant or revocation row's payload is not JSON.
 */
export function resolveGrantState(
  rows: Iterable<SyncEntry>,
  peerKey: Uint8Array | string,
  /**
   * Whether these rows are **this account's own acts** (ADR-15 §4, ADR-18 §1, §7).
   *
   * **A boolean rather than a list of device ids, and `SessionOptions.authors` already said
   * why.** *"An account is a database, so every log inside one is the same person's: on a
   * `mine` account they are the patient's own, including logs restored from an older phone
   * under a different `device_id` — which a list of ids would have broken, because ADR-15 §4
   * explicitly covers the restored phone. On a `held` account none of them are."*
   *
   * This parameter was a list of device ids for about an hour on 2026-09-22, which is exactly
   * the defect that comment warns against: a patient who replaced her phone and restored her
   * `.tappbak` has grant rows under the old id, and a list containing only the new one would
   * have folded them away and reported every one of her shares as never having happened. That
   * is worse than the bug it was added to fix.
   *
   * **Required, with no default**, for the same reason `authors` is: `true` by default is the
   * behaviour being replaced waiting for somebody to forget, and `false` by default is a
   * patient whose sharing silently disappeared.
   *
   * What it is for: a **held** account has granted nothing, because it authors nothing (§7).
   * Fold its rows — a patient's archive restored into it under §1.4 contains grant rows — and
   * this would answer "active" for a share this install cannot have made. Wrong on a
   * relationship screen, and worse anywhere it drives sending, since `viewForState` would hand
   * back a live view for a record this install only holds.
   */
  authors: boolean,
): GrantState {
  const peer = typeof peerKey === 'string' ? peerKey : bytesToHex(peerKey);
  if (!authors) return { status: 'none' };
  let grant: { row: SyncEntry; payload: GrantPayload } | null = null;
  const revocations: SyncEntry[] = [];

  for (const row of rows) {
    if (row.kind === 'grant') {
      const parsed = grantPayloadSchema.safeParse(JSON.parse(row.payload));
      if (!parsed.success || parsed.data.peer !== peer) continue;
      if (grant === null || row.id > grant.row.id) grant = { row, payload: parsed.data };
      continue;
    }
    if (row.kind === 'revoke') {
      const parsed = revocationPayloadSchema.safeParse(JSON.parse(row.payload));
      // A revocation that names another peer is not this peer's business and does not end this
      // peer's grant. One that names nobody ends every share, which is the "stop sharing with
      // everyone" case.
      if (parsed.success && (parsed.data.peer === undefined || parsed.data.peer === peer)) {
        revocations.push(row);
      }
    }
  }

  if (grant === null) return { status: 'none' };
  const ending = revocations.filter((row) => row.id > grant.row.id);
  if (ending.length > 0) return { status: 'revoked', revocationIds: ending.map((row) => row.id) };
  return { status: 'active', grant: grant.payload };
}

/** The grant in force, or null once it has ended. */
export function resolveGrant(
  rows: Iterable<SyncEntry>,
  peerKey: Uint8Array | string,
  authors: boolean,
): GrantPayload | null {
  const state = resolveGrantState(rows, peerKey, authors);
  return state.status === 'active' ? state.grant : null;
}

/**
 * The view to sync a peer under, given where the relationship stands.
 *
 * **A revoked grant still has a view**, and it carries exactly one thing: the revocation itself.
 * The founder's decision of 2026-09-18 is that a peer is told when sharing stops — a caretaker
 * who quietly stops receiving readings would otherwise be left wondering whether the patient is
 * unwell, which is a worse silence than the one it saves.
 *
 * **Told, not alerted.** The revocation arrives as a row and the receiving app shows it where
 * the relationship is shown; it never raises a notification and never interrupts. ADR-09 §B
 * governs that on the receiving side: there are no loss states in this app, nothing is
 * "stopped" at somebody in a banner, and a family member is not pinged to be told that a
 * patient has changed their mind about their own data.
 *
 * Once the peer's cursor has passed the revocation, there is nothing further to send and later
 * sessions send nothing — the farewell happens once, without anything tracking that it did.
 */
export function viewForState(state: GrantState, context: ViewContext = {}): RowView | null {
  if (state.status === 'none') return null;
  if (state.status === 'active') return grantView(state.grant, context);

  const ending = new Set(state.revocationIds);
  return {
    name: 'grant:revoked',
    attachments: false,
    project: (row) => (row.kind === 'revoke' && ending.has(row.id) ? row : null),
  };
}
