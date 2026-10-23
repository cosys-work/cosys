/**
 * Ed25519, behind the ADR-03 seam.
 *
 * ADR-03 rule 1: only `src/lib/crypto` imports `@noble/*`. The rule is not about tidiness —
 * it is so that the answer to "what cryptography does this app do, and with what version of
 * what" is one directory rather than a grep. `@noble/curves` is pinned exactly for the same
 * reason (ADR-01 stack list).
 *
 * `packages/peer` reaches this same Ed25519 through its one seam, `deps.ts`. It used to import
 * `@noble` there under an ESLint exemption. That ended on 2026-09-24, when the package shipped
 * (ADR-15 §8). X25519 and HKDF for the peer protocol are in `./curves`.
 *
 * **There is no key storage here.** A caller that needs a key to persist stores it itself —
 * `src/telemetry/identity.ts` puts its secret in the Keystore, the database key lives in
 * `src/data/db/key.ts` — because where a key is kept is a decision per key, and a helper
 * that both generated and stored would make that decision once for everybody.
 *
 * @module
 */

import { ed25519 } from '@noble/curves/ed25519.js';

import { randomBytes } from './random.ts';

/**
 * A fresh Ed25519 secret key, 32 bytes of CSPRNG output.
 *
 * **From `expo-crypto`, never from `@noble`'s own default** (ADR-03: entropy comes from the OS
 * CSPRNG through `expo-crypto`). Called without a seed, `randomSecretKey` reaches for
 * `globalThis.crypto.getRandomValues`, which Node has and Hermes does not: every test passed
 * and the first call on a Galaxy M16 threw inside `randomBytes` (2026-09-23).
 */
export function generateSigningKey(): Uint8Array {
  return ed25519.utils.randomSecretKey(randomBytes(32));
}

/** The public key for a secret key, 32 bytes. */
export function signingPublicKey(secretKey: Uint8Array): Uint8Array {
  return ed25519.getPublicKey(secretKey);
}

/** Signs a message. 64 bytes. */
export function sign(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
  return ed25519.sign(message, secretKey);
}

/**
 * Verifies a signature.
 *
 * Returns `false` rather than throwing on a malformed signature or key: a caller checking a
 * signature is asking a yes/no question, and a `try`/`catch` around every call site is how
 * one of them ends up treating a thrown error as a pass.
 */
export function verifySignature(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  try {
    return ed25519.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}
