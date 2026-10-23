/**
 * What a post, a reaction and a reshare say (ADR-24 §1, Accepted 2026-10-22).
 *
 * Each writes its `refs` explicitly (ADR-23 §2): a kind added after that ADR names what it joins
 * in its payload rather than in fields a derivation has to know. Every one names **one author** (a
 * unit's key) and **at least one audience** (unit keys: a person, or a cohort, which is a unit
 * too; ADR-24 §2, founder F4). A post may answer one row (`reply_to`) and name people
 * (`mention`); a reaction and a reshare are about one row (`subject`). Whether the rows they cite
 * are posts is the gate's question (`gate.ts`), because a payload cannot see what an id names.
 *
 * **One row is at most 64 KiB on the wire** (`@cosys/record/row`), so a post is bounded by that
 * and not by a count of its own: `POST_TEXT_MAX` leaves room for the refs, and `createPost`
 * refuses a payload that would not fit. A longer text is several posts.
 *
 * @module
 */
import { incidenceSchema, type Incidence } from '@cosys/record/refs';
import { z } from 'zod';

// The roles a post names are this modality's, registered before any payload is parsed.
import './kinds.ts';
import type { PostKind } from './kinds.ts';

/** The longest a post's or a reshare's words may be, in UTF-16 code units. */
export const POST_TEXT_MAX = 32_000;

/**
 * A reaction is a mark, not a message: any Unicode emoji, or a word (founder, 2026-10-22, ADR-24
 * call 3). Free, not a closed set. Counted in code points, not UTF-16 units, so the longest emoji
 * sequences (a kiss with two skin tones is ten code points and fifteen units) fit with room.
 */
export const REACTION_MAX = 16;

const codePoints = (text: string): number => [...text].length;

/** The serialised payload a row may carry (`jsonText` in `@cosys/record/row`). */
export const PAYLOAD_MAX = 64 * 1024;

const refs: z.ZodArray<typeof incidenceSchema> = z.array(incidenceSchema).min(2).max(64);

interface Shape {
  /** The roles this kind may name, beside `author` and `audience`. */
  readonly also: readonly string[];
  /** Whether it is about exactly one row (`subject`). */
  readonly subject: boolean;
}

function addressed(shape: Shape) {
  return (payload: { readonly refs: readonly Incidence[] }, ctx: z.RefinementCtx) => {
    const named = (role: string) => payload.refs.filter((ref) => ref.role === role);
    const allowed = new Set([
      'author',
      'audience',
      ...shape.also,
      ...(shape.subject ? ['subject'] : []),
    ]);
    for (const ref of payload.refs) {
      if (!allowed.has(ref.role))
        ctx.addIssue({ code: 'custom', message: `a ${ref.role} has no place here` });
    }
    const authors = named('author');
    if (authors.length !== 1 || authors[0]!.kind !== 'key') {
      ctx.addIssue({ code: 'custom', message: 'one author, by key' });
    }
    const audience = named('audience');
    if (audience.length === 0 || audience.some((ref) => ref.kind !== 'key')) {
      ctx.addIssue({ code: 'custom', message: 'an audience of at least one unit, by key' });
    }
    if (named('mention').some((ref) => ref.kind !== 'key')) {
      ctx.addIssue({ code: 'custom', message: 'a mention names a unit, by key' });
    }
    const answers = named('reply_to');
    if (answers.length > 1 || answers.some((ref) => ref.kind !== 'entry')) {
      ctx.addIssue({ code: 'custom', message: 'a reply answers one row' });
    }
    const subjects = named('subject');
    if (shape.subject && (subjects.length !== 1 || subjects[0]!.kind !== 'entry')) {
      ctx.addIssue({ code: 'custom', message: 'about exactly one row' });
    }
  };
}

/**
 * Who learns that a post was opened (founder, 2026-10-22, ADR-24 §7): nobody, the author, or the
 * whole audience. Each post chooses; nobody is the default, and a post written before the setting
 * existed reads as nobody.
 */
export const VIEW_SETTINGS = ['none', 'author', 'audience'] as const;
/** One of `VIEW_SETTINGS`. */
export type ViewSetting = (typeof VIEW_SETTINGS)[number];

/**
 * A post's editing state (founder, 2026-10-22, ADR-24 §7): the Yjs document its editor last held,
 * as a base64 update, so that versions written apart by the author and a collaborator merge when
 * either opens the post again instead of the later one winning. Opaque here; only an editor reads
 * it. Optional, because the words are the post: a version too long to carry both is written
 * without it (`createPost`), and an editor that finds none starts from the words.
 */
export const postDocSchema: z.ZodString = z
  .string()
  .min(1)
  .max(PAYLOAD_MAX)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, { message: 'a document is base64' });

/**
 * The words of a post are **GitHub-flavoured Markdown** (founder, 2026-10-22): headings, emphasis,
 * lists and task lists, quotes, tables, code, links, and photographs as `![](attachment:<id>)`
 * naming one of the post's own files (`markdown.ts`). A post written before that is plain text,
 * which reads the same as Markdown with nothing marked up.
 */
export const postPayloadSchema: z.ZodObject<
  {
    refs: typeof refs;
    text: z.ZodString;
    views: z.ZodOptional<z.ZodEnum<z.core.util.ToEnum<ViewSetting>>>;
    doc: z.ZodOptional<z.ZodString>;
  },
  z.core.$strict
> = z
  .strictObject({
    refs,
    text: z.string().min(1).max(POST_TEXT_MAX),
    views: z.enum(VIEW_SETTINGS).optional(),
    doc: postDocSchema.optional(),
  })
  .superRefine(addressed({ also: ['reply_to', 'mention', 'collaborator'], subject: false }));

