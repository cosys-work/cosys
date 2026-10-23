/**
 * Writing a post, a reaction or a reshare (ADR-24 §1). Each is a row in its author's own log, so
 * it merges by ULID, travels either transport, and is retracted with the substrate's tombstone
 * like any other. The gate runs before the row exists: a post that cites a record is never
 * written, rather than written and then withheld.
 *
 * @module
 */
import { ulid } from '@cosys/crypto/ulid';
import { entryRef, keyRef, normaliseRefs, type Incidence } from '@cosys/record/refs';
import type { SyncEntry } from '@cosys/record/row';

import { postGateProblems, type PostLookup } from './gate.ts';
import type { PostKind } from './kinds.ts';
import {
  audienceOf,
  authorOf,
  mayRevise,
  PAYLOAD_MAX,
  parsePostPayload,
  POST_PAYLOAD_SCHEMAS,
  viewSettingOf,
  type PostPayload,
  type ViewSetting,
  type Vote,
} from './schema.ts';

/** The unit writing, and the device it writes from. */
export interface PostAuthor {
  /** The author's identity key, lowercase hex. */
  readonly key: string;
  /** The id of the install writing, recorded as the row's `deviceId`. */
  readonly deviceId: string;
}

/**
 * Thrown when a row of this modality cannot be written: it fails its kind's schema, would not fit
 * in one row, or does not pass the gate. No row is returned.
 */
export class PostRefused extends Error {
  /** A refusal carrying every reason found: schema messages, or the gate's `PostRefusal` codes. */
  constructor(readonly problems: readonly string[]) {
    super(`this row cannot be written: ${problems.join(', ')}`);
  }
}

function write(
  kind: PostKind,
  author: PostAuthor,
  refs: readonly Incidence[],
  body: Record<string, unknown>,
  lookup: PostLookup,
  now: number,
  supersedesId: string | null = null,
): SyncEntry {
  const parsed = POST_PAYLOAD_SCHEMAS[kind].safeParse({ refs: normaliseRefs(refs), ...body });
  if (!parsed.success) throw new PostRefused(parsed.error.issues.map((issue) => issue.message));
  const payload = JSON.stringify(parsed.data);
  if (payload.length > PAYLOAD_MAX) throw new PostRefused([TOO_LONG]);
  const problems = postGateProblems({ kind, payload }, [], lookup);
  if (problems.length > 0) throw new PostRefused(problems);
  const at = new Date(now).toISOString();
  return {
    id: ulid(now),
    kind,
    occurredAt: at,
    recordedAt: at,
    deviceId: author.deviceId,
    source: 'manual',
    supersedesId,
    targetId: null,
    payload,
    glucoseMgdl: null,
    aiModelId: null,
    aiSuggestion: null,
  };
}

const addressedBy = (author: PostAuthor, audience: readonly string[]) => [
  keyRef('author', author.key),
  ...audience.map((unit) => keyRef('audience', unit)),
];

/**
 * A new post by `author` to `input.audience`, as a row in the author's log written from
 * `author.deviceId`. It may answer one row of this modality (`replyTo`), name people
 * (`mentions`) and name collaborators who may write new versions of it. The editing state is
 * left off, not refused, when the row would not carry it. Throws `PostRefused` when the row fails its schema, would not
 * fit in one row, or cites a row the gate refuses.
 */
export function createPost(
  author: PostAuthor,
  input: {
    readonly audience: readonly string[];
    readonly text: string;
    readonly replyTo?: string;
    readonly mentions?: readonly string[];
    readonly collaborators?: readonly string[];
    /** Who learns it was opened; nobody unless the author chooses (ADR-24 §7). */
    readonly views?: ViewSetting;
    /** The editor's Yjs state, base64 (`postDocSchema`); left off when the row would not fit. */
    readonly doc?: string;
  },
  lookup: PostLookup,
  now: number = Date.now(),
): SyncEntry {
  const refs = [
    ...addressedBy(author, input.audience),
    ...(input.replyTo === undefined ? [] : [entryRef('reply_to', input.replyTo)]),
    ...(input.mentions ?? []).map((unit) => keyRef('mention', unit)),
    ...(input.collaborators ?? []).map((unit) => keyRef('collaborator', unit)),
  ];
  const views = input.views ?? 'none';
  return writeWithDoc(
    author,
    refs,
    { text: input.text, ...(views === 'none' ? {} : { views }) },
    input.doc,
    lookup,
    now,
  );
}

const TOO_LONG = 'longer than one row carries; write it as several';

/**
 * A post with its editing state when the row carries both, and without it when it does not: the
 * words are the post and the state is how it merges, so a long post keeps its words and the next
 * editor starts from them (`postDocSchema`).
 */
