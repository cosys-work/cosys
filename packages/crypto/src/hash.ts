/**
 * SHA-256 (one-shot and streaming), HMAC-SHA256 and hex encoding.
 *
 * @module
 */

import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

/**
 * ADR-03: SHA-256, streaming. Attachment and row checksums are what the pilot criterion
 * "backup → wipe → restore yields identical entry count and checksums" is measured with.
 *
 * Streaming is not an optimisation here. A 5 MB photo hashed in one call lands in memory
 * twice — once as the read buffer, once as the argument — on a 4 GB phone that is also
 * holding a tar writer and a cipher (ADR-03 §Consequences). Chunked reads from
 * `expo-file-system` feed `update()` and nothing is ever whole.
 */
export interface Sha256Stream {
  /** Feeds a chunk into the hash and returns the same stream. Throws once the hash is finished. */
  update(chunk: Uint8Array): Sha256Stream;
  /** Finishes the hash. The stream cannot be used afterwards. */
  digest(): Uint8Array;
  /** Finishes the hash and returns it as lowercase hex, which is what the manifest holds. */
  hex(): string;
}

/** Starts an incremental SHA-256. Feed it with `update`, then finish once with `digest` or `hex`. */
export function createSha256Stream(): Sha256Stream {
  const hash = sha256.create();
  let done = false;

  const assertOpen = () => {
    if (done) throw new Error('sha256 stream already finished');
  };

  const stream: Sha256Stream = {
    update(chunk) {
      assertOpen();
      hash.update(chunk);
      return stream;
    },
    digest() {
      assertOpen();
      done = true;
      return hash.digest();
    },
    hex() {
      return bytesToHex(stream.digest());
    },
  };
  return stream;
}

/** One-shot SHA-256, for things that are already small — a manifest, a row. */
export function sha256Bytes(data: Uint8Array): Uint8Array {
  return sha256(data);
}

/** One-shot SHA-256, as lowercase hex. */
export function sha256Hex(data: Uint8Array): string {
  return bytesToHex(sha256(data));
}

/**
 * Hex both ways, behind the crypto seam (ADR-03 rule 1: no feature imports a `@noble` path).
 *
 * `hexToBytes` throws on anything that is not an even-length run of hex digits, which is the
 * behaviour callers want: a stored key that will not parse is a problem to raise, not one to
 * paper over with an empty array.
 */
export { bytesToHex, hexToBytes };

/**
 * HMAC-SHA256 (RFC 2104), the PIN verifier's MAC since 2026-09-24 (ADR-03 §5). One call, not
 * a stream: its inputs are a salt and a few digits.
 */
export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  return hmac(sha256, key, message);
}
