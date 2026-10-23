/**
 * **A `public:` row is authored, never derived** (ADR-24 §3; the Cat Pub handoff's fence).
 *
 * A post may say "my sugar was fine today" in words its author typed; it may not cite the
 * reading. So a post, a reaction or a reshare may answer or be about another `public:` row and
 * nothing else, and may carry only attachments of its own: a photograph that is also attached to
 * a reading, a lab result, a clinic's row or a view is a record being published under another
 * name (founder, F5, 2026-10-22). That one rule is what keeps this modality from reopening ADR-15
 * §4 (a peer forwards only what it authored) and ADR-16 §5 (no relay grants): nothing a post
 * carries was ever anything but a post.
 *
 * The gate runs where a row can still be stopped: when one is written (`create.ts`), and in the
 * route each row passes before it is sealed for a peer (`audience.ts`). It reads the sender's own
 * store through `PostLookup`, because whether an id names a post is a fact about the store and
 * not about the payload; a row citing something the sender does not hold is refused for the same
 * reason. `check-share-gate.mjs` rule 5 holds the route to asking it.
 *
 * @module
 */
import type { SyncEntry } from '@cosys/record/row';

import { isPostKind, isPublicKind } from './kinds.ts';
import { citesOf, parsePostPayload } from './schema.ts';

/** The sender's store, as far as the gate needs it. */
export interface PostLookup {
  /** The kind of a row this store holds, or undefined when it holds none by that id. */
  kindOf(id: string): string | undefined;
  /** The kinds of every row this store holds that carries the attachment named by its sha256. */
  kindsCarrying(sha256: string): readonly string[];
}

/** Why the gate refuses a row. */
export type PostRefusal =
  /** Not a row of this modality, or not the shape its kind says. */
  | 'shape'
  /** It answers or is about a row the sender does not hold. */
  | 'cites_unheld'
  /** It answers or is about a row that is not a `public:` row. */
  | 'cites_non_public'
  /** It carries an attachment that a row outside the `public:` class carries too. */
  | 'attachment_non_public';

/** Why `row` may not be written or sent, with `attachments` the sha256 of each one it carries; empty when it may. */
export function postGateProblems(
  row: Pick<SyncEntry, 'kind' | 'payload'>,
  attachments: readonly string[],
  lookup: PostLookup,
): readonly PostRefusal[] {
  if (!isPostKind(row.kind)) return ['shape'];
  const payload = parsePostPayload(row.kind, row.payload);
  if (payload === null) return ['shape'];
  const problems = new Set<PostRefusal>();
  for (const cited of citesOf(payload)) {
    const kind = lookup.kindOf(cited);
    if (kind === undefined) problems.add('cites_unheld');
    else if (!isPublicKind(kind)) problems.add('cites_non_public');
  }
  for (const sha256 of attachments) {
    if (lookup.kindsCarrying(sha256).some((kind) => !isPublicKind(kind)))
      problems.add('attachment_non_public');
  }
  return [...problems];
}
