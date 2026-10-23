/**
 * Chunked AEAD — how `.tappbak` is encrypted without ever holding the archive.
 *
 * ADR-03 names XChaCha20-Poly1305 (§Decision) and, two rules later, requires that
 * "export and restore must never hold a whole attachment, let alone a whole archive, in
 * memory" (§7). Those two together do not fit a one-shot `encrypt(plaintext)` call: an
 * AEAD verifies its tag over the whole message, so a single-shot container would have to
 * be assembled in memory before it could be sealed, and assembled again in memory before
 * it could be opened. On a 4 GB phone with a 300 MB archive of photos, that is the crash
 * ADR-03 §7 is written to prevent.
 *
 * So the container is a **sequence of independently sealed chunks** — the STREAM
 * construction, the same shape `age` and libsodium's `secretstream` use. Each chunk is a
 * frame:
 *
 *     uint32be ciphertextLength | ciphertext (plaintext chunk ‖ Poly1305 tag)
 *
 * and each chunk's nonce is derived from a 16-byte random base kept in the manifest:
 *
 *     nonce = base(16) ‖ counter(7, big-endian) ‖ finalFlag(1)
 *
 * The three properties that buys, and each is a real attack on a backup file:
 *
 * - **Reordering** changes a chunk's counter, so its tag no longer verifies.
 * - **Truncation** removes the chunk whose flag byte is 1, and `openStream` refuses a
 *   stream that ends without having seen it. Without the flag, cutting a backup short
 *   would decrypt cleanly to a shorter, plausible, wrong record.
 * - **Substitution across files** would need the same base nonce *and* the same key; the
 *   base is 16 fresh random bytes per container and the key is derived from a per-container
 *   salt (ADR-03 §3).
 *
 * The manifest is passed as associated data on every chunk, so a file whose recorded KDF
 * parameters have been edited fails to open rather than decrypting to nonsense — which is
 * the property `cipher.ts` already describes for the one-shot case.
 *
 * This framing is a decision ADR-03 implies but does not spell out; ADR-03 writes it
 * down.
 *
 * @module
 */

import { createByteReader, rechunk, readUint32, writeUint32 } from './bytes.ts';
import { DecryptionError, open, seal } from './cipher.ts';
import { KEY_BYTES, NONCE_BYTES, TAG_BYTES } from './params.ts';

/** Random prefix of the per-chunk nonce, kept in the manifest. */
export const STREAM_NONCE_BASE_BYTES = 16;
/** Big-endian chunk counter, then the final-chunk flag. Together they fill the nonce. */
const COUNTER_BYTES = 7;
const FLAG_BYTES = 1;

/**
 * Plaintext bytes per chunk. 64 KiB is the attachment store's own read size, so a chunked
 * file read feeds this without re-buffering, and the ciphertext frame stays well inside
 * what a single `Uint8Array` costs on the reference device.
 */
export const STREAM_CHUNK_BYTES = 64 * 1024;

/** Largest frame `openStream` will honour, so a corrupt length cannot ask for a gigabyte. */
const MAX_FRAME_BYTES = STREAM_CHUNK_BYTES + TAG_BYTES;

/** Counter width is 7 bytes; a stream longer than this cannot be addressed. */
const MAX_CHUNKS = 2 ** 53 - 1;

/**
 * Thrown by `openStream` and `opensStream` when the input is not a well-formed frame
 * sequence: a frame length out of range, a stream that ends early, or (`openStream` only)
 * data after the last chunk.
 */
export class StreamFormatError extends Error {
  /**
   * Creates the error with a message saying what was wrong.
   *
   * @param message What was wrong with the framing.
   */
  constructor(message: string) {
    super(message);
    this.name = 'StreamFormatError';
  }
}

/**
 * The nonce for one chunk. Exported for the tests, which assert the construction rather
 * than trusting it: a nonce reused across two chunks under one key would leak the
 * plaintext of both, and that is not a failure a round-trip test would ever show.
 */
