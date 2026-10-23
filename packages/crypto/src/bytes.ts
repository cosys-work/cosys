/**
 * Byte-stream plumbing for the `.tappbak` container (ADR-03 §7).
 *
 * The container is written and read as a stream because "export and restore must never
 * hold a whole attachment, let alone a whole archive, in memory" — a 4 GB phone holding a
 * 5 MB photo twice, plus a tar writer and a cipher, is the failure that rule exists to
 * prevent. Streams arrive in whatever sizes the file system feels like, and both the tar
 * format and the chunked cipher need *exact* lengths: 512-byte headers, fixed-size
 * plaintext chunks, a 4-byte frame length. These two helpers are that mismatch, solved
 * once.
 *
 * Nothing here is crypto and nothing here is app-specific; it is `Uint8Array` arithmetic.
 *
 * @module
 */

/** Concatenates chunks into one buffer. Callers use it for small, bounded things only. */
export function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Re-chunks a stream to exactly `size` bytes per piece, with a shorter final piece.
 *
 * An empty input yields nothing at all rather than one empty chunk — a caller that needs
 * to know it saw the end uses the return of `next()`, not a zero-length buffer.
 */
export async function* rechunk(
  source: AsyncIterable<Uint8Array>,
  size: number,
): AsyncIterable<Uint8Array> {
  if (!Number.isInteger(size) || size < 1)
    throw new TypeError('chunk size must be a positive integer');

  let held: Uint8Array[] = [];
  let heldLength = 0;

  for await (const chunk of source) {
    if (chunk.length === 0) continue;
    held.push(chunk);
    heldLength += chunk.length;

    while (heldLength >= size) {
      const joined = concatBytes(held);
      yield joined.subarray(0, size);
      const rest = joined.subarray(size);
      held = rest.length > 0 ? [rest] : [];
      heldLength = rest.length;
    }
  }

  if (heldLength > 0) yield concatBytes(held);
}

/**
 * Pull-style reader over a byte stream: "give me exactly N bytes".
 *
 * The tar reader and the cipher's frame reader are both written against this rather than
 * against an iterator, because both are parsers — a parser that has to remember how much
 * of a header it has seen so far is where an off-by-one becomes a corrupt restore.
 */
export interface ByteReader {
  /**
   * Exactly `length` bytes, or null at a clean end of stream. Throws when the stream ends
   * part-way through — a truncated archive is a fault, not an outcome.
   */
  exact(length: number): Promise<Uint8Array | null>;
  /** Up to `length` bytes; shorter at the end. Null once nothing is left. */
  some(length: number): Promise<Uint8Array | null>;
  /** True when the stream has no bytes left. */
  done(): Promise<boolean>;
  /**
   * Everything not yet read, as a stream of its own.
   *
   * The `.tappbak` container is a plaintext header followed by ciphertext, and the header
   * has to be parsed before the key that opens the rest can even be derived. Handing the
   * remainder on as a stream is what keeps that a single pass over the file — the
   * alternative is reading the file twice, or holding it.
   *
   * The reader is spent once this is called.
   */
  rest(): AsyncIterable<Uint8Array>;
}

/** Thrown by {@link ByteReader.exact} when the stream ends part-way through the bytes asked for. */
export class TruncatedStreamError extends Error {
  /**
   * Records how many bytes were asked for and how many arrived.
   *
   * @param wanted The number of bytes the caller asked for.
   * @param got The number of bytes left in the stream when it ended.
   */
  constructor(
    readonly wanted: number,
    readonly got: number,
  ) {
    super(`stream ended after ${got} of ${wanted} bytes`);
    this.name = 'TruncatedStreamError';
  }
}

/**
 * Wraps a byte stream in a {@link ByteReader}. The source is pulled lazily, only as far as
 * each read needs, and is consumed: nothing else should iterate it afterwards.
 */
export function createByteReader(source: AsyncIterable<Uint8Array>): ByteReader {
  const iterator = source[Symbol.asyncIterator]();
  let held: Uint8Array | null = null;
  let ended = false;

  /** Pulls until `held` has at least `length` bytes or the source is exhausted. */
  async function fill(length: number): Promise<void> {
    while (!ended && (held?.length ?? 0) < length) {
      const next = await iterator.next();
      if (next.done) {
        ended = true;
        break;
      }
      const chunk = next.value;
      if (chunk.length === 0) continue;
      held = held === null ? chunk : concatBytes([held, chunk]);
    }
  }

  function take(length: number): Uint8Array {
    const buffer = held!;
    const out = buffer.subarray(0, length);
    held = buffer.length > length ? buffer.subarray(length) : null;
    return out;
  }

  return {
    async exact(length) {
      if (length === 0) return new Uint8Array(0);
      await fill(length);
      const available = held?.length ?? 0;
      if (available === 0) return null;
      if (available < length) throw new TruncatedStreamError(length, available);
      return take(length);
    },

    async some(length) {
      await fill(1);
      const available = held?.length ?? 0;
      if (available === 0) return null;
      return take(Math.min(length, available));
    },

    async done() {
      await fill(1);
      return (held?.length ?? 0) === 0;
    },

    rest() {
      return {
        async *[Symbol.asyncIterator]() {
          if (held !== null) {
            const buffered = held;
            held = null;
            yield buffered;
          }
          while (!ended) {
            const next = await iterator.next();
            if (next.done) {
              ended = true;
              break;
            }
            if (next.value.length > 0) yield next.value;
          }
        },
      };
    },
  };
}

/** Big-endian unsigned 32-bit, the only integer encoding the container uses. */
export function writeUint32(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError(`not a uint32: ${value}`);
  }
  const out = new Uint8Array(4);
  out[0] = (value >>> 24) & 0xff;
  out[1] = (value >>> 16) & 0xff;
  out[2] = (value >>> 8) & 0xff;
  out[3] = value & 0xff;
  return out;
}

/**
 * Reads a big-endian unsigned 32-bit integer at `offset` (default 0). Throws `RangeError`
 * when fewer than four bytes are available there.
 */
export function readUint32(bytes: Uint8Array, offset = 0): number {
  if (bytes.length < offset + 4) throw new RangeError('not enough bytes for a uint32');
  return (
    ((bytes[offset]! << 24) >>> 0) +
    (bytes[offset + 1]! << 16) +
    (bytes[offset + 2]! << 8) +
    bytes[offset + 3]!
  );
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Encodes a string as UTF-8 bytes. */
export function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}

/** Decodes UTF-8 bytes to a string. Invalid sequences become U+FFFD rather than throwing. */
export function fromUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}
