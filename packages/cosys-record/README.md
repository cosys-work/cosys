# @cosys/record

`@cosys/record` is the record substrate shared by the cosys packages: the part of an append-only, signed, peer-to-peer record that belongs to no particular kind of data. It holds local time with its UTC offset, the timestamp and row-reference primitives, the tombstone that a retraction is, the row as it travels between devices, the bytes a signed row's signature covers, and the registries through which each modality (health records, social posts, bridged lab results and so on) declares its own kinds, reference roles and views. It is for developers building an application or a network actor on top of `@cosys/peer`, `@cosys/posts` or `@cosys/bridge`, and for anyone writing a new modality that has to plug its kinds into that network.

## Status

Version 0.1.0. This is an early release, and the API may change before 1.0.

The package ships TypeScript sources, not compiled JavaScript: every entry in the `exports` field points at a `.ts` file under `src/`. To consume it you need a toolchain that compiles TypeScript from `node_modules`, such as Metro, Vite, esbuild, tsx or Bun. Relative imports inside the package carry no file extension (`./protocols`, not `./protocols.ts`), so the resolver has to accept bundler-style resolution; in Deno that means enabling its sloppy-imports option. Plain `node` without a TypeScript loader will not run it. The package is an ES module (`"type": "module"`).

## Install

```sh
npm install @cosys/record
```

