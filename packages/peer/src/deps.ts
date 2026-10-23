/**
 * The one file that reaches back into the app.
 *
 * ADR-14 §2 puts `@cosys/peer` in the monorepo "with no React import", and ADR-03 rule 1 puts
 * every cipher call behind `src/lib/crypto`. Both hold only if this package borrows the
 * app's crypto rather than carrying a second copy of it — a spike that re-implements chunk
 * sealing would be testing its own arithmetic, not the container the ADR says to extend.
 *
 * So the borrowing is confined to this module. When `src/lib/crypto` and `src/lib/bytes`
 * become a shared package of their own (the same move that makes the clinic app possible),
 * this file's import paths change and nothing else does.
 */

import {
  sign,
  signingPublicKey,
  verifySignature,
  x25519KeyPair,
  x25519PublicKey,
  x25519SharedSecret,
} from '@cosys/crypto';

export {
  bytesToHex,
  chunkNonce,
  DecryptionError,
  hexToBytes,
  installGlobalRandom,
  openStream,
  seal,
  randomBytes,
  sealStream,
  STREAM_CHUNK_BYTES,
  STREAM_NONCE_BASE_BYTES,
} from '@cosys/crypto';
export {
  concatBytes,
  createByteReader,
  fromUtf8,
  readUint32,
  TruncatedStreamError,
  utf8,
  writeUint32,
  type ByteReader,
} from '@cosys/crypto/bytes';
export { fromBase64, toBase64 } from '@cosys/crypto/base64';
export { ulid } from '@cosys/crypto/ulid';

/**
 * The curve primitives, borrowed from `src/lib/crypto` like everything above.
 *
 * Until 2026-09-24 these three lines imported `@noble` directly, under a one-file ESLint
 * exemption that ADR-15 §8 said would end when the package shipped. It ships in 1.0, so the
 * primitives moved into `src/lib/crypto` (`signing.ts`, `curves.ts`, with RFC known-answer
 * tests there) and the exemption was deleted. ADR-03 rule 1 now holds with no exception.
 *
 * The objects keep `@noble`'s method names so that the call sites in this package did not
 * change. They are narrowed to the methods the protocol uses, and a key pair is only ever
 * made from a seed (`entropy.test.ts`). `ed25519.verify` returns `false` on malformed input
 * rather than throwing. Every call site already caught the throw and returned `false`.
 */
export const ed25519 = {
  getPublicKey: signingPublicKey,
  sign,
  verify: verifySignature,
} as const;

export const x25519 = {
  getPublicKey: x25519PublicKey,
  getSharedSecret: x25519SharedSecret,
  keygen: x25519KeyPair,
} as const;

export { hkdfSha256, hmacSha256, sha256Bytes as sha256 } from '@cosys/crypto';

/**
 * The data model, which the sync layer must not fork.
 *
 * ADR-14 §2: "The entry log is the unit of sync … No CRDT document store beside `entries`."
 *
 * *2026-10-21, the handoff's WP2:* **which kinds exist, and which travel, are the registry's**
 * (`@cosys/record/kinds`), filled by each modality at import time.
 *
 * *2026-10-22:* **and this package imports no modality at all.** What it still took from the
 * health package after WP2 was that package's code living here: the projections and the grant's
 * views (now `@tapp/record`'s `views.ts`, registered with `@cosys/record/views`), the clinic's
 * row signing (now `@tapp/record`'s `clinic-rows.ts`), and the shapes of the substrate's own acts
 * about sharing, which named the health enums (now `@cosys/record/schema/sharing`, asking the
 * registries). The row as it travels moved too (`@cosys/record/row`), because a modality's
 * projection writes one. `npm run peer:fence` refuses any `@tapp/*` import in this package,
 * this file included.
 */
export {
  isAuthoredByAnother,
  isControlKind,
  isKind,
  travelsUnderGrant,
} from '@cosys/record/kinds';
/** Nothing in this package registers a kind or a view; its tests do, as a modality would. */
export { registerKinds } from '@cosys/record/kinds';
export { registerViews } from '@cosys/record/views';
export {
  LOCAL_ONLY_FIELDS,
  syncEntrySchema,
  toWireRow,
  type LocalCorrectionFacts,
  type SyncEntry,
} from '@cosys/record/row';
export {
  FULL_VIEW,
  isView,
  projectsItself,
  registeredViews,
  scopeKindsOf,
  viewSpec,
  type RowView,
  type ViewContext,
  type ViewSpec,
} from '@cosys/record/views';

/**
 * The substrate's assertion (ADR-23 §5; PLAN M20-4): its shape and the bytes its signer signs.
 * `@cosys/record`'s, because no modality owns a signed claim; this package keeps the acts of
 * signing and checking one, as it does for a clinic's rows.
 */
export { assertPayloadSchema, assertionSchema, assertRowMessage } from '@cosys/record/schema/assert';
// The shapes of a bridge's rows (ADR-22 §3; PLAN M19-2). The shapes only: importing them registers
// no kind, so a process that loads the peer package does not start holding bridged rows.
export {
  BRIDGE_KINDS,
  bridgeBodySchemas,
  bridgePayloadSchemas,
  bridgeRowMessage,
  isBridgeKind,
  originOfRow,
  registerImportShapes,
} from '@cosys/record/bridge';
export { isProtocol, PROTOCOLS, type Protocol } from '@cosys/record/protocols';
export type {
  BridgeActor,
  BridgeBody,
  BridgeBodyInput,
  BridgeKind,
  BridgePayload,
} from '@cosys/record/bridge';
export type { Assertion, AssertionInput, AssertPayload } from '@cosys/record/schema/assert';

/**
 * The shapes of the acts about sharing (ADR-16, ADR-17), and the change of 2026-09-21: they are
 * defined once, where the store validates a row before it reaches `entries`, so a row validated
 * one way on the wire and another way in the store is not two shapes somebody keeps in step by
 * hand (ADR-15 §4). The package keeps the *acts* (`createGrant`, `applyRevocation`,
 * `honourErasure`); the shapes are the substrate's record (2026-10-22).
 */
export {
  BEYOND_REACH,
  ERASURE_HOLDERS,
  ERASURE_OUTCOMES,
  erasureReceiptPayloadSchema,
  erasureRequestPayloadSchema,
  grantPayloadSchema,
  REVOCATION_MODES,
  revocationPayloadSchema,
  revocationScopeSchema,
} from '@cosys/record/schema/sharing';
export type {
  ErasureHolder,
  ErasureOutcome,
  ErasureReceiptPayload,
  ErasureRequestPayload,
  GrantPayload,
  KeptRecord,
  RevocationMode,
  RevocationPayload,
  RevocationScope,
} from '@cosys/record/schema/sharing';
