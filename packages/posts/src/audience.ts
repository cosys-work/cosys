/**
 * Who a post reaches (ADR-24 §2, Accepted 2026-10-22).
 *
 * **A cohort is a unit with a key of its own** (founder, F4): a family, a clinic's diabetes group.
 * Its members are the units it says are in it, each by a `paired_with` assertion the cohort's key
 * signed about the member (ADR-23 §5; the claim vocabulary is unchanged and carries no number).
 * So "post to my family" and "post to my clinic's group" are the same act with a different
 * `audience`, and a person is the degenerate cohort of one.
 *
 * **The author delivers.** A post to a cohort is sealed for each member the author knows to be in
 * it, from the membership assertions the author holds, and sent by the transports every other row
 * uses. Nothing relays it: ADR-15 §4 has a device forward only what it authored, and a cohort that
 * re-sent its members' posts would be forwarding. *Rejected:* a cohort mailbox that re-deposits
 * to its members (one deposit per post, but the cohort's holder would forward rows it did not
 * write, and would see who reads what).
 *
 * @module
 */
import type { SyncEntry } from '@cosys/record/row';
import { assertPayloadSchema, type AssertPayload } from '@cosys/record/schema/assert';
import type { RowView } from '@cosys/record/views';

import { isPostKind } from './kinds.ts';
import { postGateProblems, type PostLookup } from './gate.ts';
import { audienceOf, authorOf, parsePostPayload, type AnyPostPayload } from './schema.ts';

/**
 * The members of each cohort, from assertions already verified (`@cosys/peer`'s
 * `verifyAssertion`): every `paired_with` a cohort's key signed about a unit's key, inside its
 * dates, and not since revoked. A cohort is any signer of one; this function does not decide whose
 * cohorts to believe, the caller does by which assertions it passes.
 *
 * **A membership ends by a revocation** (founder, 2026-10-22, ADR-24 call 5): a `revoked`
 * assertion signed by the same cohort key, whose `subject` is the `paired_with` row. Any holder of
 * the cohort's key signs one; nothing expires on its own.
 */
export function cohortMembers(
  verified: readonly { readonly id: string; readonly payload: AssertPayload }[],
  now: number = Date.now(),
): ReadonlyMap<string, ReadonlySet<string>> {
  const revoked = new Set<string>();
  for (const { payload } of verified) {
    if (payload.assertion.claim !== 'revoked') continue;
    for (const ref of payload.assertion.refs) {
      if (ref.role === 'subject' && ref.kind === 'entry')
        revoked.add(`${payload.signer} ${ref.to}`);
    }
  }
  const members = new Map<string, Set<string>>();
  for (const { id, payload } of verified) {
    const { signer, assertion } = payload;
    if (assertion.claim !== 'paired_with') continue;
    if (revoked.has(`${signer} ${id}`)) continue;
    if (Date.parse(assertion.validFrom) > now) continue;
    if (assertion.validUntil !== undefined && Date.parse(assertion.validUntil) <= now) continue;
    for (const ref of assertion.refs) {
      if (ref.role !== 'subject' || ref.kind !== 'key') continue;
      const set = members.get(signer) ?? new Set<string>();
      set.add(ref.to);
      members.set(signer, set);
    }
  }
  return members;
}

/**
 * Every unit each cohort has ever named in a `paired_with`, revoked or not, by cohort key. This is
 * who hears about the cohort's membership: a member who was removed is told by the revocation, so
 * the list it is sent to must still name them.
 */
export function cohortUnits(
  verified: readonly { readonly payload: AssertPayload }[],
): ReadonlyMap<string, ReadonlySet<string>> {
  const named = new Map<string, Set<string>>();
  for (const { payload } of verified) {
    if (payload.assertion.claim !== 'paired_with') continue;
    for (const ref of payload.assertion.refs) {
      if (ref.role !== 'subject' || ref.kind !== 'key') continue;
      const set = named.get(payload.signer) ?? new Set<string>();
      set.add(ref.to);
      named.set(payload.signer, set);
    }
  }
  return named;
}

/**
 * A cohort's membership row: a `paired_with` or a `revoked` some key signed, or null.
 *
 * **A membership names units and nothing else**: every ref of a `paired_with` is a `subject` by
 * key. A patient's pairing with a bridge is a `paired_with` too, but it names the foreign subject
 * as an `origin` (`bridgePairingAssertion`), and read as a membership it would make the bridge a
 * member of a "cohort" keyed by the patient, and route the patient's posts to it.
 */
