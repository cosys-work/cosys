# cosys packages

The source of the seven `@cosys` TypeScript packages, exactly as they are published to JSR and npm. They are the shared layer under [TApp](https://cosys.work), a diabetes app, and its clinic desk app: cryptography, an append-only record, logging, QR codes, peer-to-peer sync, posts, and bridges to other systems. None of them knows about diabetes or any other domain.

| Package | What it is | JSR | npm |
| --- | --- | --- | --- |
| `@cosys/crypto` | Primitives over `@noble`, pinned to exact versions: hashing, signing, ciphers, key agreement, a PIN verifier, base64 and ULIDs. | [jsr](https://jsr.io/@cosys/crypto) | [npm](https://www.npmjs.com/package/@cosys/crypto) |
| `@cosys/record` | The substrate of an append-only record: timestamps, references and tombstones, signed rows, the registries of kinds, roles and claims, and views. | [jsr](https://jsr.io/@cosys/record) | [npm](https://www.npmjs.com/package/@cosys/record) |
| `@cosys/log` | A typed logger: a closed code catalogue, primitive fields only, a buffered queue that never blocks, a sink the app supplies, and crash capture. | [jsr](https://jsr.io/@cosys/log) | [npm](https://www.npmjs.com/package/@cosys/log) |
| `@cosys/qr` | A QR code encoder with no dependencies: byte mode at level M, versions 1 to 20. It returns the matrix; drawing is yours. | [jsr](https://jsr.io/@cosys/qr) | [npm](https://www.npmjs.com/package/@cosys/qr) |
| `@cosys/peer` | Sync between devices: identity, pairing, an encrypted wire, a mailbox for delivery while offline, grants, revocation, and erasure with signed receipts. | [jsr](https://jsr.io/@cosys/peer) | [npm](https://www.npmjs.com/package/@cosys/peer) |
| `@cosys/posts` | Posts, reactions, reshares, votes and views as signed rows addressed to an audience. | [jsr](https://jsr.io/@cosys/posts) | [npm](https://www.npmjs.com/package/@cosys/posts) |
| `@cosys/bridge` | Connects a foreign protocol to the peer network: an inbox, a codec to signed rows that each name their origin, and an outbox. Runs on a server. | [jsr](https://jsr.io/@cosys/bridge) | [npm](https://www.npmjs.com/package/@cosys/bridge) |

Each package has its own README in `packages/<name>/` with the API and examples.

The repository also holds Lean 4 proofs of the model behind the packages, in `proofs/`. See
[Proofs](#proofs).

## Install

```sh
deno add jsr:@cosys/peer      # Deno
npx jsr add @cosys/peer       # Node.js or Bun, from JSR
npm install @cosys/peer       # Node.js or Bun, from npm
```

They run on Deno, Node.js and Bun. In a React Native or Expo app, install from npm: only the npm copy of `@cosys/crypto` carries the React Native entropy source.

## Proofs

`proofs/` holds Lean 4 proofs of the results in our paper *Collaboration Without Orchestration:
composable Mealy machines over signed records, and trust as a fibration over observers*. `CosysCore`,
in core Lean, covers the polynomial-functor results, registries as a dynamic multicategory, gluing of
record sets and trust as a fibration over observers. `CosysCalco`, on Mathlib, covers congruence,
order independence for monotone boxes, claims as types and grades. Build instructions and a map from
files to results are in [proofs/README.md](proofs/README.md).

## How this repository is made

The packages are developed in a private repository, `cosys-work/tda`, next to the apps that use them. Each commit to `packages/` here is a sync of one release from there, and its message names the source commit. The workflow in `.github/workflows/publish.yml` publishes that release to JSR with provenance, so each version on JSR links back to the commit that built it.

Changes to `packages/` made here would be overwritten by the next sync, so please do not open pull requests against them. Issues are welcome, for the packages and for the proofs.

## Licence

Apache-2.0. See [LICENSE](LICENSE).

## More

For more information, support, or to collaborate, see [cosys.work](https://cosys.work).
