# @cosys/peer

`@cosys/peer` is the networking half of the cosys record substrate. It covers how one device proves who it is, how two people pair their devices and confirm the pairing by reading a short code to each other, and how two devices exchange sealed, append-only rows, either live over a stream or through a mailbox that holds ciphertext while one side is offline. It also covers grants that say what a peer may see, revocations that take a share back, and erasure requests that ask a holder to destroy what it holds and answer with a signed receipt. It has no transport and no vocabulary of its own: the transport, every network address and the kinds of rows that exist are supplied by the application. It was built for a patient-held health record app and a desktop app for clinics that read what patients share, and it is written so that any application with an append-only, per-device log can use it.

## Status

Version 0.1.0. This is an early release and the API may change before 1.0.

The package ships TypeScript sources, not compiled JavaScript. You need a TypeScript-aware bundler or runtime to consume it: Metro, Vite, esbuild, tsx, Bun, Deno and similar tools all work. Plain `node` without a TypeScript loader will not run it. Test files are not published; the JSON test-vector files in `src/` are.

## Install

```sh
npm install @cosys/peer
```

It is also on JSR as [`@cosys/peer`](https://jsr.io/@cosys/peer): `deno add jsr:@cosys/peer`, or `npx jsr add @cosys/peer` in a Node project.

Dependencies:

- [`@cosys/crypto`](https://www.npmjs.com/package/@cosys/crypto): every cryptographic primitive (Ed25519, X25519, HKDF, HMAC, SHA-256, the chunked AEAD stream), plus bytes, base64 and ULID helpers.
- [`@cosys/record`](https://www.npmjs.com/package/@cosys/record): the row shape, the kind and view registries, and the schemas for grants, revocations, erasure, assertions and bridged rows.
- `zod` 4, which several modules import directly for parsing untrusted input. It also arrives through `@cosys/record`.

On React Native (Hermes), which has no Web Crypto, call `installGlobalRandom()` from `@cosys/crypto` once at start-up so that key generation and signing have an entropy source. `@cosys/crypto` uses `expo-crypto` there as an optional peer dependency.

## Import paths

Import everything from the package root. The `exports` map has one entry, `.`, pointing at `src/index.ts`, which re-exports the whole public API:

```ts
import { identityFromSeed, runSession, createCouchMailbox } from '@cosys/peer';
```

Rows only parse once their kind is registered. The substrate's own kinds (`tombstone`, `grant`, `revoke`, `erasure_request`, `erasure_receipt`, `assert`) are registered by `@cosys/record`. An application registers its own kinds and views with `registerKinds` from `@cosys/record/kinds` and `registerViews` from `@cosys/record/views` before it syncs.

## What's inside

### Identity and the handshake

- `identityFromSeed(deviceId, seed)` builds a `DeviceIdentity` (an Ed25519 key pair from a 32-byte seed, plus a per-install device id). The identity signs; it never encrypts.
- `deriveTransportSeed(identity, label)` derives a separate transport key from the identity, so a transport key never becomes a second root secret. `certifyTransportKey` and `verifyTransportCertificate` sign and check a statement that a transport key belongs to an identity.
- `signHello`, `verifyHello` and `deriveSessionKeys` are the session handshake: each side signs a fresh ephemeral X25519 key, and HKDF over the exchange and the handshake transcript gives one key per direction (`SessionKeys`, `HandshakeHalf`).

### Pairing and the confirmation code

- Two people pair in three messages: an invite carrying the inviter's key and a commitment to a random nonce, a reply carrying the joiner's key and nonce, and a reveal of the inviter's nonce. `createPairingNonce`, `pairingCommitment`, `opensCommitment` and `pairingConfirmation` implement this, and `encodePairingMessage` / `decodePairingMessage` turn each `PairingMessage` into one line of text that survives being pasted into a chat app, with a checksum so a truncated paste fails.
- `pairingConfirmation` derives a `ConfirmationCode` from both keys and both nonces: four picture ids from a list of 64 (`CONFIRMATION_EMOJI`, `CONFIRMATION_EMOJI_COUNT`) and six digits (`CONFIRMATION_DIGITS`). The display name is never an input.
- `confirmationCode(a, b)` derives a code from two keys alone, for routes where one key arrives inside an operator-signed listing rather than through a chat.
- `encodePairingInvite` / `decodePairingInvite` read and write the simpler key-and-name form. `PAIRING_URI_PREFIX`, `PAIRING_NONCE_BYTES` and `MAX_PAIRING_NAME_BYTES` are the format's constants.

### Glyphs

- `CONFIRMATION_GLYPH` maps each of the 64 picture ids to a system emoji, and `glyphFor(id)` returns one. The protocol carries ids, so the drawing can change without changing the code a pair of keys produces. The six digits carry the security; the pictures help two people compare a code aloud.

### The transport seam

- `PeerTransport` and `PeerStream` are the interface a transport implements: dial a peer by public key and get an ordered, half-closable duplex of bytes. `ConnectionPath` reports `direct`, `relay`, `local` or `unknown`. `PeerStreamError` marks a stream that ended mid-read.
- `createIrohTransport(options)` implements the seam over an iroh binding that you inject (`IrohBinding`, `IrohEndpoint`, `IrohConnection`, `IrohBiStream`). The package imports no native module. You also supply `relayUrl`, `resolve(identityKey)` and `identify(endpointId)`; `identify` returning null refuses a stranger before any handshake. `irohEndpointId(identity)` computes the endpoint id without binding, and `IROH_TRANSPORT_LABEL` is the derivation label.
- `createLoopbackNetwork(faults)` is an in-process transport with fault injection (`cutAfterBytes`, offline keys) for tests (`LoopbackNetwork`, `LoopbackFaults`).

### The wire and the session

- `messages` defines five message types (`MESSAGE_TYPE`: cursors, batch, attachment, chunk, done) and the `Message`, `Cursor`, `AttachmentBody` and `SyncEntry` types. `syncEntrySchema` parses one row; `VIEW_NAME_MAX_LENGTH` bounds the view name a batch declares. `ProtocolError` is thrown for malformed or unauthenticated input.
- `wire` frames a session: `SESSION_MAGIC`, `encodeHandshake`, `readHandshake`, then `sealMessages` / `openMessages`, which seal each message as its own chunk of the `@cosys/crypto` stream format. `MAX_BATCH_BYTES` and `wireRowBytes` bound a batch.
- `runSession(stream, options)` runs one sync over a dialled stream: handshake, exchange cursors, send each device log's rows since the peer's cursor through `options.view`, apply what arrives, and honour any revocations that arrive. It returns a `SyncResult` with counts, cursors, timings and `status: 'complete' | 'interrupted'`. A dropped connection is `interrupted`, not an exception; a failed handshake throws.
- `PeerStore` is the seam onto your database: cursors, rows since a ULID, insert-if-new, attachments, and the one destructive call (`removeRows`) used by revocation and erasure. `createMemoryStore` is an in-memory implementation for tests. `RowApplyResult` reports inserted and skipped rows.

### Mailbox and deposits

- `mailboxKey(identity)` derives a static X25519 mailbox key, certified by the identity, and `addressOf(identity)` returns the `MailboxAddress` a sender needs. `sealForMailbox` seals messages for an offline recipient into the same container a live session uses; `openFromMailbox` opens it and returns the sender's identity key (`MailboxDelivery`). Mailbox blobs do not have forward secrecy; live sessions do.
- `Mailbox` is the queue interface (`deposit`, `collect`, `purgeCollected`, `waitForMail`), with `MailboxItem` and `MailboxReceipt`. Frames are purged only after the caller has applied them. `createMemoryMailbox` is a test implementation.
- `depositAllowlist(rows, paired, options)` computes which peers may deposit into an account's mailboxes from that account's own log, keeping a peer whose share ended only while an erasure receipt from it is still owed (`DEPOSIT_ANSWER_WINDOW_DAYS`).

### CouchDB mailbox (`couch/`)

- `CouchClient` reaches CouchDB with `fetch` only (`_bulk_docs`, `_changes`, `_purge`, attachments, a local checkpoint). It takes a `TokenSource` callback and an optional injected `fetch` (`CouchClientOptions`) and throws `CouchError` with the HTTP status. Every response is parsed as untrusted.
- `createCouchMailbox(options)` implements `Mailbox` over one CouchDB database per relationship (`CouchMailboxOptions`, `MailboxScope` of `peer` or `group`). `mailboxDatabaseName(recipientKey, scope)` names that database; `MAX_DEPOSIT_BYTES` bounds one deposit.
- `createProvisioningClient({ server })` is the client of a provisioning service: it signs a server nonce with the device key and receives a short-lived token scoped to one database and one role (`MailboxTarget`, `MailboxRole` of `deposit` or `collect`). Its methods are `token`, `tokenSource`, `purge`, `registerPushToken` and `poke`, plus the telemetry-mailbox calls below. `poke` asks the service to wake a recipient's phone and sends only signed identifiers, no content. `ProvisioningError` carries the status and body; `SigningKey`, `ErasureAnswer` and `ProvisioningClient` are its types.
- `createPilotClient`, `sealPilotFrame` and `openPilotFrame` handle a deposit-only mailbox for opt-in telemetry, named per telemetry key (`PILOT_MAILBOX_PREFIX`, `pilotMailboxName`), with consent, revoke, one idempotent deposit per document id, and erasure by capability (`PilotClient`, `PilotClientOptions`, `PilotDepositResult`).

### Directory

- `signDirectoryRecord` and `verifyDirectoryRecord` sign and check a `DirectoryRecord`: where an identity's mailbox is, its certified mailbox key, its endpoint id, who may deposit, any groups, and an optional bridge intake (`DirectoryIntake`). A record must be signed by the identity it describes and its mailbox name must match that key.
- `createDirectoryClient({ server })` returns `lookup(identityKey)`, which refuses any record it cannot verify or that is older than `maxAgeMs` (default seven days), and `publish(identity, record)` (`DirectoryClientOptions`). The directory is trusted for availability, never for keys.

### Grants, levels and revocation

- `createGrant(identity, payload)` writes a share as a row on the granting device's own log (`GrantPayload`: peer, view, optional kinds, period, `alsoViews` and `emergency`, and whether attachments travel). `grantPayloadSchema` is the shape, re-exported from `@cosys/record`.
- `resolveGrantState(rows, peerKey, authors)` folds the log into a `GrantState` of `active`, `revoked` or `none`; `resolveGrant` returns the active payload or null. `viewForState(state, context)` and `grantView(grant, context)` return the `RowView` to sync that peer under. A revoked grant's view sends exactly one row, the revocation, so the peer is told the share ended.
- Views are registered by the application with `@cosys/record/views`. This package exports the substrate's `FULL_VIEW`, `projectsItself`, `scopeKindsOf` and the `RowView` (alias `PeerView`) and `ViewContext` types. A view is applied before sealing, per peer.
- `createRevocation(identity, payload)` writes a revocation with a mode from `REVOCATION_MODES`: `stop_sending` or `stop_and_remove`. `applyRevocation(store, row)` and `honourRevocations(store, rows)` carry it out on the receiving side and return a `RevocationReport`, which always names what software cannot reach (exports, copies, anything written down). `revocationPayloadSchema`, `RevocationPayload`, `RevocationScope` and `RevocationMode` are the shapes.

### Erasure

- `createErasureRequest(identity, { peer, scope })` writes a signed request addressed to one holder. `readErasureRequest` verifies one and `erasureRequestDigest` hashes it.
- `honourErasure(store, request, identity, details)` removes the rows in scope, never the holder's own rows, and returns a signed `erasure_receipt` row that states what was removed, what remains, the outcome (`complete` or `partial`) and, for an archive, its backup window (`HolderDetails`, `ErasureHolder`). A receipt is a signed statement by the holder, not proof that bytes were destroyed.
- `readErasureReceipt`, `receiptRequestId`, `pendingErasures` and `resolveErasures` check receipts against their requests and track each request as `waiting`, `answered` or `overdue` after `ERASURE_ANSWER_DAYS` (`ErasureState`, `ErasureStatus`, `ErasureRequestPayload`, `ErasureReceiptPayload`).
- `erasureRoute(peer, inner, requests)` wraps a view so the request reaches its holder and rows it was asked to erase are never sent to it again. `receiptRoute(requester, holderDeviceId)` sends a holder's receipts back to the requester and nothing else.
- `holder` checks a server-side holder's signed erasure receipt against keys the build pins: `verifyHolderReceipt`, `signedHolderReceiptSchema`, `erasureCapability`, `capabilityCommitment` and `requestDigest` (`HolderPins`, `HolderReceipt`, `SignedHolderReceipt`, `ReceiptCheck`).

### Clinic

- `clinicGrant(clinicKey, share)` builds the grant for a clinic share, always the `full` view, with the patient choosing kinds, period and attachments (`ClinicShare`). `CLINIC_CONSENT_VERSION` names the consent text version both sides record.
- `clinicEntryBytes` and `clinicEntryProblem(signed, trustedSigners, now)` check an operator-signed `ClinicDirectoryEntry` (`SignedClinicEntry`) offline, against a list of trusted signer keys and the clock, and return a `ClinicEntryProblem` or null. `CLINIC_ENTRY_MAX_DAYS` caps an entry's validity.
- `encodeClinicInvite` / `decodeClinicInvite` carry a signed entry as one line of text (`ClinicInvite`, `CLINIC_INVITE_PREFIX`).

### Bridge directory and bridged rows

A bridge is a server-side actor that converts a foreign export into signed rows for one patient (see `@cosys/bridge`).

- `bridgeEntryBytes`, `bridgeEntryProblem` and `pairedBridges` check operator-signed `BridgeDirectoryEntry` records (`SignedBridgeEntry`, `BridgeEntryProblem`, `BRIDGE_ENTRY_MAX_DAYS`) and produce the map of paired bridge keys to the kinds each may write.
- `encodeBridgeInvite` / `decodeBridgeInvite` carry an entry, a subject and a one-time code (`BridgeInvite`, `BRIDGE_INVITE_PREFIX`). `PAIRING_CODE` is the code's pattern, `pairingCodeDigest` binds a code to one bridge key, and `bridgePairingAssertion` builds the patient's `paired_with` claim. `bridgeOfAssertion` reads an entry as an assertion.
- `signBridgeRow(header, patient, input, signer)` signs a bridged row with both the bridge key and a per-instance key derived by `bridgeInstanceSeed` (`BridgeSigner`, `BridgeRowHeader`). `verifyBridgeRow(row, paired, patient)` checks it on the receiving device and returns the payload or a `BridgeRowRefusal`. `readBridgeReceipt` checks a bridge's answer to an erasure request.

### Assertions

- `signAssertion(header, assertion, seed)` signs a claim as an `assert` row. `verifyAssertion(row, context)` checks the signature and validity window, and limits what a paired clinic's key may claim (`AssertionContext`, `AssertionRefusal`). `licensedClinicAssertion` reads a signed clinic entry as an assertion.

### Relay access

- `relayAccessToken`, `parseRelayAccessKey` and `withRelayAccess` derive and attach an HMAC token from a release key and an endpoint id (`RelayAccessKey`, `RELAY_ACCESS_VERSION`, `RELAY_TOKEN_PARAM`).
- `createRelayTokenSource` chooses which token an endpoint presents, per a mode (`RelayAccessMode`, `RELAY_ACCESS_MODES`, `DEFAULT_RELAY_ACCESS_MODE`, `parseRelayAccessMode`): the derived token, a relay pass obtained with a platform integrity check (`IntegrityProvider`), or both. `createRelayAccessClient` talks to the relay's access routes, `createRelayPassCache` and `parseRelayPass` handle held passes, and the `RELAY_PASS_*` constants set renewal, back-off and step timeouts. Errors are `RelayAccessError`, `RelayPassTimeoutError` and `RelayPassUnavailableError`.

## Usage

### Pair two people

```ts
import {
  createPairingNonce,
  decodePairingMessage,
  encodePairingMessage,
  glyphFor,
  identityFromSeed,
  pairingCommitment,
  pairingConfirmation,
} from '@cosys/peer';
import { bytesToHex } from '@cosys/crypto';

// The seed comes from your secure storage; it is never logged or sent.
const me = identityFromSeed('device-a', seed);
const myNonce = createPairingNonce();

// 1. Send the invite.
const invite = encodePairingMessage({
  kind: 'invite',
  peer: bytesToHex(me.publicKey),
  name: 'Asha',
  commitment: pairingCommitment(me.publicKey, myNonce),
});

// 2. When the reply arrives, send the reveal and show the code.
const reply = decodePairingMessage(replyText);
if (reply?.kind === 'reply') {
  const reveal = encodePairingMessage({ kind: 'reveal', nonce: myNonce });
  const code = pairingConfirmation({
    inviter: me.publicKey,
    joiner: reply.peer,
    inviterNonce: myNonce,
    joinerNonce: reply.nonce,
  });
  show(code.emoji.map(glyphFor), code.digits);
}
```

The joiner checks the reveal with `opensCommitment(invite.peer, invite.commitment, reveal.nonce)` before computing the same code.

### Sync two devices over the loopback

```ts
import { ulid } from '@cosys/crypto/ulid';
import { registerKinds } from '@cosys/record/kinds';
import {
  createLoopbackNetwork,
  createMemoryStore,
  FULL_VIEW,
  identityFromSeed,
  runSession,
  type PeerStream,
  type SyncEntry,
} from '@cosys/peer';

registerKinds('notes', { note: { travels: true } });

const a = identityFromSeed('device-a', seedA);
const b = identityFromSeed('device-b', seedB);
const at = new Date().toISOString();
const row: SyncEntry = {
  id: ulid(),
  kind: 'note',
  occurredAt: at,
  recordedAt: at,
  deviceId: a.deviceId,
  source: 'manual',
  supersedesId: null,
  targetId: null,
  payload: JSON.stringify({ text: 'hello' }),
  glucoseMgdl: null,
  aiModelId: null,
  aiSuggestion: null,
};

const network = createLoopbackNetwork();
const left = network.join(a.publicKey);
const right = network.join(b.publicKey);
const incoming = right.accept()[Symbol.asyncIterator]();
const dialled = await left.connect(b.publicKey);
const answered = (await incoming.next()).value as PeerStream;

const [fromA, atB] = await Promise.all([
  runSession(dialled, {
    identity: a,
    store: createMemoryStore([row]),
    view: FULL_VIEW,
    authors: true,
    isInitiator: true,
  }),
  runSession(answered, {
    identity: b,
    store: createMemoryStore(),
    view: FULL_VIEW,
    authors: true,
    isInitiator: false,
  }),
]);
// fromA.status === 'complete', atB.received.inserted === 1
```

In an app, replace the loopback with `createIrohTransport` and the memory store with a `PeerStore` over your database.

### Share, then stop sharing

```ts
import { createGrant, createRevocation, resolveGrantState, viewForState } from '@cosys/peer';
import { bytesToHex } from '@cosys/crypto';

// `store` is your PeerStore; `allRows` is the granting account's own log.
const peer = bytesToHex(b.publicKey);
await store.applyRows([createGrant(a, { peer, view: 'full', attachments: false })]);

const state = resolveGrantState(allRows, peer, true); // { status: 'active', grant }
const view = viewForState(state); // pass as `view` to runSession; null means send nothing

await store.applyRows([
  createRevocation(a, { mode: 'stop_and_remove', peer, scope: { deviceIds: [a.deviceId] } }),
]);
```

### Leave mail for a peer who is offline

```ts
import { hexToBytes } from '@cosys/crypto';
import { concatBytes } from '@cosys/crypto/bytes';
import { fromBase64 } from '@cosys/crypto/base64';
import { ulid } from '@cosys/crypto/ulid';
import {
  createCouchMailbox,
  createDirectoryClient,
  createProvisioningClient,
  sealForMailbox,
  type MailboxScope,
} from '@cosys/peer';

// Every address is your configuration; the package has none built in.
const directory = createDirectoryClient({ server: config.directory });
const provisioning = createProvisioningClient({ server: config.service });

const record = await directory.lookup(peerKey);
const to = {
  identityKey: hexToBytes(record.identity),
  mailboxKey: fromBase64(record.mailboxKey),
  certificate: fromBase64(record.mailboxCertificate),
};
const scope: MailboxScope = { kind: 'peer', peerKey: me.publicKey };
const mailbox = createCouchMailbox({
  server: config.mailbox,
  recipientKey: peerKey,
  scope,
  fromKey: me.publicKey,
  token: provisioning.tokenSource(me, { role: 'deposit', recipient: peerKey, scope }),
});

// `messages` is an AsyncIterable<Message>, for example one batch followed by `done`.
const parts: Uint8Array[] = [];
for await (const part of sealForMailbox(me, to, messages, ulid())) parts.push(part);
await mailbox.deposit(concatBytes(parts));
await provisioning.poke(me, peerKey); // optional wake-up; carries no content
```

## Design rules and guarantees

- The package names no network host. Every address (`server`, `database`, `service`, `mailbox`, `relayUrl`) is a parameter with no default, and every HTTP client accepts an injected `fetch`. The source repository checks this mechanically.
- The application supplies the transport. A session runs over any `PeerTransport`; iroh arrives as an injected binding, the mailbox is CouchDB over `fetch`, and the push wake-up is a request to your own service. The package imports no native module, push SDK or CouchDB library.
- Every import from `@cosys/crypto` and `@cosys/record` goes through `src/deps.ts`, and no other module imports a sibling package. The package imports no application code.
- The package defines no kinds of its own beyond the substrate's. Which kinds exist, which may travel under a grant and which views a grant may name come from the `@cosys/record` registries, which the application fills.
- Rows are inserted if new and never updated, so a repeated delivery does nothing and resuming needs no stored cursor: the cursor is the highest ULID held for each device log. `removeRows` is the only destructive store call, and only revocation and erasure use it.
- Each received row is validated on its own. A row that fails is counted as rejected, and the rest of the batch still applies.
- A view is applied per peer, before sealing. A device forwards only the logs it authors (`authors` is a required option with no default), so a record received from someone else is never shared on.
- The directory is never trusted for keys. A record is signed by the identity it describes and verified before use, and the pairing code catches a substituted key.
- Every revocation report and erasure receipt names what software cannot reach. A receipt is presented as the holder's signed statement, not as proof of deletion.
- `SyncResult.reason` and the relay events carry tags and messages, never keys or tokens.

## The cosys packages

| Package                                                        | What it is                                                                                                                                                                              | Depends on                                      |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| [`@cosys/crypto`](https://www.npmjs.com/package/@cosys/crypto) | Primitives over @noble: hashing, signing, ciphers, key agreement, PIN, base64, ULID.                                                                                                    | no workspace packages                           |
| [`@cosys/record`](https://www.npmjs.com/package/@cosys/record) | The record substrate: time, timestamps and references, tombstones, signed rows, the kinds, roles and claims registries, and views.                                                      | zod                                             |
| [`@cosys/log`](https://www.npmjs.com/package/@cosys/log)       | A typed logger: a closed code catalogue each app declares, primitive fields only, a buffered queue and an injected sink.                                                                | `@cosys/crypto`, `@cosys/record`                |
| [`@cosys/qr`](https://www.npmjs.com/package/@cosys/qr)         | A QR encoder with no dependencies: byte mode, level M, versions 1 to 20. Returns the module matrix.                                                                                     | No workspace packages.                          |
| [`@cosys/peer`](https://www.npmjs.com/package/@cosys/peer)     | The networking half: identity, pairing, the wire, the mailbox, grants, revocation and erasure.                                                                                          | `@cosys/crypto`, `@cosys/record`                |
| [`@cosys/posts`](https://www.npmjs.com/package/@cosys/posts)   | The social modality: posts, reactions and reshares to a circle, with audience routing and landing rules.                                                                                | `@cosys/crypto`, `@cosys/record`                |
| [`@cosys/bridge`](https://www.npmjs.com/package/@cosys/bridge) | The actor at the network's edge that turns a foreign protocol, such as a FHIR or CSV export, into signed rows deposited into one patient's mailbox. Runs on a server, never on a phone. | `@cosys/crypto`, `@cosys/peer`, `@cosys/record` |
| [`piroh`](https://crates.io/crates/piroh) (Rust)               | The iroh endpoint `@cosys/peer` drives as its direct transport.                                                                                                                         | `iroh`                                          |
| [`prelay`](https://crates.io/crates/prelay) (Rust)             | The relay server: `iroh-relay` with an access check, so only the application's own builds can use it.                                                                                   | `iroh-relay`                                    |

## Licence

Apache-2.0. See [LICENSE](./LICENSE).

## More

For further information, support and collaboration, see [cosys.work](https://cosys.work).