export function membershipOf(row: Pick<SyncEntry, 'kind' | 'payload'>): AssertPayload | null {
  if (row.kind !== 'assert') return null;
  let json: unknown;
  try {
    json = JSON.parse(row.payload);
  } catch {
    return null;
  }
  const parsed = assertPayloadSchema.safeParse(json);
  if (!parsed.success) return null;
  const { claim, refs } = parsed.data.assertion;
  if (claim === 'revoked') return parsed.data;
  if (claim !== 'paired_with') return null;
  return refs.every((ref) => ref.role === 'subject' && ref.kind === 'key') ? parsed.data : null;
}

/**
 * Whether `peer` is in the audience, by its own key or as a member of a cohort in it, or wrote
 * the row: an author's other device holds what the author wrote, as it holds the rest of the log.
 */
export function reaches(
  payload: AnyPostPayload,
  peer: string,
  cohorts: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  if (authorOf(payload) === peer) return true;
  return audienceOf(payload).some((unit) => unit === peer || cohorts.get(unit)?.has(peer) === true);
}

/**
 * What `audienceRoute` needs to route rows to one peer: the peer, the sender, the cohorts it
 * knows and its store.
 */
export interface AudienceRouteOptions {
  /** The peer this view is for, by identity key. */
  readonly peer: string;
  /** The sending account's own key: the author whose posts it sends. */
  readonly self: string;
  /** The sending install's device id: a version it wrote of someone else's post is its to send. */
  readonly device: string;
  /** The cohorts the sender knows, with their members (`cohortMembers`). */
  readonly cohorts: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * The cohorts whose key this account holds, with every unit each has named (`cohortUnits`).
   * Their membership rows go to those units; a membership this account only received stays here.
   */
  readonly holds?: ReadonlyMap<string, ReadonlySet<string>>;
  /** The sender's store, for the gate. */
  readonly lookup: PostLookup & {
    /** A row this store holds, for the retraction of one. */
    rowOf(id: string): Pick<SyncEntry, 'kind' | 'payload'> | undefined;
  };
  /** The sha256 of every attachment a row carries. */
  attachmentsOf(entryId: string): readonly string[];
}

/**
 * The route a row of this modality takes to one peer, around the view the peer's grant gives it.
 *
 * A post, a reaction or a reshare goes to this peer when the peer is in its audience and the row
 * passes the gate, and to nobody otherwise, whatever the grant says.
 *
 * **Only what this account wrote leaves it** (ADR-15 §4): a post whose author is this account, or
 * a version this install wrote of a post someone else began, as a collaborator does. A family
 * member's post that landed here is never sent on, so a post reaches the people its author can
 * reach and no one through anyone else. A cohort's membership rows go to the units the cohort has
 * named, from the account that holds its key and from nowhere else. A retraction of one goes
 * where the row it retracts went: the audience of that row, and not a full-view peer who never
 * had it, which would otherwise learn that a post existed. Every other row is the inner view's
 * to decide, as the clinic's reply route leaves them (`@tapp/record`'s `clinic-rows.ts`).
 *
 * **Attachments follow the inner view**, as the session sends them for a whole view: a post's
 * photograph reaches a peer whose session carries attachments. Deciding attachments row by row,
 * which a post to a cohort member with no grant would need, is a change to the substrate's view
 * and is owed (ADR-24 §4).
 */
export function audienceRoute(options: AudienceRouteOptions, inner: RowView): RowView {
  const addressedHere = (
    row: Pick<SyncEntry, 'kind' | 'payload'>,
    id: string,
    writtenBy: string,
  ): boolean => {
    if (!isPostKind(row.kind)) return false;
    const payload = parsePostPayload(row.kind, row.payload);
    if (payload === null) return false;
    if (authorOf(payload) !== options.self && writtenBy !== options.device) return false;
    if (postGateProblems(row, options.attachmentsOf(id), options.lookup).length > 0) return false;
    return reaches(payload, options.peer, options.cohorts);
  };
  return {
    name: inner.name,
    attachments: inner.attachments,
    project(row) {
      if (isPostKind(row.kind)) return addressedHere(row, row.id, row.deviceId) ? row : null;
      if (row.kind === 'tombstone' && row.targetId !== null) {
        const retracted = options.lookup.rowOf(row.targetId);
        if (retracted !== undefined && isPostKind(retracted.kind)) {
          return addressedHere(retracted, row.targetId, row.deviceId) ? row : null;
        }
      }
      const membership = membershipOf(row);
      if (membership !== null) {
        const named = options.holds?.get(membership.signer);
        if (named !== undefined) return named.has(options.peer) ? row : null;
      }
      return inner.project(row);
    },
  };
}
