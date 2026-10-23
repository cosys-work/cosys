/**
 * The check a receiving account runs on a row of this modality before it lands: that it came
 * from its writer, is for this account, and passes the gate here.
 *
 * @module
 */
import type { SyncEntry } from '@cosys/record/row';

import { reaches } from './audience.ts';
import { postGateProblems, type PostLookup, type PostRefusal } from './gate.ts';
import { isPostKind } from './kinds.ts';
import { authorOf, collaboratorsOf, parsePostPayload } from './schema.ts';

/**
 * Whether a row of this modality that arrived from `sender` may land (founder, 2026-10-22: "Every
 * family member can make posts that chronologically get added to your list. Clinics, gym, labs,
 * doctors etc can also post once they are in a patient's trust circle").
 *
 * The trust circle is the transport's to decide: a row arrives only from a peer this account
 * paired with, which is a family member, a clinic or any other unit the patient confirmed a code
 * with. What this decides is the rest:
 *
 * - **it came from who wrote it**: its author, or for a new version of a post a collaborator the
 *   post names, since nobody forwards another unit's row (ADR-15 §4; `audienceRoute`);
 * - **it is for this account**: addressed to it, or to a cohort this account is in, by the
 *   memberships this account holds;
 * - **it passes the gate here**: it cites nothing this account holds outside the modality, and
 *   carries no file a record here carries (ADR-24 §3).
 */
export type PostArrivalRefusal = 'not_from_author' | 'not_for_this_account' | PostRefusal;

/** What the receiving account knows about a row that arrived, for `postArrivalRefusal`. */
export interface PostArrivalContext {
  /** The paired unit the row came from, by key. */
  readonly sender: string;
  /** This account's own key. */
  readonly self: string;
  /** The cohorts this account knows, with their members (`cohortMembers`). */
  readonly cohorts: ReadonlyMap<string, ReadonlySet<string>>;
  /** This account's store, for the gate. */
  readonly lookup: PostLookup;
  /** The sha256 of each attachment the row says it carries. */
  readonly attachments?: readonly string[];
}

/**
 * Why a row that arrived from `context.sender` may not land here, or `null` when it may. The
 * checks run in the order `PostArrivalRefusal` lists them, and the first refusal found is returned.
 */
export function postArrivalRefusal(
  row: Pick<SyncEntry, 'kind' | 'payload'>,
  context: PostArrivalContext,
): PostArrivalRefusal | null {
  if (!isPostKind(row.kind)) return 'shape';
  const payload = parsePostPayload(row.kind, row.payload);
  if (payload === null) return 'shape';
  const writer =
    authorOf(payload) === context.sender ||
    (row.kind === 'public:post' && collaboratorsOf(payload).includes(context.sender));
  if (!writer) return 'not_from_author';
  if (!reaches(payload, context.self, context.cohorts)) return 'not_for_this_account';
  return postGateProblems(row, context.attachments ?? [], context.lookup)[0] ?? null;
}
