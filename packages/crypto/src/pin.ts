/**
 * ADR-03 §5: the PIN verifier.
 *
 * **The PIN never derives the database key.** That key is 32 random bytes in
 * `expo-secure-store` (ADR-02) and nothing the patient types touches it. The PIN is
 * checked against an Argon2id verifier with its own salt, which is what lets biometric
 * unlock, a PIN change and a PIN reset all happen without re-encrypting a single row.
 *
 * The record is self-describing for the same reason the backup container is (§3): the
 * parameters are read back out of what was stored, so changing the cost later re-verifies
 * existing PINs at their original cost instead of locking everyone out. That stopped being
 * hypothetical on 2026-09-16, when the measured cost on the reference emulator came back at
 * 38 s and `PIN_ARGON2ID_PARAMS` was stepped down — every PIN created before that change
 * still verifies, at the cost it was created with.
 *
 * @module
 */

import { z } from 'zod';

import { fromBase64, toBase64 } from './base64.ts';
import { constantTimeEqual } from './compare.ts';
import { hmacSha256 } from './hash.ts';
import { deriveKey } from './kdf.ts';
import { PIN_ARGON2ID_PARAMS, assertArgon2idParams, type Argon2idParams } from './params.ts';
import { randomSalt } from './random.ts';

/**
 * ## Version 2: HMAC-SHA256 under a key the Keystore holds (founder, 2026-09-24, ADR-03 §5)
 *
 * Every new verifier is `HMAC-SHA256(pinKey, salt ‖ pin)`, where `pinKey` is 32 random bytes
 * in `expo-secure-store` beside the database key and is never logged or backed up. It costs
 * about a millisecond where Argon2id cost 3 s on every unlock. ADR-03 §5 already said the KDF
 * was not the boundary for a four-digit PIN: whoever holds the verifier enumerates ten
 * thousand candidates whatever the cost. The Keystore is the boundary, and a keyed MAC puts
 * the Keystore in front of the guess itself: a copied database is not enough to try a PIN.
 *
 * **Version 1 records keep verifying exactly as they did.** They are rewritten to version 2
 * only when the PIN is next set, because verifying is the one moment the PIN is in hand and
 * rewriting there would add a database write to every unlock for no gain in what an attacker
 * can do (see ADR-03 §5, 2026-09-24).
 */
const argon2idVerifierSchema: z.ZodObject<
  {
    version: z.ZodLiteral<1>;
    kdf: z.ZodLiteral<'argon2id'>;
    params: z.ZodObject<{ m: z.ZodInt; t: z.ZodInt; p: z.ZodInt }, z.core.$strict>;
    salt: z.ZodString;
    hash: z.ZodString;
  },
  z.core.$strict
> = z.strictObject({
  version: z.literal(1),
  kdf: z.literal('argon2id'),
  params: z.strictObject({
    m: z.int().positive(),
    t: z.int().positive(),
    p: z.int().positive(),
  }),
  salt: z.string().min(1),
  hash: z.string().min(1),
});

const hmacVerifierSchema: z.ZodObject<
  {
    version: z.ZodLiteral<2>;
    kdf: z.ZodLiteral<'hmac-sha256'>;
    salt: z.ZodString;
    hash: z.ZodString;
  },
  z.core.$strict
> = z.strictObject({
  version: z.literal(2),
  kdf: z.literal('hmac-sha256'),
  salt: z.string().min(1),
  hash: z.string().min(1),
});

/** Stored as JSON in `settings`. Contains no secret — only a salt and a hash. */
export const pinVerifierSchema: z.ZodDiscriminatedUnion<
  [typeof argon2idVerifierSchema, typeof hmacVerifierSchema],
  'kdf'
> = z.discriminatedUnion('kdf', [argon2idVerifierSchema, hmacVerifierSchema]);

/** A stored PIN verifier of either version, told apart by `kdf`. */
export type PinVerifier = z.infer<typeof pinVerifierSchema>;
/** A version 1 verifier: Argon2id over the PIN, with the parameters it was made with. */
export type Argon2idPinVerifier = z.infer<typeof argon2idVerifierSchema>;
/** A version 2 verifier: HMAC-SHA256 of salt and PIN under the phone's PIN key. */
export type HmacPinVerifier = z.infer<typeof hmacVerifierSchema>;

/** Length of the HMAC key held in the Keystore. */
export const PIN_KEY_BYTES = 32;

