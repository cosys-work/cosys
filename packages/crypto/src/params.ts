/**
 * ADR-03 §3: **the container is self-describing.** The manifest records the algorithm
 * ids, the Argon2id parameters, the salt, the nonce and a format version, and restore
 * reads the parameters out of the file it is restoring — it never assumes today's
 * defaults. Changing parameters must not orphan an existing backup.
 *
 * That is why these are values in a record rather than constants read at the call site.
 *
 * @module
 */

/** Algorithm ids as they appear in a `.tappbak` manifest. */
export const KDF_ALGORITHM = 'argon2id' as const;
/** The cipher id a `.tappbak` manifest records. */
export const CIPHER_ALGORITHM = 'xchacha20poly1305' as const;
/** The hash id a `.tappbak` manifest records. */
export const HASH_ALGORITHM = 'sha256' as const;

/** Symmetric key length, in bytes. */
export const KEY_BYTES = 32;
/** XChaCha20-Poly1305 nonce length, in bytes. */
export const NONCE_BYTES = 24;
/** KDF salt length, in bytes. */
export const SALT_BYTES = 16;
/** Poly1305 tag, appended to the ciphertext by the AEAD. */
export const TAG_BYTES = 16;

/**
 * Argon2id cost. `m` is memory in KiB, following the Argon2 spec and `@noble/hashes`.
 *
 * ADR-03 §4: start at m = 32 MiB, t = 3, p = 1, **measure on the reference device** (a
 * 4 GB Galaxy M16) and record the number in `docs/reference-device.md`. Target ≤ 3 s with
 * a progress indicator; if the measurement is far under, raise `m` before shipping. Pure
 * JS Argon2id in Hermes is the main performance risk of the ADR.
 *
 * **Two sets, because two things can derive a key.** ADR-03 split them when the PIN
 * verifier measured 38 s per unlock. ADR-04's first draft removed the PIN and collapsed
 * them back into one; its amendment made the PIN an opt-in and the split is live again —
 * for whoever chooses a PIN, it is verified on every unlock and pays the lighter cost, while
 * the backup passphrase is paid once with a progress indicator and keeps the full one.
 */
export interface Argon2idParams {
  /** Memory, in KiB. */
  readonly m: number;
  /** Iterations. */
  readonly t: number;
  /** Parallelism (lanes). */
  readonly p: number;
}

/**
 * The full Argon2id cost (m = 32 MiB, t = 3, p = 1), used for the backup passphrase and as
 * the `deriveKey` default.
 */
export const DEFAULT_ARGON2ID_PARAMS: Argon2idParams = { m: 32 * 1024, t: 3, p: 1 };

/**
 * **The PIN verifier uses its own, lighter parameters.** ADR-03 (Proposed) argues the
 * case; ADR-03 §Revisit triggers is what requires the change:
 *
 * > "Measured Argon2id derivation on the reference device exceeds ~5 s at m = 32 MiB —
 * > step the parameters down, record the measurement…"
 *
 * Measured 2026-09-16 on the `tapp-ref` emulator (API 31, x86_64, 4 GB): **38 435 ms** at
 * `DEFAULT_ARGON2ID_PARAMS`, from the app's own `pin.set { ms }` record. That is twelve
 * times the revisit threshold, and it is not a one-shot cost the way ADR-03
 * §Consequences assumes — the PIN is verified on **every unlock**, so a patient checking
 * their sugar four times a day would wait two and a half minutes for the privilege.
 *
 * Why lighter is defensible here, and only here: a four-digit PIN carries about thirteen
 * bits of entropy. An attacker holding the verifier enumerates all ten thousand candidates
 * whatever the KDF costs, so the KDF buys hours, not security. What actually protects the
 * record is that the verifier lives inside the SQLCipher database, whose key is thirty-two
 * random bytes in the Android Keystore and is never derived from the PIN (ADR-03 §5).
 *
 * The **backup passphrase keeps the full parameters**. It is human-chosen, it defends a
 * file that leaves the device, and it is paid once with a progress indicator — which is
 * the case ADR-03 §4 was actually reasoning about.
 *
 * Re-measure on the Galaxy M16 before the pilot; the emulator is not the device.
 */
export const PIN_ARGON2ID_PARAMS: Argon2idParams = { m: 8 * 1024, t: 1, p: 1 };

/**
 * Bounds on what will be honoured when reading a manifest. A backup file is untrusted
 * input: a manifest claiming `m = 4 GiB` is not a parameter, it is a denial of service on
 * a 4 GB phone, and one claiming `t = 0` is not Argon2id at all.
 */
const LIMITS = {
  m: { min: 8, max: 512 * 1024 },
  t: { min: 1, max: 16 },
  p: { min: 1, max: 4 },
} as const;

/** Thrown by `assertArgon2idParams` when a parameter is not an integer inside its bounds. */
export class InvalidParametersError extends Error {
  /**
   * Creates the error with a message naming the parameter.
   *
   * @param message Names the parameter, its allowed range and the value received.
   */
  constructor(message: string) {
    super(message);
    this.name = 'InvalidParametersError';
  }
}

/** Validates parameters read from a manifest, or from anywhere else. */
export function assertArgon2idParams(params: Argon2idParams): void {
  for (const key of ['m', 't', 'p'] as const) {
    const value = params[key];
    const { min, max } = LIMITS[key];
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new InvalidParametersError(
        `argon2id parameter ${key} must be an integer in [${min}, ${max}], got ${String(value)}`,
      );
    }
  }
}
