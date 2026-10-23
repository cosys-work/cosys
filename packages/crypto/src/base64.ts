/**
 * Standard base64 (RFC 4648 alphabet, `=` padding) in plain TypeScript, so the encoding does
 * not depend on the runtime's `btoa` or `atob`.
 *
 * @module
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Base64 without depending on a platform `btoa`: Hermes and Node disagree about what is
 * available, and the DB key must encode identically on both.
 */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    const triple = (b0 << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0);
    out += ALPHABET[(triple >> 18) & 63];
    out += ALPHABET[(triple >> 12) & 63];
    out += b1 === undefined ? '=' : ALPHABET[(triple >> 6) & 63];
    out += b2 === undefined ? '=' : ALPHABET[triple & 63];
  }
  return out;
}

/**
 * The inverse. Needed wherever bytes round-trip through JSON — the PIN verifier's salt
 * and hash, and the `.tappbak` manifest (ADR-03 §3). Throws on input that is not
 * base64, because a silently-wrong decode of a salt is a verifier that never matches.
 */
export function fromBase64(text: string): Uint8Array {
  const trimmed = text.replace(/=+$/, '');
  if (!/^[A-Za-z0-9+/]*$/.test(trimmed)) throw new TypeError('not base64');
  const out = new Uint8Array((trimmed.length * 3) >> 2);
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const char of trimmed) {
    value = (value << 6) | ALPHABET.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index] = (value >> bits) & 0xff;
      index += 1;
    }
  }
  return out.subarray(0, index);
}
