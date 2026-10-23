# @cosys/bridge

`@cosys/bridge` is the core of a protocol bridge for the cosys peer network. A bridge is a peer with two faces. Toward a foreign system (a lab's FHIR feed, a folder of CSV exports, anything else) it is an inbox that takes what arrives as untrusted input. Toward the network it is an outbox that signs `bridge:` rows under the bridge's own key, each naming where it came from, and deposits them into one patient's mailbox. This package holds the parts every bridge shares: the codec and inbox interfaces, the outbox, the loop that joins them, pairing by one-time code, erasure with a signed receipt, and the state a bridge keeps between runs. It is for developers who want to carry records from a foreign system into a patient's record. You write the inbox and the codec for your protocol; the package does the rest. A bridge runs on a server or on a clinic's own machine, never on a phone. It carries results as the foreign side sent them and does not interpret them.

## Status

Version 0.1.0. This is an early release and the API may change before 1.0.

The package ships TypeScript sources, not compiled JavaScript: every entry in `exports` points at a `.ts` file under `src/`. You need a TypeScript-aware bundler or runtime to use it. The sources use extensionless relative imports, which Node's own ES module loader does not resolve, so a Node service should be bundled before it runs. The repository's own lab bridge bundles its entry point with esbuild (`platform: 'node'`, `format: 'esm'`, `bundle: true`) into a single file and runs that with Node 24; nothing else is installed on the machine. When type-checking against the sources, `moduleResolution: "bundler"` is the setting they are written for.

Tests are not part of the published package.

## Install

```sh
npm install @cosys/bridge zod
```

It is also on JSR as [`@cosys/bridge`](https://jsr.io/@cosys/bridge): `deno add jsr:@cosys/bridge`, or `npx jsr add @cosys/bridge` in a Node project.

`@cosys/bridge` depends on three sibling packages, installed with it:

- `@cosys/crypto`: hashing, signing, hex and base64, random bytes, ULIDs.
- `@cosys/peer`: identities, the sealed mailbox frame, the directory and provisioning clients, bridge row signing and the pairing digest.
- `@cosys/record`: the `bridge:` kinds and their schemas, the protocol list for origins, and the import-shape registry.

`zod` (version 4) comes in through `@cosys/record`. Install it yourself as well, because a bridge registers the shape of what it imports as a zod schema. `@cosys/crypto` lists `expo-crypto` as an optional peer dependency; it is for React Native and a Node bridge does not need it. `service/file-state` uses `node:fs`, so add `@types/node` if you type-check it.

## Import paths

The `exports` field has one entry:

```json
"exports": { "./*": "./src/*.ts" }
```

There is no root import: `import ... from '@cosys/bridge'` does not resolve. Each module is reached by its path under `src/`, without the extension, and the pattern covers the `service/` folder too:

| import                             | file                        |
| ---------------------------------- | --------------------------- |
| `@cosys/bridge/codec`              | `src/codec.ts`              |
| `@cosys/bridge/inbox`              | `src/inbox.ts`              |
| `@cosys/bridge/outbox`             | `src/outbox.ts`             |
| `@cosys/bridge/loop`               | `src/loop.ts`               |
| `@cosys/bridge/pairing`            | `src/pairing.ts`            |
| `@cosys/bridge/erasure`            | `src/erasure.ts`            |
| `@cosys/bridge/state`              | `src/state.ts`              |
| `@cosys/bridge/service/file-state` | `src/service/file-state.ts` |
| `@cosys/bridge/service/network`    | `src/service/network.ts`    |
| `@cosys/bridge/service/tick`       | `src/service/tick.ts`       |

## What's inside

### `codec`

The translation from one foreign object to zero or more `bridge:` rows. A codec is pure: it does not sign, send, remember or look anything up. It says which foreign subject its rows are for, and the loop finds the patient.

- `Codec<Foreign>`: an object with `decode(item: Received<Foreign>): Decoded`.
- `Decoded`: one of three outcomes. `{ outcome: 'write', subject, rows }` proposes rows for one foreign subject. `{ outcome: 'defer', reason, subject? }` means not yet (a report still preliminary, say); the item is kept and retried on the next run, and giving the subject lets an erasure drop it. `{ outcome: 'refuse', reason }` means never.
- `BridgeRowDraft<K>`: a row before signing: `kind`, `occurredAt` (when the foreign side says it happened) and `body` (the kind's body input from `@cosys/record/bridge`).
- `keepForeign(raw)`: the foreign object as an import keeps it. Verbatim when its text is no longer than `FOREIGN_TEXT_MAX` (16,000 characters), otherwise by its SHA-256 digest and byte length.
- `originOfDraft(draft)`: the origin a draft names, or `null` for a receipt.

### `inbox`

The foreign face. An inbox authenticates what arrives in whatever way the foreign protocol needs and yields it as untrusted input.

- `Received<Foreign>`: one item: `key` (the inbox's own stable name for it, so a deferred item is retried under the same key), `object`, `raw` (`{ mediaType, text }`, as the foreign side sent it) and `receivedAt`.
- `Inbox<Foreign>`: `take()` returns what arrived since the last call; the optional `settle(item, outcome, reason?)` is told what became of each item, for an inbox that answers its foreign side (an HTTP status, an acknowledgement file).
- `Settlement`: `'written' | 'duplicate' | 'deferred' | 'refused'`.
- `listInbox(items)`: an inbox over a fixed list, with a `settled` array recording each outcome. For tests and one-off imports.

### `outbox`

The network face. `createOutbox(options: OutboxOptions): Outbox` returns an object with `deliver(patient, drafts)`, which signs each draft for that patient with `signBridgeRow` from `@cosys/peer`, packs the rows into batch messages of at most 512 followed by a done message, seals them as one mailbox frame to the patient's certified mailbox key, deposits it, and returns the signed rows. `OutboxOptions` takes the bridge's `identity`, an `instance` label (which running copy this is, a short lowercase label such as `estate-1`, signed into every row), `addressOf(patient)`, `depositTo(patient)` and an optional `now`. Importing this module registers the `bridge:` kinds (`@cosys/record/bridge-kinds`).

### `loop`

`runOnce(options: LoopOptions<Foreign>): Promise<RunReport>` runs inbox, codec and outbox once. `LoopOptions` takes `inbox`, `codec`, `outbox`, `state`, an optional `deferForDays` and an optional `now`. `RunReport` counts `written` items, `rows` deposited, and `duplicate`, `deferred` and `refused` items. `DEFER_FOR_DAYS` is 30: an item still deferred that long after it arrived is refused with the reason, since it is someone's data held by a bridge nobody asked to hold it. A codec that throws refuses the item rather than stopping the run.

### `pairing`

How a bridge learns which foreign subject is which patient.

- `offerPairing({ bridgeKey, subject, state, expiresAt })`: makes a fresh one-time code (16 random bytes as 32 hex characters), stores only its digest against the subject, and returns the code once.
- `pairingCodeDigest(bridgeKey, code)`: re-exported from `@cosys/peer`. The digest is bound to the bridge key, so a code offered by one bridge pairs nothing at another.
- `acceptPairings({ rows, bridgeKey, state, now? })`: applies the patients' signed assertions among `rows`. A `paired_with` assertion about this bridge key, naming one valid origin as the subject and one digest as evidence, pairs that subject with the signer, but only if the digest was offered for that subject, is unused and unexpired; the code is then spent. A `revoked` assertion about a `paired_with` row ends that pairing if the same patient made it. Returns a `PairingReport` (`paired`, `unpaired`, `refused`).
- `collectInbound({ identity, mailbox, state, now? })`: collects one of the bridge's mailboxes, opens each frame with the bridge's key, keeps a row only if it parses and its signer is the patient who deposited the frame, applies the pairings, purges the collected frames, and returns `{ rows, pairing, unreadable }` so the caller can act on the rest (erasure requests).

### `erasure`

`answerErasures(options: ErasureOptions): Promise<ErasureReport>` answers the erasure requests among collected rows. For each request addressed to this bridge and not yet answered it calls `state.forget(requester)`, then delivers one `bridge:receipt` to the patient naming the request (by row id and digest), when it purged, the row ids it had written for them, its backup window, and the operator's statement of what the foreign side keeps. `ErasureOptions` takes `rows`, `identity`, `state`, `outbox`, `foreignKeeps`, `backupWindowDays` and an optional `now`. `ErasureReport` counts `answered`, and `ignored` for requests that name another holder or are not signed by the patient they name.

### `state`

What a bridge remembers between runs.

- `BridgeState`: the interface the loop, pairing and erasure use. Origins written (`rowsFor`, `remember`), subject pairings (`patientOf`, `pair`, `unpairByAssertion`, `patients`), one-time codes (`offerPairing`, `claimOffer`, `openOffers`), deferred items (`deferred`, `defer`, `undefer`), erasure (`forget`) and answered requests (`answered`, `markAnswered`).
- `StateData`: the same as plain JSON-ready data (`version: 1`, `written`, `answered`, `subjects`, `byAssertion`, `offers`, `waiting`).
- `emptyStateData()`, `stateOver(data, saved)` (a state over `data` that calls `saved` after each change) and `createMemoryState()` (in memory, for tests).

### `service/file-state`

`openFileState(path): Promise<BridgeState>`: the state as one JSON file on the bridge's own volume, rewritten whole after every change through a temporary file and a rename, with writes queued so two changes cannot interleave. The file is written with mode `0600`. A file of another version is an error. Encrypting and backing up the volume is the operator's job.

### `service/network`

`createBridgeNetwork(options: BridgeNetworkOptions): BridgeNetwork` puts a bridge on the network through the same provisioning service, directory and CouchDB mailbox a phone uses. `BridgeNetworkOptions` takes `identity`, `serviceUrl` (the provisioning service and directory), `mailboxUrl` (the CouchDB the mailboxes are on), and optional `fetch` and `now`. The returned `BridgeNetwork` has:

- `publish(patients, offers)`: signs and publishes the bridge's own directory record: its certified mailbox key, every paired patient as an allowed depositor, and an intake naming `INTAKE_GROUP` with the digests of the codes still open and their ends.
- `addressOf(patient)`: the patient's certified mailbox key, from the patient's own directory record.
- `depositTo(patient)`: the patient's mailbox as this bridge deposits into it.
- `inbound(patients)`: the intake group's mailbox first, then one mailbox per paired patient, all collected with the bridge's key.

Also exported: `INTAKE_GROUP` (`'1'`) and `bridgeKeyOf(identity)`, the bridge's key as lowercase hex.

### `service/tick`

- `tick(options: TickOptions<Foreign>): Promise<TickReport>`: one scheduled run of a bridge as a service (see the walk-through below). `TickOptions` takes `identity`, `instance`, `network`, `state`, `inbox`, `codec`, `foreignKeeps`, `backupWindowDays`, and optional `deferForDays` and `now`. `TickReport` has `pairing`, `unreadable`, `erasures` and `loop`.
- `offer({ identity, network, state, subject, days, now? })`: offers a one-time code for one subject, valid for `days`, publishes the bridge's record at once so the code opens the intake before the next run, and returns the code.

## How a bridge works end to end

1. A bridge has an Ed25519 seed; `identityFromSeed` from `@cosys/peer` turns it into the bridge's identity. The operator signs a directory entry for the bridge (`SignedBridgeEntry` in `@cosys/peer`) naming its key, who runs it, the protocols it reads, the kinds it may write and its backup window. A patient's app accepts the entry only when it is signed by a directory key the app ships.
2. For a patient the foreign side knows (a subject such as `csv:site-1/17`), the operator calls `offer`. The bridge stores the code's digest with an expiry and publishes it in its record. The code goes back once to the operator's tooling, which builds an invite with `encodeBridgeInvite` from `@cosys/peer` (prefix `tapp://bridge/1/`, carrying the signed entry, the subject and the code) for the foreign side to print as a QR code.
3. The patient's app scans the invite, checks the entry, and signs a `paired_with` assertion about the bridge key, with the subject as its origin and the code's digest as evidence. The provisioning service gives one deposit into the bridge's intake group to whoever presents a code whose digest the bridge's record lists, once, and the app sends its assertion through it.
4. Each `tick` starts by collecting the intake group and each paired patient's mailbox (`collectInbound`). Pairing assertions are applied as they are read: the offer is claimed, the subject is paired with the signing patient, and the code cannot be used again. A `revoked` assertion from the same patient ends the pairing. Frames are purged after they are applied.
5. Erasure requests among the collected rows are answered next, before anything is written for that patient. The bridge forgets the origins it wrote for them, every subject paired with them and every deferred item for those subjects, and deposits a `bridge:receipt` listing the purged row ids, its backup window and what the foreign side keeps. A re-delivered request finds its answer recorded and is skipped.
6. `runOnce` takes the items deferred last time and then what the inbox has. For each, the codec writes, defers or refuses. A subject with no paired patient is deferred, so a result that arrives before its patient pairs is held, for at most `deferForDays`. Rows whose origin was already written are dropped; the rest are signed under the bridge key and the instance key and deposited in one frame to that patient. The state records which origins were written to whom, and the inbox is told each outcome.
7. The run ends by publishing the bridge's record: the patients paired now (who may deposit to it, for instance to ask it to erase) and the codes still open.

A clinic running its own bridge already knows its patients and can pair a subject directly with `state.pair(subject, patientKey)` instead of steps 2 and 3.

## Usage

### A codec for one import shape

A `bridge:import` body names a registered import shape, and its `body` must match it. Register the shape before the first run, in the bridge and in whatever reads the rows: the row schema checks the body against it. A draft that fails its schema throws from `deliver`.

```ts
import { keepForeign, type Codec } from '@cosys/bridge/codec';
import { registerImportShapes } from '@cosys/record/bridge';
import { originOf } from '@cosys/record/protocols';
import { z } from 'zod';

registerImportShapes('example', {
  example_reading: z.strictObject({ value: z.number(), unit: z.string() }),
});

interface Reading {
  readonly subject: string; // the subject as offered, e.g. 'csv:site-1/17'
  readonly id: string;
  readonly value: number;
  readonly unit: string;
  readonly takenAt: string;
  readonly final: boolean;
}

export const readingCodec: Codec<Reading> = {
  decode(item) {
    const reading = item.object;
    if (!reading.final) {
      return { outcome: 'defer', reason: 'not final yet', subject: reading.subject };
    }
    const origin = originOf('csv', `site-1/${reading.id}`);
    if (origin === null) return { outcome: 'refuse', reason: 'no usable identifier' };
    return {
      outcome: 'write',
      subject: reading.subject,
      rows: [
        {
          kind: 'bridge:import' as const,
          occurredAt: reading.takenAt,
          body: {
            refs: [{ role: 'origin', to: origin, kind: 'origin' as const }],
            as: 'example_reading',
            body: { value: reading.value, unit: reading.unit },
            foreign: keepForeign(item.raw),
          },
        },
      ],
    };
  },
};
```

### An inbox

```ts
import type { Inbox, Received } from '@cosys/bridge/inbox';

export function queueInbox(queue: Received<Reading>[]): Inbox<Reading> {
  return {
    async take() {
      return queue.splice(0, queue.length);
    },
    async settle(item, outcome, reason) {
      // Answer the foreign side here, by item.key. Log outcomes, never contents.
    },
  };
}
```

### A bridge as a service

```ts
import { readFileSync } from 'node:fs';
import { hexToBytes } from '@cosys/crypto';
import { identityFromSeed } from '@cosys/peer';
import { openFileState } from '@cosys/bridge/service/file-state';
import { createBridgeNetwork } from '@cosys/bridge/service/network';
import { tick } from '@cosys/bridge/service/tick';

const seed = hexToBytes(readFileSync(process.env.BRIDGE_SEED_FILE!, 'utf8').trim());
const identity = identityFromSeed('bridge-estate-1', seed);
const network = createBridgeNetwork({
  identity,
  serviceUrl: process.env.BRIDGE_SERVICE_URL!,
  mailboxUrl: process.env.BRIDGE_MAILBOX_URL!,
});
const state = await openFileState(process.env.BRIDGE_STATE_FILE!);

// readingCodec and queueInbox are the examples above; queue is filled by your foreign endpoint.

const report = await tick({
  identity,
  instance: 'estate-1',
  network,
  state,
  inbox: queueInbox(queue),
  codec: readingCodec,
  foreignKeeps: process.env.BRIDGE_FOREIGN_KEEPS!,
  backupWindowDays: 30,
});
console.log(JSON.stringify(report)); // counts only
```

Run `tick` on a schedule. Every step is idempotent by origin: a run that dies after depositing and before remembering deposits again on the next run, and the patient's app keeps one row per origin.

### Offering a code and printing the invite

```ts
import { readFileSync } from 'node:fs';
import { encodeBridgeInvite, type SignedBridgeEntry } from '@cosys/peer';
import { offer } from '@cosys/bridge/service/tick';

const subject = 'csv:site-1/17';
const code = await offer({ identity, network, state, subject, days: 90 });
const signed = JSON.parse(
  readFileSync(process.env.BRIDGE_ENTRY_FILE!, 'utf8'),
) as SignedBridgeEntry;
const invite = encodeBridgeInvite({ signed, subject, code });
// Hand `invite` to the foreign side to print. Do not log or store the code.
```

## Design rules the code enforces

- Every bridged row names its origin. The `bridge:import`, `bridge:message` and `bridge:ack` schemas in `@cosys/record` require exactly one `origin` of the form `<protocol>:<foreign id>`, from a closed protocol list (`fhir`, `csv`, `nostr`, `activitypub`, `atproto`, `matrix`, `zot`). A receipt names the request it answers instead.
- An origin is written once. The state remembers which origins were written, and the loop drops a draft whose origin is already there, so the same object exported twice, or read by two runs, becomes one row. A corrected result has a new foreign identifier and lands beside the first.
- A row lands only for the patient who paired. A codec names a foreign subject, never a patient. The loop looks the subject up in the state and defers a subject nobody has paired. Each signed row carries the patient's key, and the patient's app (`verifyBridgeRow` in `@cosys/peer`) refuses a row for another patient, from a bridge it did not pair with, or of a kind the bridge's entry does not permit.
- A patient number printed on paper is guessable, so a pairing assertion counts only with the digest of a code the bridge offered for that subject, unused and unexpired. The code is then spent.
- `offerPairing` returns the code once and keeps only `pairingCodeDigest(bridgeKey, code)`. The published record lists digests, never codes.
- Every row has two signatures. The bridge key signs what the patient paired with, and an instance key derived from the bridge seed and the `instance` label signs which running copy wrote it.
- `collectInbound` keeps an inbound row only if its signer is the patient who deposited the frame.
- A deferred item is refused after `deferForDays` (30 by default).
- An erasure drops everything the bridge holds for the requester, whatever scope the request names, and each request is answered once. Every receipt states the backup window and what the foreign side keeps, which the bridge cannot reach. The bridge keeps the ids of rows it sent and no copy of the rows.
- Nothing in the sources names a host. The service and mailbox addresses are configuration passed to `createBridgeNetwork`.

## The cosys packages

| package                                                        | what it is                                                                                                                         | depends on                                      |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| [`@cosys/crypto`](https://www.npmjs.com/package/@cosys/crypto) | Primitives over @noble: hashing, signing, ciphers, key agreement, PIN, base64, ULID.                                               | no workspace packages                           |
| [`@cosys/record`](https://www.npmjs.com/package/@cosys/record) | The record substrate: time, timestamps and references, tombstones, signed rows, the kinds, roles and claims registries, and views. | zod                                             |
| [`@cosys/peer`](https://www.npmjs.com/package/@cosys/peer)     | The networking half: identity, pairing, the wire, the mailbox, grants, revocation and erasure.                                     | `@cosys/crypto`, `@cosys/record`                |
| [`@cosys/posts`](https://www.npmjs.com/package/@cosys/posts)   | The social modality: posts, reactions and reshares to a circle, with audience routing and landing rules.                           | `@cosys/crypto`, `@cosys/record`                |
| [`@cosys/bridge`](https://www.npmjs.com/package/@cosys/bridge) | This package: the bridge core, inbox, codec, outbox, loop, pairing, erasure and state.                                             | `@cosys/crypto`, `@cosys/peer`, `@cosys/record` |
| [`piroh`](https://crates.io/crates/piroh) (Rust)               | The iroh endpoint `@cosys/peer` drives as its direct transport.                                                                    | `iroh`                                          |
| [`prelay`](https://crates.io/crates/prelay) (Rust)             | The relay server: `iroh-relay` with an access check, so only the application's own builds can use it.                              | `iroh-relay`                                    |

## Licence

Apache-2.0. See [LICENSE](LICENSE).

## More

For further information, support and collaboration, see [cosys.work](https://cosys.work).