function writeWithDoc(
  author: PostAuthor,
  refs: readonly Incidence[],
  body: Record<string, unknown>,
  doc: string | undefined,
  lookup: PostLookup,
  now: number,
  supersedesId: string | null = null,
): SyncEntry {
  if (doc === undefined) return write('public:post', author, refs, body, lookup, now, supersedesId);
  try {
    return write('public:post', author, refs, { ...body, doc }, lookup, now, supersedesId);
  } catch (error) {
    if (!(error instanceof PostRefused) || !error.problems.includes(TOO_LONG)) throw error;
    return write('public:post', author, refs, body, lookup, now, supersedesId);
  }
}

/**
 * A new version of a post, by its author or a collaborator it names (ADR-24 §7). The row
 * supersedes the one it revises and keeps its author, audience, collaborators and view setting;
 * only the words and the editing state change. It is written under the reviser's own device, so
 * each version says who wrote it, and the original stays in the log as every superseded row does.
 * The earlier version's state is never carried over: it describes the earlier words.
 */
export function revisePost(
  writer: PostAuthor,
  post: Pick<SyncEntry, 'id' | 'payload'>,
  change: { readonly text: string; readonly doc?: string },
  lookup: PostLookup,
  now: number = Date.now(),
): SyncEntry {
  const original = parsePostPayload('public:post', post.payload) as PostPayload | null;
  if (original === null) throw new PostRefused(['not a post']);
  const { doc: _earlier, ...kept } = original;
  const revision = { ...kept, text: change.text };
  if (!mayRevise(original, revision, writer.key)) {
    throw new PostRefused(['only its author or a collaborator it names writes a new version']);
  }
  const { refs, ...body } = revision;
  return writeWithDoc(writer, refs, body, change.doc, lookup, now, post.id);
}

/** A vote, addressed to the post's audience so its totals are theirs to see (ADR-24 §7). */
export function createVote(
  author: PostAuthor,
  input: { readonly post: Pick<SyncEntry, 'id' | 'payload'>; readonly vote: Vote },
  lookup: PostLookup,
  now: number = Date.now(),
): SyncEntry {
  const post = parsePostPayload('public:post', input.post.payload);
  if (post === null) throw new PostRefused(['not a post']);
  const refs = [...addressedBy(author, audienceOf(post)), entryRef('subject', input.post.id)];
  return write('public:vote', author, refs, { vote: input.vote }, lookup, now);
}

/**
 * That `author` opened a post, when the post asks to be told (ADR-24 §7): addressed to its author
 * alone, or to its whole audience. A post that asks nobody gets no view row: `null`, never a row
 * kept back.
 */
export function createView(
  author: PostAuthor,
  post: Pick<SyncEntry, 'id' | 'payload'>,
  lookup: PostLookup,
  now: number = Date.now(),
): SyncEntry | null {
  const parsed = parsePostPayload('public:post', post.payload) as PostPayload | null;
  if (parsed === null) return null;
  const setting = viewSettingOf(parsed);
  if (setting === 'none' || authorOf(parsed) === author.key) return null;
  const audience = setting === 'author' ? [authorOf(parsed)] : audienceOf(parsed);
  const refs = [...addressedBy(author, audience), entryRef('subject', post.id)];
  return write('public:view', author, refs, {}, lookup, now);
}

/**
 * A reaction by `author` to the row `input.subject`, addressed to `input.audience`: an emoji or a
 * word of at most `REACTION_MAX` code points. Throws `PostRefused` when the row fails its schema
 * or the subject is not a `public:` row this store holds.
 */
export function createReaction(
  author: PostAuthor,
  input: {
    readonly subject: string;
    readonly audience: readonly string[];
    readonly reaction: string;
  },
  lookup: PostLookup,
  now: number = Date.now(),
): SyncEntry {
  const refs = [...addressedBy(author, input.audience), entryRef('subject', input.subject)];
  return write('public:reaction', author, refs, { reaction: input.reaction }, lookup, now);
}

/**
 * A reshare by `author` of the row `input.subject` to `input.audience`, with optional words of
 * the resharer's own and the people it mentions. Throws `PostRefused` when the row fails its
 * schema or the subject is not a `public:` row this store holds.
 */
export function createReshare(
  author: PostAuthor,
  input: {
    readonly subject: string;
    readonly audience: readonly string[];
    readonly text?: string;
    readonly mentions?: readonly string[];
  },
  lookup: PostLookup,
  now: number = Date.now(),
): SyncEntry {
  const refs = [
    ...addressedBy(author, input.audience),
    entryRef('subject', input.subject),
    ...(input.mentions ?? []).map((unit) => keyRef('mention', unit)),
  ];
  return write(
    'public:reshare',
    author,
    refs,
    input.text === undefined ? {} : { text: input.text },
    lookup,
    now,
  );
}
