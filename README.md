# cosys packages

The source of the five `@cosys` TypeScript packages, exactly as they are published to JSR and npm. They are the shared layer under [TApp](https://cosys.work), a diabetes app, and its clinic desk app: cryptography, an append-only record, peer-to-peer sync, posts, and bridges to other systems. None of them knows about diabetes or any other domain.

| Package | What it is | JSR | npm |
| --- | --- | --- | --- |
| `@cosys/crypto` | Primitives over `@noble`, pinned to exact versions: hashing, signing, ciphers, key agreement, a PIN verifier, base64 and ULIDs. | [jsr](https://jsr.io/@cosys/crypto) | [npm](https://www.npmjs.com/package/@cosys/crypto) |
| `@cosys/record` | The substrate of an append-only record: timestamps, references and tombstones, signed rows, the registries of kinds, roles and claims, and views. | [jsr](https://jsr.io/@cosys/record) | [npm](https://www.npmjs.com/package/@cosys/record) |
| `@cosys/peer` | Sync between devices: identity, pairing, an encrypted wire, a mailbox for delivery while offline, grants, revocation, and erasure with signed receipts. | [jsr](https://jsr.io/@cosys/peer) | [npm](https://www.npmjs.com/package/@cosys/peer) |
| `@cosys/posts` | Posts, reactions, reshares, votes and views as signed rows addressed to an audience. | [jsr](https://jsr.io/@cosys/posts) | [npm](https://www.npmjs.com/package/@cosys/posts) |
| `@cosys/bridge` | Connects a foreign protocol to the peer network: an inbox, a codec to signed rows that each name their origin, and an outbox. Runs on a server. | [jsr](https://jsr.io/@cosys/bridge) | [npm](https://www.npmjs.com/package/@cosys/bridge) |

Each package has its own README in `packages/<name>/` with the API and examples.

## Install

```sh
deno add jsr:@cosys/peer      # Deno
npx jsr add @cosys/peer       # Node.js or Bun, from JSR
npm install @cosys/peer       # Node.js or Bun, from npm
```

They run on Deno, Node.js and Bun. In a React Native or Expo app, install from npm: only the npm copy of `@cosys/crypto` carries the React Native entropy source.

## How this repository is made

The packages are developed in a private repository, `cosys-work/tda`, next to the apps that use them. Each commit here is a sync of one release from there, and its message names the source commit. The workflow in `.github/workflows/publish.yml` publishes that release to JSR with provenance, so each version on JSR links back to the commit that built it.

Changes made here would be overwritten by the next sync, so please do not open pull requests against this repository. Issues are welcome.

## Licence

Apache-2.0. See [LICENSE](LICENSE).

## More

For more information, support, or to collaborate, see [cosys.work](https://cosys.work).
