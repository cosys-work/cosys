# @cosys/qr

A QR code encoder with no dependencies. It encodes text in byte mode at error-correction level M, versions 1 to 20, and returns the matrix of modules. Drawing it is up to you: SVG, a canvas, a terminal.

It was written for pairing codes. A dependency on the pairing path would be a supply-chain risk on the one path that hands a key to someone, so the encoder stays small and is checked against a reference encoder module for module.

## Install

```sh
npm install @cosys/qr
```

It is also on JSR as [`@cosys/qr`](https://jsr.io/@cosys/qr): `deno add jsr:@cosys/qr`, or `npx jsr add @cosys/qr` in a Node project. It has no runtime dependencies.

## Usage

```ts
import { encodeQr } from '@cosys/qr';

const symbol = encodeQr('https://example.org');
// symbol.size    modules along one side, quiet zone excluded
// symbol.version the smallest version that holds the text
// symbol.modules modules[row][col], true where the module is dark

const cell = 4;
const quiet = 4 * cell;
const side = symbol.size * cell + 2 * quiet;
const rects = symbol.modules.flatMap((row, y) =>
  row.flatMap((dark, x) =>
    dark
      ? [`<rect x="${quiet + x * cell}" y="${quiet + y * cell}" width="${cell}" height="${cell}"/>`]
      : [],
  ),
);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}"><rect width="100%" height="100%" fill="#fff"/>${rects.join('')}</svg>`;
```

Leave a quiet zone of four modules round the symbol, as above. Scanners need it.

## API

| Export                       | What it is                                                                                                                                                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `encodeQr(text, options?)`   | Encodes `text` as UTF-8 in the smallest version that holds it, with the mask that scores lowest on the standard's penalty rules. Returns a `QrSymbol`. Throws `QrTooLongError` when the text does not fit version 20. |
| `QrSymbol`                   | `{ size, version, mask, modules }`. `modules[row][col]` is `true` for a dark module.                                                                                                                                  |
| `QrOptions`                  | `{ mask?: number }` pins one of the eight masks instead of scoring them. Useful in tests against another encoder, since two correct encoders can choose different masks.                                              |
| `QrTooLongError`             | The text was longer than version 20 holds at level M, which is 666 bytes.                                                                                                                                             |
| `penalty(modules)`           | The ISO/IEC 18004 §7.8.3.1 penalty score of a masked symbol. Lower is easier to read.                                                                                                                                 |
| `sizeOf(version)`            | Modules along one side for a version: `17 + 4 × version`.                                                                                                                                                             |
| `MIN_VERSION`, `MAX_VERSION` | 1 and 20.                                                                                                                                                                                                             |

## What it does not do

- **Other modes and levels.** Only byte mode and level M. Byte mode carries any text, including the lowercase letters, `-` and `_` of a URL or a base64url string, which alphanumeric mode cannot. Level M recovers about 15% of a damaged symbol.
- **Versions above 20.** A symbol that large is hard to scan from a phone screen, so the encoder stops there.
- **Drawing.** It returns modules, not pixels.

## Tests

Each test vector is a string with the symbol a reference encoder (`qrcode-generator` 2.0.4) made for it, and at least one vector exists for every version from 1 to 20. The encoder must reproduce each symbol exactly at one of its eight masks. A wrong table entry, a wrong Galois field product or a misplaced alignment pattern changes the symbol, so the comparison catches it. In the source repository: `npm run qr:test`.

## The cosys packages

| Package                                                        | What it is                                                                                                                                                                                    | Depends on                                      |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| [`@cosys/crypto`](https://www.npmjs.com/package/@cosys/crypto) | Primitives over `@noble`: hashing, signing, ciphers, key agreement, PIN, base64, ULID.                                                                                                        | No workspace packages.                          |
| [`@cosys/record`](https://www.npmjs.com/package/@cosys/record) | The record substrate: time, timestamps and references, tombstones, signed rows, the kinds, roles and claims registries, and views.                                                            | `zod`                                           |
| [`@cosys/log`](https://www.npmjs.com/package/@cosys/log)       | A typed logger: a closed code catalogue each app declares, primitive fields only, a buffered queue and an injected sink.                                                                      | `@cosys/crypto`, `@cosys/record`                |
| [`@cosys/qr`](https://www.npmjs.com/package/@cosys/qr)         | A QR encoder with no dependencies: byte mode, level M, versions 1 to 20. Returns the module matrix.                                                                                           | No workspace packages.                          |
| [`@cosys/peer`](https://www.npmjs.com/package/@cosys/peer)     | The networking half: identity, pairing, the wire, the mailbox, grants, revocation and erasure.                                                                                                | `@cosys/crypto`, `@cosys/record`                |
| [`@cosys/posts`](https://www.npmjs.com/package/@cosys/posts)   | The social modality: posts, reactions and reshares to a circle, with audience routing and landing rules.                                                                                      | `@cosys/crypto`, `@cosys/record`                |
| [`@cosys/bridge`](https://www.npmjs.com/package/@cosys/bridge) | The actor at the network's edge that turns a foreign protocol, such as a lab's FHIR or CSV export, into signed rows deposited into one patient's mailbox. Runs on a server, never on a phone. | `@cosys/crypto`, `@cosys/peer`, `@cosys/record` |
| [`piroh`](https://crates.io/crates/piroh) (Rust)               | The iroh endpoint `@cosys/peer` drives as its direct transport.                                                                                                                               | `iroh`                                          |
| [`prelay`](https://crates.io/crates/prelay) (Rust)             | The relay server: `iroh-relay` with an access check, so only the application's own builds can use it.                                                                                         | `iroh-relay`                                    |

## Licence

Apache-2.0. See [LICENSE](./LICENSE).

## More

For further information, support and collaboration, see [cosys.work](https://cosys.work).