export function chunkNonce(base: Uint8Array, index: number, final: boolean): Uint8Array {
  if (base.length !== STREAM_NONCE_BASE_BYTES) {
    throw new TypeError(`nonce base must be ${STREAM_NONCE_BASE_BYTES} bytes`);
  }
  if (!Number.isInteger(index) || index < 0 || index > MAX_CHUNKS) {
    throw new RangeError(`chunk index out of range: ${index}`);
  }
  const nonce = new Uint8Array(NONCE_BYTES);
  nonce.set(base, 0);
  // Written from the low byte up, so the counter is big-endian across the seven bytes.
  let remaining = index;
  for (
    let offset = STREAM_NONCE_BASE_BYTES + COUNTER_BYTES - 1;
    offset >= STREAM_NONCE_BASE_BYTES;
    offset -= 1
  ) {
    nonce[offset] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  nonce[NONCE_BYTES - FLAG_BYTES] = final ? 1 : 0;
  return nonce;
}

function assertKey(key: Uint8Array): void {
  if (key.length !== KEY_BYTES) throw new TypeError(`key must be ${KEY_BYTES} bytes`);
}

/**
 * Seals a plaintext stream into framed chunks.
 *
 * An empty plaintext still produces exactly one frame — the final one, sealing zero
 * bytes. Without it an empty archive would be indistinguishable from a truncated one.
 */
export async function* sealStream(
  key: Uint8Array,
  base: Uint8Array,
  plaintext: AsyncIterable<Uint8Array>,
  associatedData?: Uint8Array,
): AsyncIterable<Uint8Array> {
  assertKey(key);

  let index = 0;
  let pending: Uint8Array | null = null;

  const emit = (chunk: Uint8Array, final: boolean): Uint8Array[] => {
    const ciphertext = seal(key, chunkNonce(base, index, final), chunk, associatedData);
    index += 1;
    return [writeUint32(ciphertext.length), ciphertext];
  };

  for await (const chunk of rechunk(plaintext, STREAM_CHUNK_BYTES)) {
    // Held one chunk back, because which chunk is last is only knowable once the next one
    // fails to arrive — and the last chunk is the one whose flag makes truncation visible.
    if (pending !== null) for (const part of emit(pending, false)) yield part;
    pending = chunk;
  }

  for (const part of emit(pending ?? new Uint8Array(0), true)) yield part;
}

/**
 * Opens a framed stream, yielding plaintext chunks.
 *
 * Throws `DecryptionError` on a wrong passphrase, an edited manifest, a reordered chunk
 * or a flipped bit, and `StreamFormatError` on a frame that is not a frame. A stream that
 * ends before the final chunk throws rather than returning what it managed to read: a
 * partial restore that looks complete is the worst outcome available here.
 */
export async function* openStream(
  key: Uint8Array,
  base: Uint8Array,
  frames: AsyncIterable<Uint8Array>,
  associatedData?: Uint8Array,
): AsyncIterable<Uint8Array> {
  assertKey(key);
  const reader = createByteReader(frames);

  for (let index = 0; ; index += 1) {
    const header = await reader.exact(4);
    if (header === null) throw new StreamFormatError('the archive ended before its last chunk');

    const length = readUint32(header);
    if (length < TAG_BYTES || length > MAX_FRAME_BYTES) {
      throw new StreamFormatError(`frame length out of range: ${length}`);
    }

    const ciphertext = await reader.exact(length);
    if (ciphertext === null) throw new StreamFormatError('the archive ended inside a chunk');

    // Which flag a chunk carries is not recorded anywhere in the clear — it is part of the
    // nonce, so trying both is how the reader learns whether this was the last one. A
    // chunk that verifies under the final flag *is* the last one, and nothing after it is
    // read; a chunk that verifies under neither is a wrong key or a corrupt file.
    const asFinal = tryChunk(key, base, index, true, ciphertext, associatedData);
    if (asFinal !== null) {
      if (asFinal.length > 0) yield asFinal;
      if (!(await reader.done())) throw new StreamFormatError('trailing data after the last chunk');
      return;
    }

    const chunk = tryChunk(key, base, index, false, ciphertext, associatedData);
    if (chunk === null) throw new DecryptionError();
    yield chunk;
  }
}

function tryChunk(
  key: Uint8Array,
  base: Uint8Array,
  index: number,
  final: boolean,
  ciphertext: Uint8Array,
  associatedData?: Uint8Array,
): Uint8Array | null {
  try {
    return open(key, chunkNonce(base, index, final), ciphertext, associatedData);
  } catch (error) {
    if (error instanceof DecryptionError) return null;
    throw error;
  }
}

/**
 * Whether a key opens a framed stream, read no further than its **first frame**.
 *
 * The one thing a patient can never rehearse today is whether they still remember the
 * backup passphrase: finding out means running a restore, which writes rows (F31). This is
 * the read half of `openStream` with the loop taken out — derive, open one frame, stop.
 *
 * It lives here rather than in `data/backup` because the framing is behind the crypto seam
 * (ADR-03 §D, rule 1) and because this is a statement about the AEAD: a frame whose
 * Poly1305 tag verifies under a key was sealed under that key, and a frame that does not is
 * a wrong passphrase, an edited manifest or a damaged file, which are the same answer to
 * the patient. One frame is enough for that and is ≤ 64 KiB (ADR-03 §A), so rule 7 —
 * never hold a whole attachment, let alone a whole archive — holds by construction.
 *
 * `false` rather than a throw for a key that does not fit, because "no" is an answer here
 * and not an error. A stream that is not a stream of frames still throws
 * `StreamFormatError`: that is a different question with a different answer.
 */
export async function opensStream(
  key: Uint8Array,
  base: Uint8Array,
  frames: AsyncIterable<Uint8Array>,
  associatedData?: Uint8Array,
): Promise<boolean> {
  assertKey(key);
  const reader = createByteReader(frames);

  const header = await reader.exact(4);
  if (header === null) throw new StreamFormatError('the archive ended before its last chunk');

  const length = readUint32(header);
  if (length < TAG_BYTES || length > MAX_FRAME_BYTES) {
    throw new StreamFormatError(`frame length out of range: ${length}`);
  }

  const ciphertext = await reader.exact(length);
  if (ciphertext === null) throw new StreamFormatError('the archive ended inside a chunk');

  // Both flags, for the same reason `openStream` tries both: which one the first frame
  // carries depends on whether the archive is one frame long, and an empty archive is one
  // final frame sealing zero bytes.
  return (
    tryChunk(key, base, 0, true, ciphertext, associatedData) !== null ||
    tryChunk(key, base, 0, false, ciphertext, associatedData) !== null
  );
}