/**
 * A version 2 verifier was found and this phone has no key to check it with. That happens
 * only if the Keystore item is gone while the database is not. **It never means "accept"**:
 * the caller treats it as a PIN that cannot be checked, which is ADR-04's recovery path.
 */
export class PinKeyUnavailableError extends Error {
  constructor() {
    super('the PIN key is not on this phone');
    this.name = 'PinKeyUnavailableError';
  }
}

/** True when a verifier is bound to this phone's Keystore and so does not travel in a backup. */
export function isDeviceBoundVerifier(verifier: PinVerifier): boolean {
  return verifier.kdf === 'hmac-sha256';
}

/** Length of the derived verifier. Not a key; nothing is encrypted with it. */
const VERIFIER_BYTES = 32;

/** Options for `createArgon2idPinVerifier`. */
export interface PinOptions {
  /** Only for `createArgon2idPinVerifier`. */
  readonly params?: Argon2idParams;
  /** Called with the derivation's progress, 0 to 1. */
  readonly onProgress?: (fraction: number) => void;
}

/** Options for `verifyPin`. */
export interface VerifyOptions {
  /** This phone's PIN key, or null when the Keystore has none. Unused by a version 1 record. */
  readonly pinKey: Uint8Array | null;
  /** Called with progress, 0 to 1. A version 2 record reports 1 at once. */
  readonly onProgress?: (fraction: number) => void;
}

/**
 * A PIN is digits the patient chose. It is normalised only by removing surrounding
 * whitespace a keyboard may contribute; nothing else, because two PINs that differ by a
 * character must produce different verifiers.
 */
function encode(pin: string): Uint8Array {
  return new TextEncoder().encode(pin.trim());
}

function mac(pinKey: Uint8Array, salt: Uint8Array, pin: string): Uint8Array {
  if (pinKey.length !== PIN_KEY_BYTES) {
    throw new Error(`the PIN key must be ${PIN_KEY_BYTES} bytes`);
  }
  const pinBytes = encode(pin);
  const message = new Uint8Array(salt.length + pinBytes.length);
  message.set(salt, 0);
  message.set(pinBytes, salt.length);
  return hmacSha256(pinKey, message);
}

/** The verifier every new PIN gets (version 2). */
export function createPinVerifier(pin: string, pinKey: Uint8Array): HmacPinVerifier {
  const salt = randomSalt();
  return {
    version: 2,
    kdf: 'hmac-sha256',
    salt: toBase64(salt),
    hash: toBase64(mac(pinKey, salt, pin)),
  };
}

/**
 * A version 1 record, as builds before 2026-09-24 wrote it. Nothing in the app creates one
 * any more; it is kept so the tests can build exactly what an existing install holds.
 */
export async function createArgon2idPinVerifier(
  pin: string,
  options: PinOptions = {},
): Promise<Argon2idPinVerifier> {
  const params = options.params ?? PIN_ARGON2ID_PARAMS;
  assertArgon2idParams(params);
  const salt = randomSalt();
  const hash = await deriveKey(encode(pin), salt, {
    params,
    keyLength: VERIFIER_BYTES,
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  });
  return {
    version: 1,
    kdf: 'argon2id',
    params,
    salt: toBase64(salt),
    hash: toBase64(hash),
  };
}

/**
 * Compared with `constantTimeEqual`, never `===` (§5). A 4-digit PIN has no entropy to
 * speak of, so a comparison that returns early on the first differing byte would hand an
 * attacker the verifier a byte at a time.
 */
export async function verifyPin(
  pin: string,
  verifier: PinVerifier,
  options: VerifyOptions,
): Promise<boolean> {
  if (verifier.kdf === 'hmac-sha256') {
    if (options.pinKey === null) throw new PinKeyUnavailableError();
    const expected = fromBase64(verifier.hash);
    options.onProgress?.(1);
    return constantTimeEqual(mac(options.pinKey, fromBase64(verifier.salt), pin), expected);
  }
  assertArgon2idParams(verifier.params);
  const expected = fromBase64(verifier.hash);
  const actual = await deriveKey(encode(pin), fromBase64(verifier.salt), {
    params: verifier.params,
    keyLength: expected.length,
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  });
  return constantTimeEqual(actual, expected);
}

/** Parses a stored verifier. Returns null rather than throwing on anything unexpected. */
export function parsePinVerifier(value: unknown): PinVerifier | null {
  const parsed = pinVerifierSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
