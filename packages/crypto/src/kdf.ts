/**
 * ADR-03: Argon2id, for two different jobs that must never share a key.
 *
 * - the **backup passphrase** becomes the container key;
 * - the **PIN** becomes a verifier with its own salt.
 *
 * §5 is explicit that the PIN never derives the database key: that stays 32 random bytes
 * in `expo-secure-store`. Keeping the two derivations in one place makes the separation
 * visible rather than incidental.
 *
 * @module
 */

import { argon2id, argon2idAsync } from '@noble/hashes/argon2.js';

import {
  assertArgon2idParams,
  DEFAULT_ARGON2ID_PARAMS,
  KEY_BYTES,
  type Argon2idParams,
} from './params.ts';

/** Options for `deriveKey` and `deriveKeySync`. Every field is optional. */
export interface DeriveOptions {
  /** Cost. Defaults to the ADR's starting point; restore passes what the manifest says. */
  readonly params?: Argon2idParams;
  /** Length of the derived key, in bytes. Defaults to `KEY_BYTES` (32). */
  readonly keyLength?: number;
  /** 0…1, for the progress indicator ADR-03 §4 requires. */
  readonly onProgress?: (fraction: number) => void;
  /**
   * How long the derivation may hold the JS thread before yielding, in milliseconds.
   * Pure-JS Argon2id on Hermes is the performance risk of this ADR; yielding is what
   * keeps the progress indicator moving instead of freezing at 0%.
   */
  readonly tickMs?: number;
}

function inputs(secret: string | Uint8Array, salt: Uint8Array, options: DeriveOptions) {
  const params = options.params ?? DEFAULT_ARGON2ID_PARAMS;
  assertArgon2idParams(params);
  if (salt.length < 8) throw new TypeError('argon2id salt must be at least 8 bytes');
  return {
    secret,
    salt,
    opts: {
      m: params.m,
      t: params.t,
      p: params.p,
      dkLen: options.keyLength ?? KEY_BYTES,
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
      asyncTick: options.tickMs ?? 10,
    },
  };
}

/**
 * The derivation the app uses. Async so the JS thread is released periodically: a
 * one-shot cost of a second or three must not look like a hang (ADR-03 §Consequences).
 */
export async function deriveKey(
  secret: string | Uint8Array,
  salt: Uint8Array,
  options: DeriveOptions = {},
): Promise<Uint8Array> {
  const { secret: password, salt: s, opts } = inputs(secret, salt, options);
  return argon2idAsync(password, s, opts);
}

/**
 * The same derivation, synchronously. Test vectors and the Vitest round-trips use it;
 * nothing on a screen should, because it blocks.
 */
export function deriveKeySync(
  secret: string | Uint8Array,
  salt: Uint8Array,
  options: DeriveOptions = {},
): Uint8Array {
  const { secret: password, salt: s, opts } = inputs(secret, salt, options);
  return argon2id(password, s, opts);
}
