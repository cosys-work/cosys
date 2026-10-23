/**
 * Constant-time byte comparison, for checking a secret-derived value such as a PIN verifier.
 *
 * @module
 */

import { equalBytes } from '@noble/ciphers/utils.js';

/**
 * ADR-03 §5: "compared in constant time using the library's `equalBytes`, never `===`".
 *
 * `===` on two `Uint8Array`s compares references and is always false, which would be a
 * fail-closed bug rather than a security one. The real hazard is the obvious fix — a
 * loop that returns early on the first differing byte — which leaks, byte by byte, how
 * much of a guess was right. A 4-digit PIN has no entropy to spare.
 *
 * Length is not secret and `equalBytes` may return early on it.
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  return equalBytes(a, b);
}
