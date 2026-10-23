# @cosys/log

A typed logger with a closed code catalogue. An app declares every code it may log and the fields each one carries, and a call names a code and those fields and nothing else. Fields are primitives (string, number, boolean or null), so an object, a free-form message or key material cannot be logged by accident. Records go into a buffered queue and out through a sink the app supplies, such as a database table.

There is no logging library underneath, and it behaves the same in every build: only what is printed to the console may differ.

## Install

```sh
npm install @cosys/log
```

It is also on JSR as [`@cosys/log`](https://jsr.io/@cosys/log): `deno add jsr:@cosys/log`, or `npx jsr add @cosys/log` in a Node project. It depends on `@cosys/crypto` for record ids and `@cosys/record` for local time, both installed with it.

There is no root import. Import from the three modules: `@cosys/log/logger`, `@cosys/log/crash` and `@cosys/log/types`.

## Usage

```ts
import { installCrashHandlers } from '@cosys/log/crash';
import { errorFields, Logger } from '@cosys/log/logger';
import type { CoreLogFields, ErrorFields, LogSink } from '@cosys/log/types';

// The catalogue: every code this app may log, with its fields.
interface Codes extends CoreLogFields {
  'sync.started': { readonly peers: number };
  'sync.failed': ErrorFields;
}

const log = new Logger<Codes>({ consoleLevel: 'warn', deviceId: 'device-1' });
installCrashHandlers(log);

log.info('sync.started', { peers: 2 });
// log.info('sync.started', { peers: '2' }); // type error: the field is a number
// log.info('sync.done');                    // type error: not in the catalogue

try {
  await sync();
} catch (error) {
  log.error('sync.failed', errorFields(error)); // the name and stack frames, never the message
}

// Records made so far wait in memory; attaching a sink writes them.
const sink: LogSink = {
  async write(records) {
    await db.insert(records);
  },
};
log.attachSink(sink);
```

## How it behaves

- **A call never blocks.** It appends to a queue and returns. Nothing is awaited.
- **Records wait until there is a sink.** Records made before `attachSink`, for example while a database is still opening, are kept in memory and written when the sink arrives, so a failure during startup is not lost.
- **Writes are batched.** Up to 50 records per `write`. A flush starts two seconds after a record arrives, unless one is already pending.
- **A full buffer drops the oldest.** The queue holds 500 records. Past that the oldest go, and a `log.dropped` record with the count is written where the gap is, so a gap reads as a gap.
- **A failed write is retried, not looped.** The batch goes back to the front of the queue, `log.sink.failed` is printed to the console in every build, and the next flush tries again.
- **Fields are cleaned.** Strings are cut at 200 characters, a field that is `undefined` is left out, and a number that is not finite becomes `null`.
- **The console level only affects printing.** `consoleLevel` decides what is printed; every record reaches the sink whatever it is.

## API

| Module   | Export                         | What it is                                                                                                                                                                                                           |
| -------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `logger` | `Logger<F>`                    | The logger, typed by a catalogue `F` that extends `CoreLogFields`. `debug`, `info`, `warn` and `error` take a code and its fields. `attachSink`, `detachSink`, `flush`, `configure` and `buffered` manage the queue. |
| `logger` | `LoggerOptions`                | `consoleLevel`, `deviceId`, and an injectable clock, timer and console for tests.                                                                                                                                    |
| `logger` | `errorFields(error)`           | `{ errorName, stack }` for any thrown value: the error's name and up to eight stack frames. The message is never kept.                                                                                               |
| `crash`  | `installCrashHandlers(logger)` | Logs uncaught errors (React Native's global handler) and unhandled promise rejections through the logger, then calls the previous handler. Returns a function that removes both hooks.                               |
| `types`  | `LogRecord`                    | One stored record: a ULID `id`, `at` (ISO 8601 with offset), `level`, `code`, `fields` as JSON, and `deviceId`.                                                                                                      |
| `types`  | `LogSink`                      | `{ write(records): Promise<void> }`, where the records go.                                                                                                                                                           |
| `types`  | `CoreLogFields`                | The codes the logger writes itself, which every catalogue includes: `log.dropped`, `log.sink.failed`, `crash.fatal`, `crash.nonfatal` and `crash.unhandledRejection`.                                                |
| `types`  | `LOG_LEVELS`, `LEVEL_ORDER`    | `debug`, `info`, `warn`, `error`, and their order.                                                                                                                                                                   |

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