/**
 * A reaction's payload: its refs, with one `subject`, and the mark, at most `REACTION_MAX` code
 * points.
 */
export const reactionPayloadSchema: z.ZodObject<
  { refs: typeof refs; reaction: z.ZodString },
  z.core.$strict
> = z
  .strictObject({
    refs,
    reaction: z
      .string()
      .min(1)
      .refine((mark) => codePoints(mark) <= REACTION_MAX, { message: 'reaction too long' }),
  })
  .superRefine(addressed({ also: [], subject: true }));

/**
 * A reshare's payload: its refs, with one `subject` and any mentions, and optional words of its
 * own.
 */
export const resharePayloadSchema: z.ZodObject<
  { refs: typeof refs; text: z.ZodOptional<z.ZodString> },
  z.core.$strict
> = z
  .strictObject({ refs, text: z.string().min(1).max(POST_TEXT_MAX).optional() })
  .superRefine(addressed({ also: ['mention'], subject: true }));

/** Up or down, on one row of this modality. A changed mind is a supersede, as for every row. */
export const VOTES = ['up', 'down'] as const;
/** One of `VOTES`. */
export type Vote = (typeof VOTES)[number];

/** A vote's payload: its refs, with one `subject`, and the vote. */
export const votePayloadSchema: z.ZodObject<
  { refs: typeof refs; vote: z.ZodEnum<z.core.util.ToEnum<Vote>> },
  z.core.$strict
> = z
  .strictObject({ refs, vote: z.enum(VOTES) })
  .superRefine(addressed({ also: [], subject: true }));

/** That its author opened one post, addressed to whoever that post says learns it. */
export const viewPayloadSchema: z.ZodObject<{ refs: typeof refs }, z.core.$strict> = z
  .strictObject({ refs })
  .superRefine(addressed({ also: [], subject: true }));

/** Each kind's payload schema, by kind. */
export const POST_PAYLOAD_SCHEMAS: {
  readonly 'public:post': typeof postPayloadSchema;
  readonly 'public:reaction': typeof reactionPayloadSchema;
  readonly 'public:reshare': typeof resharePayloadSchema;
  readonly 'public:vote': typeof votePayloadSchema;
  readonly 'public:view': typeof viewPayloadSchema;
} = {
  'public:post': postPayloadSchema,
  'public:reaction': reactionPayloadSchema,
  'public:reshare': resharePayloadSchema,
  'public:vote': votePayloadSchema,
  'public:view': viewPayloadSchema,
} as const satisfies Record<PostKind, z.ZodType>;

/** A post's payload, as parsed. */
export type PostPayload = z.infer<typeof postPayloadSchema>;
/** A reaction's payload, as parsed. */
export type ReactionPayload = z.infer<typeof reactionPayloadSchema>;
/** A reshare's payload, as parsed. */
export type ResharePayload = z.infer<typeof resharePayloadSchema>;
/** A vote's payload, as parsed. */
export type VotePayload = z.infer<typeof votePayloadSchema>;
/** A view's payload, as parsed. */
export type ViewPayload = z.infer<typeof viewPayloadSchema>;
/** The payload of any kind of this modality. */
export type AnyPostPayload =
  PostPayload | ReactionPayload | ResharePayload | VotePayload | ViewPayload;

/** The payload of a row of this modality, or null when it is not one this kind may carry. */
export function parsePostPayload(kind: PostKind, payload: string): AnyPostPayload | null {
  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    return null;
  }
  const parsed = POST_PAYLOAD_SCHEMAS[kind].safeParse(json);
  return parsed.success ? parsed.data : null;
}

const keysAs = (payload: AnyPostPayload, role: string) =>
  payload.refs.filter((ref) => ref.role === role).map((ref) => ref.to);

/** Who wrote it. */
export function authorOf(payload: AnyPostPayload): string {
  return keysAs(payload, 'author')[0]!;
}

/** The units it is for. */
export function audienceOf(payload: AnyPostPayload): readonly string[] {
  return keysAs(payload, 'audience');
}

/** The rows it cites: the one it answers, or the one it is about. */
export function citesOf(payload: AnyPostPayload): readonly string[] {
  return payload.refs
    .filter((ref) => ref.role === 'reply_to' || ref.role === 'subject')
    .map((ref) => ref.to);
}

/** The units a post names as collaborators: who besides its author may write a new version. */
export function collaboratorsOf(payload: AnyPostPayload): readonly string[] {
  return keysAs(payload, 'collaborator');
}

/**
 * Whether `writer` may write a new version of `post` (founder, 2026-10-22, ADR-24 §7): its author
 * or a collaborator it names. Each version is signed by whoever wrote it and the original is kept,
 * as every supersede keeps it; a collaborator cannot change who the post is for or who may edit
 * it, so the audience and the collaborators of the new version must be the old one's.
 */
export function mayRevise(post: PostPayload, revision: PostPayload, writer: string): boolean {
  if (authorOf(post) !== authorOf(revision)) return false;
  if (writer !== authorOf(post) && !collaboratorsOf(post).includes(writer)) return false;
  if (writer === authorOf(post)) return true;
  const same = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && [...a].sort().every((value, index) => value === [...b].sort()[index]);
  return (
    same(audienceOf(post), audienceOf(revision)) &&
    same(collaboratorsOf(post), collaboratorsOf(revision)) &&
    (post.views ?? 'none') === (revision.views ?? 'none')
  );
}

/** Who learns a post was opened, defaulting to nobody. */
export function viewSettingOf(post: PostPayload): ViewSetting {
  return post.views ?? 'none';
}
