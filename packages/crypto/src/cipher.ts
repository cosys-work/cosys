/**
 * ADR-03: XChaCha20-Poly1305 for the `.tappbak` container.
 *
 * It is an AEAD, so decryption either returns the exact plaintext or throws — there is no
 * "mostly decrypted" backup. `open` therefore doubles as the integrity check on a file
 * that has been sitting on an SD card or in a Drive folder since it was written.
 *
 * @module
 */

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';

import { KEY_BYTES, NONCE_BYTES } from './params.ts';

/**
 * Thrown by `open` when the key, nonce, associated data or tag do not verify. The message
 * never says which.
 */
export class DecryptionError extends Error {
  constructor() {
    // Deliberately says nothing about why. A wrong passphrase and a corrupt file are the
    // same event to the patient: the backup will not open, and there is no recovery path
    // (ADR-03 §6). Distinguishing them here would only help someone testing passphrases.
    super('the container could not be decrypted');
    this.name = 'DecryptionError';
  }
}

function aead(key: Uint8Array, nonce: Uint8Array, associatedData?: Uint8Array) {
  if (key.length !== KEY_BYTES) throw new TypeError(`key must be ${KEY_BYTES} bytes`);
  if (nonce.length !== NONCE_BYTES) throw new TypeError(`nonce must be ${NONCE_BYTES} bytes`);
  return xchacha20poly1305(key, nonce, associatedData);
}

/**
 * Encrypts, appending the Poly1305 tag. `associatedData` is authenticated but not
 * encrypted — the manifest is passed here, so a file whose recorded parameters have been
 * edited fails to open rather than decrypting to nonsense.
 */
export function seal(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  associatedData?: Uint8Array,
): Uint8Array {
  return aead(key, nonce, associatedData).encrypt(plaintext);
}

/** Decrypts and verifies. Throws `DecryptionError` on a wrong key, nonce, AAD or tag. */
export function open(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  associatedData?: Uint8Array,
): Uint8Array {
  try {
    return aead(key, nonce, associatedData).decrypt(ciphertext);
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new DecryptionError();
  }
}

/** `open` for a caller that treats failure as an outcome rather than an exception. */
export function tryOpen(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  associatedData?: Uint8Array,
): Uint8Array | null {
  try {
    return open(key, nonce, ciphertext, associatedData);
  } catch (error) {
    if (error instanceof DecryptionError) return null;
    throw error;
  }
}
