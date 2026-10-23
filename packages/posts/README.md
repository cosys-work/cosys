# @cosys/posts

`@cosys/posts` is the social modality of the cosys record: posts, reactions, reshares, votes and view receipts, written as rows in their author's own append-only log and addressed to an audience by key. It was built for TApp, a diabetes app, where a patient's family and the units in their trust circle (a clinic, a lab, a gym, a doctor, once paired) post to the patient's feed in date order. Nothing in it is specific to diabetes or to health. It gives you the payload schemas, the functions that write each row, a gate that keeps a post from citing or carrying anything that is not itself a post, audience routing for sending, a rule for whether an arriving row lands, a feed query over an incidence index, vote totals and a small set of Markdown and file-format helpers. It has no screen, no storage and no transport of its own: those come from your app and from [`@cosys/record`](https://www.npmjs.com/package/@cosys/record) and [`@cosys/peer`](https://www.npmjs.com/package/@cosys/peer).

## Status

Version 0.1.0. This is an early release and the API may change before 1.0.

The package ships its TypeScript sources, not compiled JavaScript: every entry in `exports` points at a `./src/*.ts` file. You need a toolchain that compiles TypeScript from `node_modules`, such as Metro, Vite, esbuild, tsx, Bun or Deno. Plain `node` without a loader will not run it, and a bundler configured to skip `node_modules` must be told to include it. The sources are written for TypeScript strict mode and ES modules (`"type": "module"`).

Tests are not published.

## Install

```sh
npm install @cosys/posts
```

