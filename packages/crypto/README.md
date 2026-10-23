# @cosys/crypto

`@cosys/crypto` is a small set of cryptographic primitives written in TypeScript over exactly pinned versions of `@noble/hashes`, `@noble/ciphers` and `@noble/curves`. It covers SHA-256 and HMAC, Argon2id and HKDF, XChaCha20-Poly1305 (one-shot and as a chunked stream), Ed25519 signatures, X25519 key agreement, a PIN verifier, and the byte, base64 and ULID helpers the rest builds on. It was written so that one package owns every cryptographic call in an offline-first React Native app and a desktop companion app, and so that the same code runs unchanged in Node for tests. It is for developers who want a narrow surface over `@noble` with a defined entropy source on React Native (Hermes) as well as on runtimes that have Web Crypto. It knows nothing about records, users or networks.

## Status

This is version 0.1.0. It is early, and the API may change before 1.0.

The package ships TypeScript sources, not compiled JavaScript: the `exports` in its manifest point at `./src/*.ts`. To use it you need a toolchain that compiles TypeScript from `node_modules`, such as Metro (React Native and Expo), Vite, esbuild, tsx, Bun or Deno. Plain `node` without a TypeScript loader will not run it. If your bundler skips `node_modules` when transpiling, add `@cosys/crypto` to the list of packages it compiles. The sources are ES modules (`"type": "module"`).

## Install

```sh
npm install @cosys/crypto
```

