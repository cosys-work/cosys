/**
 * What the posts modality registers with the substrate (ADR-24 §1, Accepted 2026-10-22).
 * Importing this module registers its kinds and roles with `@cosys/record`.
 *
 * **Three kinds.** A post, a reaction to a row of this modality, and a reshare of one. A
 * retraction is the substrate's tombstone and an edit is a supersede, as for every row.
 *
 * **None travels under an ordinary grant.** A daughter with a full view of her mother's record
 * does not receive every post her mother writes to the clinic's group: a post goes to the
 * audience it names, by `audienceRoute` (`audience.ts`), and to nobody else. That is the
 * `TRAVELS` answer this modality registers, and it is the same answer the clinic's replies give
 * for the same reason (a row with a route of its own). None is a control kind: a post is a
 * record of what someone wrote, and a revocation or an erasure reaches it like any other.
 *
 * **Four roles** beside the substrate's core (ADR-23 §2 as amended 2026-10-21, founder call 2):
 * who wrote it, who it is for, what it answers and who it names. A reaction and a reshare name
 * the row they are about with the core's `subject`.
 *
 * *Added 2026-10-22 (founder, ADR-24 §7):* **a vote** (up or down, on a row of this modality;
 * totals shown, nothing ordered by them), **a view** (that someone opened a post, written only
 * when the post asks for it), and a fifth role, **`collaborator`**: someone the author named who
 * may write new versions of the post.
 *
 * @module
 */
import { registerKinds, type KindSpec } from '@cosys/record/kinds';
import { registerRefRoles } from '@cosys/record/refs';

/** The modality's name, under which its kinds and roles are registered. */
export const POSTS = 'posts';

/** The kinds of this modality: a post, a reaction, a reshare, a vote and a view. */
export const POST_KINDS = [
  'public:post',
  'public:reaction',
  'public:reshare',
  'public:vote',
  'public:view',
] as const;

/** One of this modality's kinds. */
export type PostKind = (typeof POST_KINDS)[number];

/** The roles this modality registers beside the substrate's core ones. */
export const POST_REF_ROLES = [
  'author',
  'audience',
  'reply_to',
  'mention',
  'collaborator',
] as const;

/** One of the roles this modality registers. */
export type PostRefRole = (typeof POST_REF_ROLES)[number];

const SPECS: { readonly [K in PostKind]: KindSpec } = {
  'public:post': { travels: false },
  'public:reaction': { travels: false },
  'public:reshare': { travels: false },
  'public:vote': { travels: false },
  'public:view': { travels: false },
};

registerKinds(POSTS, SPECS);
registerRefRoles(POSTS, POST_REF_ROLES);

/** Whether `kind` is one of this modality's kinds. */
export function isPostKind(kind: string): kind is PostKind {
  return (POST_KINDS as readonly string[]).includes(kind);
}

/**
 * The `public:` class: rows written to be read by an audience. Only this modality registers a
 * kind in it (`check-share-gate.mjs` rule 5), and only this class may ever have an outward
 * `TRAVELS` answer of yes (ADR-22 §5, which stays closed until the founder opens it).
 */
export function isPublicKind(kind: string): boolean {
  return kind.startsWith('public:');
}
