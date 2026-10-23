/**
 * ADR-03: entropy comes from the OS CSPRNG through `expo-crypto`, never from a `@noble`
 * package's own fallback and never from `Math.random`. The named helpers exist so a call
 * site cannot quietly ask for the wrong number of bytes.
 *
 * @module
 */

import { randomBytes } from './entropy.ts';
import { KEY_BYTES, NONCE_BYTES, SALT_BYTES } from './params.ts';

/** A fresh symmetric key. */
export function randomKey(): Uint8Array {
  return randomBytes(KEY_BYTES);
}

/** A fresh KDF salt. Unique per verifier and per backup container. */
export function randomSalt(): Uint8Array {
  return randomBytes(SALT_BYTES);
}

/**
 * A fresh XChaCha20 nonce. 24 bytes is what makes random nonces safe here: at that width
 * the birthday bound is far beyond any number of backups a phone will ever produce, which
 * is the reason ADR-03 chose XChaCha20-Poly1305 over ChaCha20-Poly1305.
 */
export function randomNonce(): Uint8Array {
  return randomBytes(NONCE_BYTES);
}

export { randomBytes };
export { installGlobalRandom } from './entropy.ts';