It is also on JSR as [`@cosys/crypto`](https://jsr.io/@cosys/crypto): `deno add jsr:@cosys/crypto`, or `npx jsr add @cosys/crypto` in a Node project. The JSR copy leaves out `entropy.native.ts`, the React Native entropy source, so an Expo app installs from npm.

Runtime dependencies. The three `@noble` packages are pinned to exact versions so that every consumer runs the same cryptography:

| Package          | Version  | Used for                                     |
| ---------------- | -------- | -------------------------------------------- |
| `@noble/hashes`  | `2.4.0`  | SHA-256, HMAC, Argon2id, HKDF                |
| `@noble/ciphers` | `2.4.0`  | XChaCha20-Poly1305, constant-time comparison |
| `@noble/curves`  | `2.4.0`  | Ed25519, X25519                              |
| `zod`            | `^4.6.5` | the PIN verifier schema                      |

Optional peer dependency:

| Package       | Version   | When you need it                                                                                     |
| ------------- | --------- | ---------------------------------------------------------------------------------------------------- |
| `expo-crypto` | `~57.0.3` | React Native / Expo, where the runtime has no Web Crypto. Not needed in Node, browsers, Bun or Deno. |

Outside React Native the runtime must provide `globalThis.crypto.getRandomValues` (Node 20 or later, current browsers and webviews, Bun, Deno).

## Import paths

The `exports` field is:

```json
{
  ".": "./src/index.ts",
  "./*": "./src/*.ts"
}
```

So there are two ways in.

The root entry exports the cryptographic surface: parameters, KDF, AEAD, stream, hashing, PIN, signing, X25519 and HKDF, constant-time comparison and random helpers.

```ts
import { seal, open, randomKey, randomNonce } from '@cosys/crypto';
```

Every source file is also reachable as a subpath. Three modules are only available this way, because the root entry does not re-export them:

```ts
import { toBase64, fromBase64 } from '@cosys/crypto/base64';
import { utf8, fromUtf8, concatBytes, createByteReader } from '@cosys/crypto/bytes';
import { ulid, isUlid, ulidTime } from '@cosys/crypto/ulid';
```

The other modules (`params`, `kdf`, `cipher`, `stream`, `hash`, `pin`, `signing`, `curves`, `compare`, `random`) can also be imported by subpath, for example `@cosys/crypto/signing`, but everything in them is already on the root entry. Do not import `@cosys/crypto/entropy` or `@cosys/crypto/entropy.native` directly; see "Entropy" below for how the right one is chosen.

## What's inside

### Parameters (`params`)

| Export                                                | What it is                                                                                                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `KDF_ALGORITHM`, `CIPHER_ALGORITHM`, `HASH_ALGORITHM` | The algorithm ids `'argon2id'`, `'xchacha20poly1305'`, `'sha256'`, for writing into a self-describing file header or manifest.                               |
| `KEY_BYTES`, `NONCE_BYTES`, `SALT_BYTES`, `TAG_BYTES` | 32, 24, 16 and 16.                                                                                                                                           |
| `Argon2idParams` (type)                               | `{ m, t, p }`: memory in KiB, iterations, lanes.                                                                                                             |
| `DEFAULT_ARGON2ID_PARAMS`                             | `{ m: 32768, t: 3, p: 1 }`, for passphrase-derived keys.                                                                                                     |
| `PIN_ARGON2ID_PARAMS`                                 | `{ m: 8192, t: 1, p: 1 }`, the lighter set used by version 1 PIN verifiers.                                                                                  |
| `assertArgon2idParams(params)`                        | Throws `InvalidParametersError` unless `m` is an integer in [8, 524288], `t` in [1, 16] and `p` in [1, 4]. Use it on parameters read from an untrusted file. |
| `InvalidParametersError`                              | The error above.                                                                                                                                             |

### Key derivation (`kdf`)

| Export                                  | What it does                                                                                                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `deriveKey(secret, salt, options?)`     | Argon2id, async. `secret` is a string or bytes, `salt` at least 8 bytes. Yields to the event loop every `tickMs` (default 10 ms) so a progress indicator keeps moving. Resolves to `keyLength` bytes (default 32). |
| `deriveKeySync(secret, salt, options?)` | The same derivation, blocking. Suited to tests and scripts.                                                                                                                                                        |
| `DeriveOptions` (type)                  | `{ params?, keyLength?, onProgress?(fraction), tickMs? }`. `params` defaults to `DEFAULT_ARGON2ID_PARAMS` and is checked with `assertArgon2idParams`.                                                              |

### Authenticated encryption (`cipher`)

XChaCha20-Poly1305. The 24-byte nonce is wide enough that random nonces from `randomNonce()` are safe.

| Export                                          | What it does                                                                                                                                              |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seal(key, nonce, plaintext, associatedData?)`  | Encrypts and appends the 16-byte tag.                                                                                                                     |
| `open(key, nonce, ciphertext, associatedData?)` | Decrypts and verifies. Throws `DecryptionError` on a wrong key, nonce, associated data or tag; throws `TypeError` for a key or nonce of the wrong length. |
| `tryOpen(...)`                                  | As `open`, but returns `null` instead of throwing `DecryptionError`.                                                                                      |
| `DecryptionError`                               | Carries no detail about why decryption failed.                                                                                                            |

### Chunked stream encryption (`stream`)

A STREAM construction, the same shape `age` and libsodium's `secretstream` use, for data too large to hold in memory. Plaintext is cut into 64 KiB chunks, and each is sealed as a frame `uint32be length | ciphertext‖tag`. Each chunk's nonce is a 16-byte random base, a 7-byte big-endian counter and a final-chunk flag byte.

| Export                                              | What it does                                                                                                                                                                                                                                                    |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sealStream(key, base, plaintext, associatedData?)` | Async generator: takes an `AsyncIterable<Uint8Array>` of plaintext in any chunk sizes, yields framed ciphertext. Empty input still yields one final frame.                                                                                                      |
| `openStream(key, base, frames, associatedData?)`    | Async generator: yields plaintext chunks. Throws `DecryptionError` for a wrong key, changed associated data, reordered or altered chunks, and `StreamFormatError` for a malformed frame, a stream that ends before its final chunk, or trailing bytes after it. |
| `opensStream(key, base, frames, associatedData?)`   | Reads only the first frame and resolves `true` or `false`: does this key open this stream? Useful to check a passphrase without decrypting everything.                                                                                                          |
| `chunkNonce(base, index, final)`                    | The per-chunk nonce, exported so the construction can be tested directly.                                                                                                                                                                                       |
| `STREAM_CHUNK_BYTES`                                | 65536.                                                                                                                                                                                                                                                          |
| `STREAM_NONCE_BASE_BYTES`                           | 16. Generate the base with `randomBytes(STREAM_NONCE_BASE_BYTES)` and store it beside the stream.                                                                                                                                                               |
| `StreamFormatError`                                 | The format error above.                                                                                                                                                                                                                                         |

### Hashing (`hash`)

| Export                                 | What it does                                                                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `createSha256Stream()`                 | Incremental SHA-256 returning a `Sha256Stream` with `update(chunk)`, `digest()` and `hex()`. Throws if used after it has finished. |
| `Sha256Stream` (type)                  | The interface above.                                                                                                               |
| `sha256Bytes(data)`, `sha256Hex(data)` | One-shot SHA-256 as bytes or lowercase hex.                                                                                        |
| `hmacSha256(key, message)`             | HMAC-SHA256 (RFC 2104).                                                                                                            |
| `bytesToHex(bytes)`, `hexToBytes(hex)` | Hex conversion from `@noble/hashes`. `hexToBytes` throws on input that is not an even-length run of hex digits.                    |

### Signatures (`signing`)

Ed25519. There is no key storage here; persisting a key is the caller's decision.

| Export                                           | What it does                                                                             |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `generateSigningKey()`                           | A fresh 32-byte secret key, seeded from this package's entropy source.                   |
| `signingPublicKey(secretKey)`                    | The 32-byte public key.                                                                  |
| `sign(message, secretKey)`                       | A 64-byte signature.                                                                     |
| `verifySignature(signature, message, publicKey)` | `true` or `false`. Returns `false` rather than throwing on a malformed signature or key. |

### Key agreement and HKDF (`curves`)

| Export                                     | What it does                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| `x25519KeyPair(seed)`                      | An X25519 key pair from a 32-byte seed. The seed is required; pass `randomBytes(32)`. |
| `X25519KeyPair` (type)                     | `{ secretKey, publicKey }`, 32 bytes each.                                            |
| `x25519PublicKey(secretKey)`               | The public key for a secret key.                                                      |
| `x25519SharedSecret(secretKey, publicKey)` | The shared secret. Throws on a low-order public key.                                  |
| `hkdfSha256(ikm, salt, info, length)`      | HKDF (RFC 5869) over SHA-256. `salt` and `info` may be `undefined`.                   |

### PIN verifier (`pin`)

A stored record that checks a short PIN without holding it. The record contains a salt and a hash, no secret, and is meant to be stored as JSON.

| Export                                                                                         | What it does                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createPinVerifier(pin, pinKey)`                                                               | Version 2 record: `HMAC-SHA256(pinKey, salt ‖ pin)` under a 32-byte key the caller keeps in platform secure storage. Fast.                                                                                       |
| `createArgon2idPinVerifier(pin, options?)`                                                     | Version 1 record, Argon2id with its parameters stored in the record. Kept so older records can be created and checked.                                                                                           |
| `verifyPin(pin, verifier, { pinKey, onProgress? })`                                            | Resolves `true` or `false`, comparing in constant time. Version 1 records are re-derived at the parameters they were stored with. For a version 2 record with `pinKey: null` it throws `PinKeyUnavailableError`. |
| `parsePinVerifier(value)`                                                                      | Validates an unknown value against `pinVerifierSchema`; returns the record or `null`.                                                                                                                            |
| `pinVerifierSchema`                                                                            | The zod schema (a discriminated union on `kdf`).                                                                                                                                                                 |
| `isDeviceBoundVerifier(verifier)`                                                              | `true` for a version 2 record, which cannot be checked without its key and so should not be expected to work after a move to another device.                                                                     |
| `PIN_KEY_BYTES`                                                                                | 32.                                                                                                                                                                                                              |
| `PinKeyUnavailableError`                                                                       | Thrown as above. It never means "accept".                                                                                                                                                                        |
| `PinVerifier`, `HmacPinVerifier`, `Argon2idPinVerifier`, `PinOptions`, `VerifyOptions` (types) | The record shapes and option bags.                                                                                                                                                                               |

A PIN is trimmed of surrounding whitespace before use and is otherwise taken exactly as given.

### Randomness and comparison (`random`, `compare`)

| Export                                         | What it does                                                                                                                                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `randomBytes(n)`                               | `n` bytes from the platform CSPRNG.                                                                                                                                                                                 |
| `randomKey()`, `randomSalt()`, `randomNonce()` | 32, 16 and 24 random bytes, so a call site cannot ask for the wrong size.                                                                                                                                           |
| `installGlobalRandom()`                        | On React Native, installs `globalThis.crypto.getRandomValues` backed by `expo-crypto` if the runtime has none. Elsewhere it only checks that Web Crypto is present. It runs on import; you do not normally call it. |
| `constantTimeEqual(a, b)`                      | Byte comparison via `@noble/ciphers`' `equalBytes`. Length is not treated as secret.                                                                                                                                |

### Bytes (`@cosys/crypto/bytes`, subpath only)

| Export                                             | What it does                                                                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `utf8(text)`, `fromUtf8(bytes)`                    | UTF-8 encode and decode.                                                                                                       |
| `concatBytes(chunks)`                              | Joins byte arrays. Meant for small, bounded inputs.                                                                            |
| `rechunk(source, size)`                            | Async generator re-cutting a byte stream into pieces of exactly `size`, with a shorter last piece. Empty input yields nothing. |
| `createByteReader(source)`                         | Returns a `ByteReader` with `exact(n)`, `some(n)`, `done()` and `rest()`, for parsers that need exact lengths from a stream.   |
| `ByteReader` (type)                                | The interface above.                                                                                                           |
| `TruncatedStreamError`                             | Thrown by `exact(n)` when the stream ends partway through the requested bytes.                                                 |
| `writeUint32(value)`, `readUint32(bytes, offset?)` | Big-endian unsigned 32-bit integers.                                                                                           |

### Base64 (`@cosys/crypto/base64`, subpath only)

| Export             | What it does                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| `toBase64(bytes)`  | Standard padded base64. Does not depend on `btoa`, so output is identical on Hermes, Node and browsers. |
| `fromBase64(text)` | The inverse. Throws `TypeError` on characters outside the base64 alphabet.                              |

### ULID (`@cosys/crypto/ulid`, subpath only)

| Export                    | What it does                                                                                                                                                                                                                                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ulid(now?)`              | A 26-character ULID (Crockford base32) for `now`, default `Date.now()`. Monotonic within a millisecond in one process: a second id in the same millisecond increments the random part, so ids sort in issue order. An explicit timestamp in the past is encoded as given, never clamped. Throws `RangeError` outside 0 to 2^48 - 1. |
| `isUlid(value)`           | `true` for a 26-character string in the ULID alphabet (length and alphabet only).                                                                                                                                                                                                                                                   |
| `ulidTime(value)`         | The millisecond timestamp in a ULID. Throws `TypeError` on a non-ULID.                                                                                                                                                                                                                                                              |
| `ULID_LENGTH`             | 26.                                                                                                                                                                                                                                                                                                                                 |
| `resetUlidMonotonicity()` | Clears the monotonic state. Intended for tests with a fixed clock.                                                                                                                                                                                                                                                                  |

## Usage

### Encrypt a small payload under a passphrase

```ts
import {
  DEFAULT_ARGON2ID_PARAMS,
  deriveKey,
  open,
  randomNonce,
  randomSalt,
  seal,
} from '@cosys/crypto';
import { fromUtf8, utf8 } from '@cosys/crypto/bytes';

const salt = randomSalt();
const params = DEFAULT_ARGON2ID_PARAMS;
const key = await deriveKey('correct horse battery staple', salt, {
  params,
  onProgress: (f) => console.log(`deriving ${Math.round(f * 100)}%`),
});

const nonce = randomNonce();
const header = utf8(JSON.stringify({ v: 1, m: params.m, t: params.t, p: params.p }));
const ciphertext = seal(key, nonce, utf8('hello'), header);

// Store salt, nonce, header and ciphertext. Later, re-derive with the stored params:
const plaintext = fromUtf8(open(key, nonce, ciphertext, header));
```

Passing the header as associated data means a file whose recorded parameters were edited fails to open.

### Encrypt a large stream in 64 KiB frames

```ts
import {
  openStream,
  randomBytes,
  randomKey,
  sealStream,
  STREAM_NONCE_BASE_BYTES,
} from '@cosys/crypto';

const key = randomKey();
const base = randomBytes(STREAM_NONCE_BASE_BYTES);

async function* source(): AsyncIterable<Uint8Array> {
  // Yield file chunks of any size here.
  yield new Uint8Array(200_000);
}

const frames: Uint8Array[] = [];
for await (const part of sealStream(key, base, source())) frames.push(part);

async function* replay() {
  for (const f of frames) yield f;
}
for await (const chunk of openStream(key, base, replay())) {
  // Write each plaintext chunk out as it arrives.
}
```

### Sign, verify and agree a key

```ts
import {
  generateSigningKey,
  hkdfSha256,
  randomBytes,
  sign,
  signingPublicKey,
  verifySignature,
  x25519KeyPair,
  x25519SharedSecret,
} from '@cosys/crypto';
import { utf8 } from '@cosys/crypto/bytes';

const secret = generateSigningKey();
const message = utf8('row 01JA...');
const signature = sign(message, secret);
verifySignature(signature, message, signingPublicKey(secret)); // true

const alice = x25519KeyPair(randomBytes(32));
const bob = x25519KeyPair(randomBytes(32));
const shared = x25519SharedSecret(alice.secretKey, bob.publicKey);
const sessionKey = hkdfSha256(shared, undefined, utf8('example/session/v1'), 32);
```

### Check a PIN and mint ids

```ts
import { createPinVerifier, parsePinVerifier, randomKey, verifyPin } from '@cosys/crypto';
import { ulid, ulidTime } from '@cosys/crypto/ulid';

const pinKey = randomKey(); // keep this in platform secure storage, not beside the verifier
const stored = JSON.stringify(createPinVerifier('4821', pinKey));

const verifier = parsePinVerifier(JSON.parse(stored));
if (verifier !== null) {
  const ok = await verifyPin('4821', verifier, { pinKey });
}

const id = ulid();
ulidTime(id); // the creation time in milliseconds
```

## Design rules and guarantees

- `@noble/hashes`, `@noble/ciphers` and `@noble/curves` are pinned to `2.4.0` exactly, so the manifest answers "which cryptography, at which version". In the monorepo this package comes from, it is the only place allowed to import `@noble`, and a lint rule enforces that.
- On React Native, Metro's platform-extension rule resolves the package's internal `./entropy` import to `entropy.native.ts`, which reads the OS CSPRNG through `expo-crypto`. Everywhere else, `entropy.ts` uses `globalThis.crypto.getRandomValues`. With neither available it throws; there is no fallback, and `Math.random` is never used.
- `@noble/curves` draws random bytes at call time, including to blind the secret scalar during Ed25519 signing. Hermes has no Web Crypto, so on import the native entropy module installs a `globalThis.crypto.getRandomValues` backed by `expo-crypto`. Installing it twice is harmless, and an existing implementation is left alone.
- `generateSigningKey` and `x25519KeyPair` take their randomness from this package's `randomBytes` instead of letting `@noble` pick a default.
- PIN verification compares with `constantTimeEqual` (`@noble`'s `equalBytes`), never `===` or an early-exit loop.
- `DecryptionError` does not say whether the key, the associated data or the data was wrong, so it tells someone guessing passphrases nothing.
- `assertArgon2idParams` rejects Argon2id costs outside fixed limits before any derivation runs, and `openStream` refuses a frame longer than one chunk plus its tag, so a crafted header cannot ask for gigabytes.
- The final-chunk flag and the counter are part of each chunk's nonce. A stream that is cut short, reordered or followed by extra bytes throws instead of decrypting to a shorter or shuffled result.
- Argon2id parameters live in the data (`DeriveOptions.params`, the version 1 PIN record), so raising the defaults later does not stop older files or verifiers from opening.
- `verifySignature`, `tryOpen`, `opensStream` and `parsePinVerifier` answer a negative with `false` or `null` and do not throw. `PinKeyUnavailableError` is the exception, because "cannot check" must not be confused with "wrong PIN" or with "accept".
- The package keeps no keys and does no file, network or console I/O. Where a key is stored is the caller's decision.

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