It is also on JSR as [`@cosys/record`](https://jsr.io/@cosys/record): `deno add jsr:@cosys/record`, or `npx jsr add @cosys/record` in a Node project.

The one runtime dependency is `zod` `^4.6.5`. Every schema in the package uses Zod 4 APIs (`z.strictObject`, `z.iso.datetime`, `z.int`), so Zod 3 will not work.

The database executor conformance suite, which every app's SQLite driver passes before it is wired in, uses `drizzle-orm`. It lives in the repository's `src/testing/` folder and is not part of the npm package.

## Import paths

The `exports` field is a single pattern:

```json
{ "./*": "./src/*.ts" }
```

So every import names a module path under `src/`, without the extension. There is no bare root import: `import ... from '@cosys/record'` does not resolve.

```ts
import { isoWithOffset } from '@cosys/record/time';
import { registerKinds } from '@cosys/record/kinds';
import { isoTimestamp } from '@cosys/record/schema/common';
import '@cosys/record/bridge-kinds'; // side effect only, see below
```

The published modules are `time`, `refs`, `row`, `signed`, `kinds`, `claims`, `protocols`, `views`, `bridge`, `bridge-kinds`, `schema/common`, `schema/tombstone`, `schema/assert` and `schema/sharing`.

## What's inside

### `@cosys/record/time`

- `isoWithOffset(date = new Date())`: ISO 8601 with the device's UTC offset, for example `2026-09-15T08:30:00.000+05:45`. The offset is kept so a record read on a device in another time zone still shows the local time the person experienced.
- `localDay(date = new Date())`: the local calendar day as `YYYY-MM-DD`.

### `@cosys/record/schema/common`

- `isoTimestamp`: Zod schema for an ISO 8601 date-time that must carry an offset.
- `isoDate`: Zod schema for an ISO 8601 calendar date.
- `ulidRef`: Zod schema for a 26-character ULID reference to another row.

### `@cosys/record/schema/tombstone`

- `tombstonePayloadSchema`, type `TombstonePayload`: the payload of a `tombstone` row. It names the row it hides (`targetId`), that row's kind (`targetKind`) and, optionally, when that row happened (`targetOccurredAt`), so a tombstone is readable on its own and a period-scoped share can decide whether the retraction is in scope.

### `@cosys/record/refs`

How a row names the things it points at. Each reference (an "incidence") has a role, a target and a target kind.

- `REF_KINDS` (`'entry' | 'key' | 'blob' | 'origin'`), type `RefKind`: what a reference may point at. An `entry` is a 26-character row id, a `key` or `blob` is 64 lowercase hex characters, an `origin` is `<protocol>:<foreign id>`.
- `CORE_REF_ROLES`, type `CoreRefRole`: the roles every modality shares: `supersedes`, `retracts`, `attachment`, `origin`, `subject`, `signer`, `peer`, `holder`, `operator`, `reads`, `request`.
- `SUBSTRATE`: the modality name (`'substrate'`) the core roles, kinds and views are registered under.
- `registerRefRoles(modality, roles)`: adds a modality's own roles. Role names match `^[a-z][a-z_]{0,39}$`.
- `isRefRole(role)`, `refRoles()`: query the role registry.
- `incidenceSchema`, type `Incidence`: Zod schema for one reference. `kind` defaults to `entry`; `at` is an optional timestamp. The role must be registered and the target must have the shape its kind says.
- `entryRef(role, to)`, `keyRef(role, to)`, `blobRef(role, to)`: build an incidence.
- `RowColumns`, `columnRefs(row, attachments?)`: the incidences every row has from its own columns: `supersedes` from `supersedesId`, `retracts` from `targetId`, and one `attachment` per attachment digest passed in.
- `normaliseRefs(refs)`: sorts by role, target, then kind, and drops exact duplicates, so an index rebuilt from rows is byte-identical to one written on insert.
- `assertRefs(refs)`: throws if any incidence fails `incidenceSchema`.

### `@cosys/record/protocols`

The closed list of foreign protocols a bridged row may name as its origin.

- `PROTOCOLS`, type `Protocol`: `fhir`, `csv`, `nostr`, `activitypub`, `atproto`, `matrix`, `zot`.
- `isProtocol(value)`.
- `ORIGIN_ID_MAX` (480): the longest foreign identifier an origin carries.
- `originOf(protocol, id)`: `'<protocol>:<id>'`, or `null` if the protocol is not listed or the id is empty or too long.
- `parseOrigin(origin)`: `{ protocol, id }`, or `null`.

### `@cosys/record/kinds`

The kind registry. Each modality registers its kinds at import time, with whether an ordinary grant may carry each one.

- `KindSpec`: `{ travels: boolean; control?: boolean; authoredByAnother?: boolean }`. `control` marks an act about sharing (out of every scope and every timeline). `authoredByAnother` marks a row written and signed by another unit, which no revocation or erasure scope of the record owner reaches.
- `SUBSTRATE_KINDS`, type `SubstrateKind`: the substrate's own kinds. `tombstone` travels; `grant`, `revoke`, `erasure_request`, `erasure_receipt` and `assert` are control kinds that do not.
- `SUBSTRATE` (re-exported from `refs`).
- `registerKinds(modality, kinds)`: adds a modality's kinds. A kind name is a word or a class prefix and a word, for example `note` or `notes:private`.
- `isKind(kind)`, `travelsUnderGrant(kind)`, `isControlKind(kind)`, `isAuthoredByAnother(kind)`, `modalityOf(kind)`, `registeredKinds()`: query the registry. Every predicate answers `false` for a kind nobody registered.

### `@cosys/record/row`

The row as it travels between devices.

- `ENTRY_SOURCES` (`manual`, `photo_assisted`, `imported`, `system`), type `EntrySource`: the provenance of a row.
- `syncEntrySchema`: Zod schema for a row on the wire: `id`, `kind` (must be registered), `occurredAt`, `recordedAt`, `deviceId`, `source`, `supersedesId`, `targetId`, `payload` (JSON text up to 64 KiB), and the nullable columns `glucoseMgdl`, `aiModelId` and `aiSuggestion` inherited from the first app that used it.
- `LocalCorrectionFacts`, `SyncEntry`: the parsed row plus two optional local-only facts about a correction (`supersededKind`, `supersededOccurredAt`) that a sender reads and never sends.
- `LOCAL_ONLY_FIELDS`: the names of those two fields.
- `toWireRow(row)`: a shallow copy with the local-only fields removed.

### `@cosys/record/views`

The view registry. A view is what one peer is allowed to be told about a row: the row itself, a narrower row made from it, or nothing.

- `RowView`: `{ name; project(row): SyncEntry | null; attachments: boolean }`.
- `FULL_VIEW`: the substrate's one view, `full`, which passes every row through.
- `projectsItself(view, row)`: whether the view sends the row unchanged in kind.
- `ViewContext`: an empty interface that each modality extends by declaration merging with whatever its views need.
- `ViewSpec`: `{ reads: string; writes: string | null; make(context): RowView }`. `reads` is a kind or `'*'`.
- `registerViews(modality, views)`: adds a modality's views. The kinds a view reads and writes must already be registered.
- `isView(view)`, `viewSpec(view)`, `isViewKind(kind)`, `scopeKindsOf(kind)`, `registeredViews()`: query the registry. `scopeKindsOf` returns a projected kind together with the kind it was made from, so a revocation scoped by the original kind also reaches its projections.

### `@cosys/record/schema/sharing`

The payloads of the substrate's acts about sharing. Each one asks the registries at parse time rather than naming any modality's vocabulary.

- `peerKeyHex`, `signatureHex`, `digestHex`: 64-, 128- and 64-character lowercase hex schemas.
- `isRevocableKind(kind)`: a kind that travels and is not a control kind.
- `isGrantScopeKind(kind)`: a revocable kind that is not a view's projected kind.
- `grantPayloadSchema`, type `GrantPayload`: a share with a peer, a registered `view`, optional `kinds`, `from` and `to`, `attachments`, optional `alsoViews` and an optional `emergency` flag.
- `REVOCATION_MODES` (`stop_sending`, `stop_and_remove`), type `RevocationMode`.
- `revocationScopeSchema`, type `RevocationScope`; `revocationPayloadSchema`, type `RevocationPayload`.
- `erasureRequestPayloadSchema`, type `ErasureRequestPayload`.
- `ERASURE_HOLDERS` (`install`, `archive`), `ERASURE_OUTCOMES` (`complete`, `partial`), with types `ErasureHolder` and `ErasureOutcome`.
- `BEYOND_REACH`: the fixed sentence every receipt carries about what no holder can reach.
- `registerKeptCategories(modality, categories)`: registers what a holder may keep after an erasure, each with a minimum retention of 1 to 50 years.
- `keptRecordSchema`, type `KeptRecord`; `erasureReceiptPayloadSchema`, type `ErasureReceiptPayload`. The receipt schema refuses inconsistent answers: an archive must state its backup window and an install must not, and a `complete` outcome must leave nothing remaining.

### `@cosys/record/signed`

- `canonicalJson(value)`: JSON with object keys sorted and `undefined` members dropped, so the signed bytes can be rebuilt from a parsed payload whatever order the writer used.
- `SignedRowHeader`: `{ id, kind, deviceId, occurredAt }`.
- `signedRowMessage(context, header, parts)`: the bytes a signature covers: the context line, a newline, and the canonical JSON array of the four header fields followed by `parts`. This package does no signing itself; pass the bytes to your Ed25519 signer (for example from `@cosys/crypto`).

### `@cosys/record/claims` and `@cosys/record/schema/assert`

An assertion is a signed claim about units or rows.

- `ASSERT_CLAIMS`, type `AssertClaim`, `isAssertClaim(value)`: the closed claim vocabulary: `licensed_clinic`, `operated_by`, `bridge_of`, `paired_with`, `revoked`, `same_as`, `witnessed`.
- `ASSERT_CONTEXT` (`'tapp-assert/row/v1'`): the context line an assertion's signature covers.
- `assertionSchema`, types `Assertion` and `AssertionInput`: a claim, its `refs` (at least one with role `subject`), `validFrom`, optional `validUntil` (which must be later) and optional `evidence`.
- `assertPayloadSchema`, type `AssertPayload`: the assertion plus the signer's key and its signature.
- `assertRowMessage(header, { assertion, signer })`: the bytes the signer signs.

### `@cosys/record/bridge`

The shapes of the rows a bridge writes into one record owner's log. It holds no keys and no protocol code.

- `BRIDGE_MODALITY` (`'bridge'`), `BRIDGE_KINDS` (`bridge:import`, `bridge:message`, `bridge:ack`, `bridge:receipt`), type `BridgeKind`, `isBridgeKind(kind)`.
- `BRIDGE_KIND_SPECS`: none of the four travels, all are authored by another unit, and the ack and receipt are control kinds.
- `registerImportShapes(modality, shapes)`, `importShape(name)`: the registry of body shapes a `bridge:import` may carry, supplied by the modality that understands them.
- `FOREIGN_TEXT_MAX` (16,000), `BRIDGE_MESSAGE_MAX` (2,000).
- `foreignObjectSchema`, type `ForeignObject`: the foreign object an import was translated from, inline when small or by SHA-256 digest when not.
- `bridgeBodySchemas`, types `BridgeBody` and `BridgeBodyInput`: one body schema per bridge kind. Every body except the receipt must name exactly one `origin`.
- `bridgeActorSchema`, type `BridgeActor`: the running instance that wrote a row, with its own key and signature.
- `bridgePayloadSchemas`, type `BridgePayload`: the envelope: bridge key, record owner key, actor, body and the bridge key's signature.
- `originOfRow(payload)`: the origin a bridged row names, or `null`.
- `BRIDGE_ROW_CONTEXT` (`'tapp-bridge/row/v1'`), `bridgeRowMessage(header, payload)`: the bytes the bridge key and the instance key both sign. The instance's own signature is excluded from them.

### `@cosys/record/bridge-kinds`

No exports. Importing it registers the four `bridge:` kinds under the `bridge` modality. Reading the shapes in `bridge` registers nothing, so an application accepts bridged rows only when it imports this module on purpose.

## Usage

### Registering a modality

```ts
import { registerKinds, isKind, travelsUnderGrant } from '@cosys/record/kinds';
import { registerRefRoles } from '@cosys/record/refs';

// Call once, at import time, in the module that defines the modality.
registerKinds('notes', {
  note: { travels: true },
  'notes:title': { travels: true },
  'notes:draft': { travels: false },
});
registerRefRoles('notes', ['replies_to']);

isKind('note'); // true
travelsUnderGrant('notes:draft'); // false
travelsUnderGrant('unregistered'); // false
```

### Building and checking references

```ts
import {
  columnRefs,
  entryRef,
  normaliseRefs,
  assertRefs,
  type Incidence,
} from '@cosys/record/refs';
import { originOf } from '@cosys/record/protocols';

const refs: Incidence[] = normaliseRefs([
  ...columnRefs({ supersedesId: '01K5RJ4Z9P8Q7M6N5T4V3W2X1Y', targetId: null }),
  entryRef('replies_to', '01K5RJ51ABCDEFGHJKMNPQRSTV'),
]);
assertRefs(refs); // throws on an unregistered role or a malformed target

originOf('fhir', 'Observation/123'); // 'fhir:Observation/123'
originOf('ftp', 'x'); // null: not a listed protocol
```

### Timestamps, a tombstone and a row on the wire

```ts
import { isoWithOffset, localDay } from '@cosys/record/time';
import { tombstonePayloadSchema } from '@cosys/record/schema/tombstone';
import { syncEntrySchema, toWireRow, type SyncEntry } from '@cosys/record/row';

declare const received: string; // a row's JSON as it arrived from a peer
declare const localRow: SyncEntry; // a row read from your own store

const now = isoWithOffset(); // e.g. '2026-10-22T14:05:09.123+05:45'
const today = localDay(); // e.g. '2026-10-22'

// Deleting a row means appending a tombstone that names it.
const payload = tombstonePayloadSchema.parse({
  targetId: '01K5RJ4Z9P8Q7M6N5T4V3W2X1Y',
  targetKind: 'note',
  targetOccurredAt: '2026-10-20T09:00:00+05:45',
});

const incoming = syncEntrySchema.parse(JSON.parse(received)); // refuses unregistered kinds
const outgoing = toWireRow(localRow); // drops local-only correction facts
```

### A view and a grant

```ts
import { registerViews } from '@cosys/record/views';
import { grantPayloadSchema } from '@cosys/record/schema/sharing';

// 'note' and 'notes:title' were registered as kinds above.
registerViews('notes', {
  note_titles: {
    reads: 'note',
    writes: 'notes:title',
    make: () => ({
      name: 'note_titles',
      attachments: false,
      project: (row) =>
        row.kind === 'note'
          ? {
              ...row,
              kind: 'notes:title',
              payload: JSON.stringify({ title: JSON.parse(row.payload).title }),
            }
          : null,
    }),
  },
});

const grant = grantPayloadSchema.parse({
  peer: 'ab'.repeat(32),
  view: 'note_titles',
  attachments: false,
});
```

## Design rules

The code enforces each of these, or states it in its own comments.

- Rows are appended and never edited. A correction is a new row whose `supersedesId` names the old one, and a deletion is a `tombstone` row whose payload names its target. Nothing leaves the log except by a purge. This package defines the shapes; keeping the store append-only is the application's job.
- The substrate names no modality's kinds. Kinds, reference roles, views, import shapes and kept categories are registries that the owning modality fills at import time. The substrate registers only its own: the tombstone, the control kinds for sharing and assertions, the core roles and the `full` view.
- Anything unregistered is refused. `syncEntrySchema` rejects a kind nobody registered and `travelsUnderGrant` answers `false` for it. Roles, views and kept categories behave the same way.
- A name belongs to one modality. Registering a name another modality owns throws. Registering the same name again from the same modality with the same answer does nothing, so a module evaluated twice is harmless; a different answer throws. No modality may register under the name `substrate`, and a failed `registerKinds` call adds nothing.
- `registerViews` throws if a view reads or writes a kind that no modality has registered, so kinds must be registered first.
- The registries are module-level maps. What a process accepts depends on which modality modules it has imported.
- Bridged rows are opt-in. `bridge` only describes shapes, and importing `bridge-kinds` is what makes the four `bridge:` kinds acceptable. They sit under their own modality, so upgrading this package does not make an application start accepting a bridge's rows.
- `toWireRow` strips the local-only facts `supersededKind` and `supersededOccurredAt`, and `syncEntrySchema` does not name them, so a received row cannot supply them.
- The tombstone, sharing, assertion and bridge schemas use `z.strictObject`, which rejects an unexpected field instead of stripping it.
- No claim in `ASSERT_CLAIMS` and no field in `assertionSchema` is numeric, so an assertion cannot carry a score, rank or weight.
- The list of origin protocols in `protocols` belongs to the substrate. A modality cannot add one.
- A verifier rebuilds the signed bytes from the parsed row. `signedRowMessage` binds a context line and the row header to the body through canonical JSON, and the distinct contexts (`tapp-assert/row/v1`, `tapp-bridge/row/v1`) stop one kind of signed row being replayed as another.

## The cosys packages

| Package                                                        | What it is                                                                                                                                                                                    | Depends on                                       |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| [`@cosys/crypto`](https://www.npmjs.com/package/@cosys/crypto) | Primitives over @noble: hashing, signing, ciphers, key agreement, PIN, base64, ULID.                                                                                                          | No workspace packages.                           |
| [`@cosys/record`](https://www.npmjs.com/package/@cosys/record) | The record substrate: time, timestamps and references, tombstones, signed rows, the kinds, roles and claims registries, and views.                                                            | `zod`.                                           |
| [`@cosys/log`](https://www.npmjs.com/package/@cosys/log)       | A typed logger: a closed code catalogue each app declares, primitive fields only, a buffered queue and an injected sink.                                                                      | `@cosys/crypto`, `@cosys/record`                 |
| [`@cosys/qr`](https://www.npmjs.com/package/@cosys/qr)         | A QR encoder with no dependencies: byte mode, level M, versions 1 to 20. Returns the module matrix.                                                                                           | No workspace packages.                           |
| [`@cosys/peer`](https://www.npmjs.com/package/@cosys/peer)     | The networking half: identity, pairing, the wire, the mailbox, grants, revocation and erasure.                                                                                                | `@cosys/crypto`, `@cosys/record`.                |
| [`@cosys/posts`](https://www.npmjs.com/package/@cosys/posts)   | The social modality: posts, reactions and reshares to a circle, with audience routing and landing rules.                                                                                      | `@cosys/crypto`, `@cosys/record`.                |
| [`@cosys/bridge`](https://www.npmjs.com/package/@cosys/bridge) | The actor at the network's edge that turns a foreign protocol, such as a lab's FHIR or CSV export, into signed rows deposited into one patient's mailbox. Runs on a server, never on a phone. | `@cosys/crypto`, `@cosys/peer`, `@cosys/record`. |
| [`piroh`](https://crates.io/crates/piroh) (Rust)               | The iroh endpoint `@cosys/peer` drives as its direct transport.                                                                                                                               | `iroh`                                           |
| [`prelay`](https://crates.io/crates/prelay) (Rust)             | The relay server: `iroh-relay` with an access check, so only the application's own builds can use it.                                                                                         | `iroh-relay`                                     |

## Licence

Apache-2.0. See [LICENSE](LICENSE).

## More

Further information, support and collaboration: [https://cosys.work](https://cosys.work).
