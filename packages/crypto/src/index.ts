/**
 * The cryptography TApp and the clinic app share: Argon2id key derivation, XChaCha20-Poly1305
 * sealing (one-shot and as a chunked stream), SHA-256 and HMAC-SHA256, the PIN verifier,
 * Ed25519 signing, X25519 with HKDF-SHA-256, constant-time comparison and CSPRNG helpers.
 *
 * ADR-03 rule 1: **one module owns cryptography.** No feature imports a `@noble` path
 * directly — the same seam discipline as `repo/`, and ESLint enforces it.
 *
 * Everything here is pure TypeScript, which is the strongest argument for the ADR's
 * choice: the backup format — the thing standing between a patient and a lost phone — is
 * generated, encrypted, decrypted and merged in CI on every PR, in Node, with no device.
 * A native crypto module would have made that round trip a manual test forever.
 *
 * @module
 */
export {
  CIPHER_ALGORITHM,
  DEFAULT_ARGON2ID_PARAMS,
  PIN_ARGON2ID_PARAMS,
  HASH_ALGORITHM,
  InvalidParametersError,
  KDF_ALGORITHM,
  KEY_BYTES,
  NONCE_BYTES,
  SALT_BYTES,
  TAG_BYTES,
  assertArgon2idParams,
} from './params.ts';
export type { Argon2idParams } from './params.ts';

export { deriveKey, deriveKeySync } from './kdf.ts';
export type { DeriveOptions } from './kdf.ts';

export { DecryptionError, open, seal, tryOpen } from './cipher.ts';

export {
  chunkNonce,
  opensStream,
  openStream,
  sealStream,
  StreamFormatError,
  STREAM_CHUNK_BYTES,
  STREAM_NONCE_BASE_BYTES,
} from './stream.ts';

export {
  bytesToHex,
  createSha256Stream,
  hexToBytes,
  hmacSha256,
  sha256Bytes,
  sha256Hex,
} from './hash.ts';
export type { Sha256Stream } from './hash.ts';

export {
  PIN_KEY_BYTES,
  PinKeyUnavailableError,
  createArgon2idPinVerifier,
  createPinVerifier,
  isDeviceBoundVerifier,
  parsePinVerifier,
  pinVerifierSchema,
  verifyPin,
} from './pin.ts';
export type {
  Argon2idPinVerifier,
  HmacPinVerifier,
  PinOptions,
  PinVerifier,
  VerifyOptions,
} from './pin.ts';

export { generateSigningKey, sign, signingPublicKey, verifySignature } from './signing.ts';

export { hkdfSha256, x25519KeyPair, x25519PublicKey, x25519SharedSecret } from './curves.ts';
export type { X25519KeyPair } from './curves.ts';

export { constantTimeEqual } from './compare.ts';

export { installGlobalRandom, randomBytes, randomKey, randomNonce, randomSalt } from './random.ts';