It is also on JSR as [`@cosys/posts`](https://jsr.io/@cosys/posts): `deno add jsr:@cosys/posts`, or `npx jsr add @cosys/posts` in a Node project.

Dependencies, installed with it:

| Package                                                        | Version | Used for                                                                                                                                      |
| -------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@cosys/crypto`](https://www.npmjs.com/package/@cosys/crypto) | 0.1.0   | `ulid` for row ids                                                                                                                            |
| [`@cosys/record`](https://www.npmjs.com/package/@cosys/record) | 0.1.0   | the row shape (`SyncEntry`), references (`Incidence`, `keyRef`, `entryRef`), the kinds and roles registries, assertion payloads and row views |
| `zod`                                                          | ^4.6.5  | payload schemas                                                                                                                               |

`@cosys/record` in turn depends on `zod`. You will usually also want `@cosys/peer`, whose `verifyAssertion` produces the verified membership assertions that audience routing reads, but this package does not depend on it.

## Import paths

There is no root import. `exports` maps `./*` to `./src/*.ts`, so each module is imported by name:

```ts
import { postPayloadSchema } from '@cosys/posts/schema';
import { createPost } from '@cosys/posts/create';
import { attachmentRefsOf } from '@cosys/posts/markdown';
import { postContentOf } from '@cosys/posts/formats';
import { audienceRoute } from '@cosys/posts/audience';
import { postArrivalRefusal } from '@cosys/posts/landing';
import { feedOf } from '@cosys/posts/feed';
import { postGateProblems } from '@cosys/posts/gate';
import { POST_KINDS } from '@cosys/posts/kinds';
import { postRefs } from '@cosys/posts/refs';
import { tallyOf } from '@cosys/posts/tally';
```

Importing `kinds` registers this modality's kinds and roles with `@cosys/record` as a side effect. `schema` imports `kinds`, and every module that reads a payload imports `schema`, so the registration has happened before any payload is parsed.

## What's inside

### `kinds`

- `POSTS`: the modality name, `'posts'`.
- `POST_KINDS`: `'public:post'`, `'public:reaction'`, `'public:reshare'`, `'public:vote'`, `'public:view'`. Type `PostKind`.
- `POST_REF_ROLES`: `'author'`, `'audience'`, `'reply_to'`, `'mention'`, `'collaborator'`. Type `PostRefRole`. A reaction, reshare, vote or view names the row it is about with the substrate's core `subject` role.
- `isPostKind(kind)`: whether a kind is one of the five.
- `isPublicKind(kind)`: whether a kind is in the `public:` class (its name starts with `public:`).

Every kind is registered with `travels: false`: no ordinary grant carries a post. A post goes to the audience it names, through `audienceRoute`, and to nobody else. A retraction is the substrate's tombstone and an edit is a supersede, as for every row.

### `schema`

- Limits: `POST_TEXT_MAX` (32,000 characters of text), `REACTION_MAX` (16 code points), `PAYLOAD_MAX` (64 KiB, one row's serialised payload).
- `VIEW_SETTINGS` (`'none'`, `'author'`, `'audience'`) and type `ViewSetting`: who learns that a post was opened. Absent means `'none'`.
- `VOTES` (`'up'`, `'down'`) and type `Vote`.
- `postDocSchema`: an optional editing state, a base64 string. It is meant to hold a Yjs document update so that versions written apart by the author and a collaborator can merge when either opens the post again. This package treats it as opaque and does not depend on Yjs; only an editor reads it.
- Payload schemas: `postPayloadSchema`, `reactionPayloadSchema`, `resharePayloadSchema`, `votePayloadSchema`, `viewPayloadSchema`, collected in `POST_PAYLOAD_SCHEMAS` by kind. Types `PostPayload`, `ReactionPayload`, `ResharePayload`, `VotePayload`, `ViewPayload` and their union `AnyPostPayload`.
- `parsePostPayload(kind, payload)`: the parsed payload of a row's JSON, or `null` when it is not valid for that kind.
- Readers: `authorOf`, `audienceOf`, `citesOf` (the `reply_to` and `subject` rows), `collaboratorsOf`, `viewSettingOf`.
- `mayRevise(post, revision, writer)`: whether `writer` may write `revision` as a new version of `post`.

Every payload carries explicit `refs` (2 to 64 incidences): exactly one `author` by key and at least one `audience` by key. A post may add one `reply_to` (a row), any number of `mention` and `collaborator` (keys). A reaction, vote and view are about exactly one row (`subject`); a reshare is about one row and may add mentions and optional text. A post's `text` is GitHub-flavoured Markdown; plain text written before that reads the same.

### `create`

- `PostAuthor`: `{ key, deviceId }`, the author's identity key in lowercase hex and the device writing.
- `PostRefused`: the error thrown when a row cannot be written, with a `problems` array.
- `createPost(author, { audience, text, replyTo?, mentions?, collaborators?, views?, doc? }, lookup, now?)`
- `revisePost(writer, post, { text, doc? }, lookup, now?)`
- `createReaction(author, { subject, audience, reaction }, lookup, now?)`
- `createReshare(author, { subject, audience, text?, mentions? }, lookup, now?)`
- `createVote(author, { post, vote }, lookup, now?)`: addressed to the post's own audience.
- `createView(author, post, lookup, now?)`: a view row addressed to the post's author or its whole audience, as the post asked, or `null` when the post asks nobody, when the reader is its author, or when the row is not a post.

Each returns a `SyncEntry` (from `@cosys/record/row`) with a fresh ULID, `source: 'manual'`, the payload as JSON, and the columns a post does not use set to `null`. Signing, storing and sending the row are the caller's. The payload is validated and the gate is run on its citations before the row exists, so a refused post is never written.

When a post with `doc` would exceed `PAYLOAD_MAX`, `createPost` and `revisePost` drop the editing state and keep the words. A post whose words alone do not fit is refused; write it as several.

### `gate`

- `PostLookup`: what the gate needs from the caller's store, `kindOf(id)` and `kindsCarrying(sha256)`.
- `PostRefusal`: `'shape'`, `'cites_unheld'`, `'cites_non_public'`, `'attachment_non_public'`.
- `postGateProblems(row, attachments, lookup)`: every reason `row` may not be written or sent, with `attachments` the sha256 of each file it carries. Empty when it may.

### `audience`

- `cohortMembers(verified, now?)`: the current members of each cohort, as a map from cohort key to member keys, built from already-verified `paired_with` assertions the cohort's key signed. An assertion outside its `validFrom` / `validUntil` dates, or revoked by a `revoked` assertion from the same signer, does not count.
- `cohortUnits(verified)`: every unit each cohort has ever named, revoked or not. This is who should hear about the cohort's membership changes.
- `membershipOf(row)`: the assertion payload of a membership row (a `paired_with` whose refs are all `subject` by key, or a `revoked`), or `null`.
- `reaches(payload, peer, cohorts)`: whether `peer` is the author, is in the audience by its own key, or is a member of a cohort in the audience.
- `AudienceRouteOptions` and `audienceRoute(options, inner)`: wraps a `RowView` from `@cosys/record/views` so that rows of this modality go only to their audience, and every other row is left to `inner`.

A cohort is a unit with a key of its own, such as a family or a clinic's group, and a person is a cohort of one. The author delivers: a post to a cohort is sealed for each member the author knows, and nothing relays it.

### `landing`

- `PostArrivalContext`: `{ sender, self, cohorts, lookup, attachments? }`.
- `PostArrivalRefusal`: `'not_from_author'`, `'not_for_this_account'`, or a `PostRefusal`.
- `postArrivalRefusal(row, context)`: why an arriving row may not land here, or `null` when it may.

Whether the sender is in the trust circle at all is the transport's question: a row arrives only from a peer this account paired with. This function decides the rest.

### `feed`

- `IncidenceIndex`: the part of an app's reference index the feed reads, `naming(to, roles)` and `incidencesOf(entryId)`.
- `FeedItem`: `{ entryId, author }`.
- `feedOf(index, me, cohorts?)`: every row naming `me` or one of `cohorts` as its audience, each once, newest first by ULID. Which of them are still current after supersedes and tombstones is the app's to filter.

### `tally`

- `Tally`: `{ up, down, mine }`.
- `tallyOf(post, votes, me)`: the up and down totals for one post. Each voter counts once, by their latest vote (highest ULID); `mine` is this reader's own vote or `null`.

### `refs`

- `postRefs(row, attachments?)`: the incidences of a row of this modality, as an app's reference index would hold them: what its columns and attachments name plus the refs its payload writes, normalised into the substrate's one order. Empty for a row that is not a valid post-kind row.

### `markdown`

- `ATTACHMENT_SCHEME`: `'attachment:'`.
- `photoMarkdown(id)`: the markup for a photograph of this post, `![](attachment:<id>)`.
- `attachmentIdOf(src)`: the ULID an image address names, or `null` for any other address.
- `attachmentRefsOf(markdown)`: the attachment ids the words show, in order, each once.
- `plainTextOf(markdown)`: the words with GitHub-flavoured markup removed line by line, for an excerpt or a screen reader label. It is not a Markdown parser.

An `attachment:` id is resolved among the post's own files (this version's or an earlier version's) and nowhere else. Any other image address is not shown, which also means a reader never fetches one.

### `formats`

- `POST_MEDIA_TYPES`: the formats a post may carry, each mapped to a content class: JPEG, PNG, WebP, GIF and HEIC (`image`), MPEG and MP4 audio and Ogg (`audio`), MP4 and WebM (`video`), PDF (`document`), plain text (`text`). Types `PostMediaType` and `PostContentClass`.
- `sniffMediaType(bytes)`: the media type the bytes are, among those, or `null`.
- `postContentOf(bytes)`: `{ mediaType, content }`, or `null` to refuse the file.

The type is decided by the bytes, never by a file name or a declared type. Plain text must be valid UTF-8 with no control characters other than tab and line ends, and must not open with `<`. There is no HTML, no SVG and no archive format on the list.

## Usage

The examples assume a store your app provides. `PostLookup` is the only thing the write path needs from it:

```ts
import type { PostLookup } from '@cosys/posts/gate';

const lookup: PostLookup = {
  kindOf: (id) => store.kindOf(id), // undefined when the store holds no such row
  kindsCarrying: (sha256) => store.kindsCarrying(sha256),
};
const me = { key: myKeyHex, deviceId: 'phone-1' };
```

### Write a post with a photograph

```ts
import { createPost, PostRefused } from '@cosys/posts/create';
import { postContentOf } from '@cosys/posts/formats';
import { photoMarkdown } from '@cosys/posts/markdown';

if (postContentOf(photoBytes) === null) throw new Error('not a format a post may carry');

try {
  const row = createPost(
    me,
    {
      audience: [familyCohortKey],
      text: `Walked to the market this morning.\n\n${photoMarkdown(photoId)}`,
      views: 'author',
    },
    lookup,
  );
  await store.append(row); // signing and storing are yours
} catch (error) {
  if (error instanceof PostRefused) console.warn(error.problems);
  else throw error;
}
```

### Revise it as a collaborator

```ts
import { revisePost } from '@cosys/posts/create';

const version = revisePost(
  { key: daughterKeyHex, deviceId: 'daughter-phone' },
  original, // { id, payload } of the post being revised
  { text: 'Walked to the market, and Buwa came too.', doc: yjsUpdateBase64 },
  lookup,
);
// version.supersedesId === original.id; the original stays in the log.
```

The writer must be the author or a collaborator the post names. A collaborator's version keeps the post's author, audience, collaborators and view setting; only the words and the editing state change. The earlier version's `doc` is never carried over.

### Route a row to one peer

```ts
import { audienceRoute, cohortMembers, cohortUnits } from '@cosys/posts/audience';

// `verified` holds { id, payload } for membership assertions already checked
// with @cosys/peer's verifyAssertion.
const view = audienceRoute(
  {
    peer: peerKeyHex,
    self: me.key,
    device: me.deviceId,
    cohorts: cohortMembers(verified),
    holds: new Map([[familyCohortKey, cohortUnits(verified).get(familyCohortKey)!]]),
    lookup: { ...lookup, rowOf: (id) => store.row(id) },
    attachmentsOf: (entryId) => store.attachmentHashes(entryId),
  },
  grantView, // the RowView this peer's grant gives it
);

const outgoing = rows.map((row) => view.project(row)).filter((row) => row !== null);
```

### Decide whether an arriving post lands

```ts
import { cohortMembers } from '@cosys/posts/audience';
import { postArrivalRefusal } from '@cosys/posts/landing';

const refusal = postArrivalRefusal(row, {
  sender: senderKeyHex,
  self: me.key,
  cohorts: cohortMembers(verified),
  lookup,
  attachments: hashesTheRowCarries,
});
if (refusal === null) await store.append(row);
```

### Read attachment references out of the words

```ts
import { attachmentIdOf, attachmentRefsOf, plainTextOf } from '@cosys/posts/markdown';

const ids = attachmentRefsOf(post.text); // ['01JB2Z3Y4X5W6V7T8S9R0QPNMK', ...]
const shown = ids.filter((id) => ownFilesOfThisPost.has(id));
const excerpt = plainTextOf(post.text).slice(0, 140);

attachmentIdOf('attachment:01JB2Z3Y4X5W6V7T8S9R0QPNMK'); // '01JB2Z3Y4X5W6V7T8S9R0QPNMK'
attachmentIdOf('https://example.org/a.png'); // null: not shown, never fetched
```

## Design rules the code enforces

- Versions are append-only. A revision is a new row whose `supersedesId` names the one it revises, and the original is kept. A retraction is the substrate's tombstone. Nothing in the package changes or deletes a row.
- A post cites only posts. `postGateProblems` refuses a row that answers or is about an id the sender does not hold (`cites_unheld`), or a row outside the `public:` class (`cites_non_public`). `createPost` and its siblings run it before a row exists, and `audienceRoute` and `postArrivalRefusal` run it again on the way out and on the way in.
- A post carries only its own files. A file whose sha256 is also carried by a row outside the `public:` class is refused (`attachment_non_public`) when the row is routed or arrives. In the words, an `attachment:` id resolves only among the post's own files.
- Only what this account wrote leaves it. `audienceRoute` sends a post-kind row only when this account is its author, or when this device wrote the version (a collaborator's revision). A post that landed here from someone else is never sent on, and a tombstone of a post goes only where the post went.
- A row lands only from the account that wrote it. `postArrivalRefusal` refuses a row whose sender is not its author (`not_from_author`), with one exception: a new version of a post from a collaborator that post names. It also refuses a row not addressed to this account or a cohort it is in (`not_for_this_account`).
- A collaborator may change the words and the editing state. `mayRevise` rejects a collaborator's version that changes the audience, the collaborators or the view setting.
- No grant carries a post. Every kind is registered with `travels: false`, so a full view of someone's record does not include their posts.
- `membershipOf` ignores a `paired_with` with any ref that is not a `subject` by key, so a pairing of another shape is never read as cohort membership.
- A view row is written only when the post asks for one, and never for an author opening their own post.
- `tallyOf` returns two numbers for one post and has no way to compare posts. `feedOf` orders by ULID, which is by time, whatever the votes say.
- One row is at most 64 KiB. Text is capped at 32,000 characters, and the editing state is dropped before the words are.
- Files are judged by their bytes. Only the formats listed in `formats` pass `postContentOf`, and the list has no HTML, SVG, archive or executable format.

## The cosys packages

| Package                                                        | What it is                                                                                                                                                                                    | Depends on                                      |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| [`@cosys/crypto`](https://www.npmjs.com/package/@cosys/crypto) | Primitives over @noble: hashing, signing, ciphers, key agreement, PIN, base64, ULID.                                                                                                          | no workspace packages                           |
| [`@cosys/record`](https://www.npmjs.com/package/@cosys/record) | The record substrate: time, timestamps and references, tombstones, signed rows, the kinds, roles and claims registries, and views.                                                            | `zod`                                           |
| [`@cosys/peer`](https://www.npmjs.com/package/@cosys/peer)     | The networking half: identity, pairing, the wire, the mailbox, grants, revocation and erasure.                                                                                                | `@cosys/crypto`, `@cosys/record`                |
| [`@cosys/posts`](https://www.npmjs.com/package/@cosys/posts)   | The social modality: posts, reactions and reshares to a circle, with audience routing and landing rules.                                                                                      | `@cosys/crypto`, `@cosys/record`                |
| [`@cosys/bridge`](https://www.npmjs.com/package/@cosys/bridge) | The actor at the network's edge that turns a foreign protocol, such as a lab's FHIR or CSV export, into signed rows deposited into one patient's mailbox. Runs on a server, never on a phone. | `@cosys/crypto`, `@cosys/peer`, `@cosys/record` |
| [`piroh`](https://crates.io/crates/piroh) (Rust)               | The iroh endpoint `@cosys/peer` drives as its direct transport.                                                                                                                               | `iroh`                                          |
| [`prelay`](https://crates.io/crates/prelay) (Rust)             | The relay server: `iroh-relay` with an access check, so only the application's own builds can use it.                                                                                         | `iroh-relay`                                    |

## Licence

Apache-2.0. See [LICENSE](LICENSE).

## More

Further information, support and collaboration: [https://cosys.work](https://cosys.work).
