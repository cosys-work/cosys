import { errorCorrection } from './galois.ts';
import {
  countBits,
  dataCodewords,
  MAX_VERSION,
  MIN_VERSION,
  remainderBits,
  sizeOf,
  VERSIONS,
} from './versions.ts';

/**
 * A QR symbol, encoded in repo (ADR-01 §4's precedent, ADR-18 "The peer install" §4).
 *
 * ## Why this is not a library
 *
 * ADR-01 §7: *"A dependency outside the stack list needs an ADR, not a note in the PR
 * description."* §4 of the same ADR already decided the shape of the answer for the charts —
 * *"No charting library. Chart components live in `src/features/review/charts/*`"* — and the
 * reasoning transfers: a QR symbol is a published algorithm with a fixed output, the subset
 * this app needs is one mode and one error-correction level, and the alternative is a runtime
 * dependency on the pairing path, which is the one path where a supply-chain problem would be
 * handing somebody else's key to a patient.
 *
 * The trade is the same too, and it is real: the tables in `versions.ts` are ours to keep
 * right. What makes that safe is the fixtures — a reference encoder's output for every version
 * from 1 to 10, reproduced module for module. A wrong table entry, a wrong Galois product or a
 * misplaced alignment pattern changes the symbol, and the comparison is exact.
 *
 * ## Byte mode only
 *
 * A pairing invite is `tapp://pair/1/` and base64url, which alphanumeric mode cannot carry
 * (it has no lowercase and no `-` or `_`). Numeric and kanji modes have nothing to offer here.
 * One mode is also one character-count header and one capacity table, which is most of why
 * this file is readable.
 *
 * ## What it returns, and what draws it
 *
 * A boolean matrix, no styling and no SVG. `src/features/pairing/QrCode.tsx` draws it, exactly
 * as `glucose-chart.ts` computes a layout that `GlucoseChart.tsx` draws — so the algorithm is
 * testable on a laptop and the drawing is a separate, smaller thing to get wrong.
 */
export interface QrSymbol {
  /** Modules along one side, quiet zone excluded. */
  readonly size: number;
  /** The QR version, 1 to 20: the smallest that holds the text at level M. */
  readonly version: number;
  /** Which of the eight mask patterns was applied. */
  readonly mask: number;
  /** `modules[row][col]`, true where the module is dark. */
  readonly modules: readonly (readonly boolean[])[];
}

/** Thrown by {@link encodeQr} when the text does not fit a version 20 symbol at level M. */
export class QrTooLongError extends Error {
  /** Says how many bytes the text took, against the version 20 limit. */
  constructor(bytes: number) {
    super(`${bytes} bytes does not fit a version ${MAX_VERSION} symbol at level M`);
    this.name = 'QrTooLongError';
  }
}

/** Options for {@link encodeQr}. */
export interface QrOptions {
  /**
   * Force a mask instead of scoring all eight.
   *
   * For tests. Mask choice changes how easily a scanner reads the symbol and never whether it
   * is valid, which is exactly what makes it the right thing to pin when comparing against
   * another encoder: two correct encoders can disagree here and agree everywhere else.
   */
  readonly mask?: number;
}

const MODE_BYTE = 0b0100;
/** Alternating pad codewords, from ISO/IEC 18004 §7.4.10. */
const PAD = [0xec, 0x11] as const;

/**
 * Encodes `text`, as UTF-8 in byte mode at level M, in the smallest version that holds it,
 * with the mask that scores lowest on the standard's penalty rules unless `options.mask` pins
 * one. Throws {@link QrTooLongError} when the text does not fit version 20.
 */
export function encodeQr(text: string, options: QrOptions = {}): QrSymbol {
  const bytes = new TextEncoder().encode(text);
  const version = versionFor(bytes.length);
  const codewords = interleave(version, payload(version, bytes));

  if (options.mask !== undefined) return draw(version, codewords, options.mask);

  // All eight, scored, lowest wins (ISO/IEC 18004 §7.8.3). Built eight times rather than
  // masked in place: a symbol is a few thousand booleans and correctness is worth more here
  // than the microseconds.
  let best: QrSymbol | null = null;
  let bestPenalty = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = draw(version, codewords, mask);
    const score = penalty(candidate.modules);
    if (score < bestPenalty) {
      bestPenalty = score;
      best = candidate;
    }
  }
  return best!;
}

/** The smallest version whose data capacity holds the message with its headers. */
function versionFor(byteLength: number): number {
  for (let version = MIN_VERSION; version <= MAX_VERSION; version += 1) {
    const available = dataCodewords(version) * 8 - 4 - countBits(version);
    if (byteLength * 8 <= available) return version;
  }
  throw new QrTooLongError(byteLength);
}

/** Mode, count, the bytes, the terminator and the pad, as data codewords. */
function payload(version: number, bytes: Uint8Array): Uint8Array {
  const capacity = dataCodewords(version);
  const bits: number[] = [];
  const push = (value: number, width: number) => {
    for (let i = width - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
  };

  push(MODE_BYTE, 4);
  push(bytes.length, countBits(version));
  for (const byte of bytes) push(byte, 8);

  // Terminator: up to four zeros, and fewer when the message ends near the capacity.
  const terminator = Math.min(4, capacity * 8 - bits.length);
  push(0, terminator);
  while (bits.length % 8 !== 0) bits.push(0);

  const out = new Uint8Array(capacity);
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j]!;
    out[i / 8] = byte;
  }
  for (let i = bits.length / 8; i < capacity; i += 1) {
    out[i] = PAD[(i - bits.length / 8) % 2]!;
  }
  return out;
}

/**
 * Split into blocks, add each block's error correction, and interleave (§7.6).
 *
 * The interleave is what makes a QR survive a thumb over one corner: a scratch that destroys
 * fifty consecutive modules damages a few codewords of every block rather than all of one.
 */
function interleave(version: number, data: Uint8Array): Uint8Array {
  const spec = VERSIONS[version]!;
  const blocks: { data: Uint8Array; ec: Uint8Array }[] = [];

  let offset = 0;
  for (const [count, perBlock] of spec.groups) {
    for (let i = 0; i < count; i += 1) {
      const slice = data.slice(offset, offset + perBlock);
      offset += perBlock;
      blocks.push({ data: slice, ec: errorCorrection(slice, spec.ecPerBlock) });
    }
  }

  const out: number[] = [];
  const longest = Math.max(...blocks.map((block) => block.data.length));
  for (let i = 0; i < longest; i += 1) {
    for (const block of blocks) if (i < block.data.length) out.push(block.data[i]!);
  }
  for (let i = 0; i < spec.ecPerBlock; i += 1) {
    for (const block of blocks) out.push(block.ec[i]!);
  }
  return Uint8Array.from(out);
}

type Grid = boolean[][];

/** Lays out one symbol at one mask: function patterns, data, mask, format and version info. */
function draw(version: number, codewords: Uint8Array, mask: number): QrSymbol {
  const size = sizeOf(version);
  const modules: Grid = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  // Function modules carry no data and are never masked, so where they are has to be known
  // before either step — which is why this is a second grid rather than a check on the first.
  const reserved: Grid = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));

  const set = (row: number, col: number, dark: boolean) => {
    modules[row]![col] = dark;
    reserved[row]![col] = true;
  };

  // Timing first, then the finders over the top of it: the finder's separator ring overwrites
  // the three timing modules nearest each corner, which is what the standard's figure shows.
  for (let i = 0; i < size; i += 1) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [row, col] of [
    [3, 3],
    [3, size - 4],
    [size - 4, 3],
  ] as const) {
    for (let dr = -4; dr <= 4; dr += 1) {
      for (let dc = -4; dc <= 4; dc += 1) {
        const r = row + dr;
        const c = col + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const ring = Math.max(Math.abs(dr), Math.abs(dc));
        set(r, c, ring !== 2 && ring !== 4);
      }
    }
  }

  const centres = VERSIONS[version]!.alignment;
  for (const row of centres) {
    for (const col of centres) {
      // The three that would sit on a finder are skipped, not drawn and overwritten: drawing
      // them would clear the finder's own quiet ring.
      if (
        (row === 6 && col === 6) ||
        (row === 6 && col === size - 7) ||
        (row === size - 7 && col === 6)
      ) {
        continue;
      }
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          set(row + dr, col + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
      }
    }
  }

  // Reserved before the data walk, written after the mask is known.
  reserveFormat(reserved, size);
  if (version >= 7) reserveVersion(reserved, size);

  placeData(modules, reserved, size, codewords, remainderBits(version));
  applyMask(modules, reserved, size, mask);
  writeFormat(modules, size, mask);
  if (version >= 7) writeVersion(modules, size, version);

  return { size, version, mask, modules };
}

function reserveFormat(reserved: Grid, size: number): void {
  for (let i = 0; i <= 8; i += 1) {
    reserved[8]![i] = true;
    reserved[i]![8] = true;
  }
  for (let i = 0; i < 8; i += 1) {
    reserved[8]![size - 1 - i] = true;
    reserved[size - 1 - i]![8] = true;
  }
}

function reserveVersion(reserved: Grid, size: number): void {
  for (let i = 0; i < 18; i += 1) {
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    reserved[b]![a] = true;
    reserved[a]![b] = true;
  }
}

/**
 * The zigzag: two columns at a time, right to left, alternating up and down (§7.7.3).
 *
 * Column 6 is skipped because it is the vertical timing pattern, and the pair that would have
 * contained it shifts one to the left instead of being split.
 */
function placeData(
  modules: Grid,
  reserved: Grid,
  size: number,
  codewords: Uint8Array,
  remainder: number,
): void {
  const total = codewords.length * 8 + remainder;
  let bit = 0;

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical += 1) {
      for (let across = 0; across < 2; across += 1) {
        const col = right - across;
        const upward = ((right + 1) & 2) === 0;
        const row = upward ? size - 1 - vertical : vertical;
        if (reserved[row]![col]) continue;
        if (bit >= total) continue;
        // Past the codewords are the remainder bits, which are zeros — already the fill.
        if (bit < codewords.length * 8) {
          modules[row]![col] = ((codewords[bit >> 3]! >> (7 - (bit & 7))) & 1) === 1;
        }
        bit += 1;
      }
    }
  }
}

function applyMask(modules: Grid, reserved: Grid, size: number, mask: number): void {
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (reserved[row]![col]) continue;
      if (maskAt(mask, row, col)) modules[row]![col] = !modules[row]![col];
    }
  }
}

/** The eight patterns of ISO/IEC 18004 table 10. True means "invert this module". */
function maskAt(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return col % 3 === 0;
    case 3:
      return (row + col) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    case 7:
      return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
    default:
      throw new RangeError(`a QR mask is 0 to 7, not ${mask}`);
  }
}

/**
 * Fifteen bits of format information, twice, so losing a corner does not lose the mask.
 *
 * Five bits of content — level M is `00`, then the mask — extended by a BCH(15,5) code and
 * XORed with `0x5412` so that an all-zero format is not all-light (§7.9).
 */
function writeFormat(modules: Grid, size: number, mask: number): void {
  const content = (0b00 << 3) | mask;
  let remainder = content;
  for (let i = 0; i < 10; i += 1) {
    remainder = (remainder << 1) ^ ((remainder >> 9) * 0b10100110111);
  }
  const bits = (((content << 10) | remainder) ^ 0b101010000010010) & 0x7fff;
  const at = (index: number) => ((bits >> index) & 1) === 1;

  for (let i = 0; i <= 5; i += 1) modules[i]![8] = at(i);
  modules[7]![8] = at(6);
  modules[8]![8] = at(7);
  modules[8]![7] = at(8);
  for (let i = 9; i < 15; i += 1) modules[8]![14 - i] = at(i);

  for (let i = 0; i < 8; i += 1) modules[8]![size - 1 - i] = at(i);
  for (let i = 8; i < 15; i += 1) modules[size - 15 + i]![8] = at(i);

  // The one module that is dark in every symbol ever made.
  modules[size - 8]![8] = true;
}

/** Eighteen bits of version, twice, from version 7 up (§7.10). */
function writeVersion(modules: Grid, size: number, version: number): void {
  let remainder = version;
  for (let i = 0; i < 12; i += 1) {
    remainder = (remainder << 1) ^ ((remainder >> 11) * 0b1111100100101);
  }
  const bits = ((version << 12) | remainder) & 0x3ffff;

  for (let i = 0; i < 18; i += 1) {
    const dark = ((bits >> i) & 1) === 1;
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    modules[b]![a] = dark;
    modules[a]![b] = dark;
  }
}

/**
 * How hard a masked symbol is to read, lower being better (ISO/IEC 18004 §7.8.3.1).
 *
 * Four rules: long runs of one shade, solid two-by-two blocks, anything that looks like a
 * finder pattern, and an overall bias towards dark or light.
 *
 * **Rule three is the ISO form, which includes the four light modules.** Some widely used
 * encoders check only the seven-module `1011101` and pick a different mask because of it. Both
 * produce valid symbols — the mask is recorded in the format bits and a scanner simply undoes
 * it — which is why the fixtures pin the mask when comparing against another encoder rather
 * than expecting agreement here.
 */
export function penalty(modules: readonly (readonly boolean[])[]): number {
  const size = modules.length;
  const at = (row: number, col: number) => modules[row]![col]!;
  let score = 0;

  // Rule 1: five or more in a row, three points plus one for each beyond five.
  for (let i = 0; i < size; i += 1) {
    for (const read of [(j: number) => at(i, j), (j: number) => at(j, i)]) {
      let run = 1;
      for (let j = 1; j < size; j += 1) {
        if (read(j) === read(j - 1)) {
          run += 1;
          continue;
        }
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
      if (run >= 5) score += 3 + (run - 5);
    }
  }

  // Rule 2: every two-by-two block of one shade, three points. Overlapping blocks count.
  for (let row = 0; row < size - 1; row += 1) {
    for (let col = 0; col < size - 1; col += 1) {
      const first = at(row, col);
      if (
        first === at(row, col + 1) &&
        first === at(row + 1, col) &&
        first === at(row + 1, col + 1)
      ) {
        score += 3;
      }
    }
  }

  // Rule 3: the finder's 1:1:3:1:1 with four light modules on either side, forty points.
  const FINDER = [true, false, true, true, true, false, true];
  const matches = (read: (index: number) => boolean, start: number): boolean => {
    for (let i = 0; i < 7; i += 1) if (read(start + i) !== FINDER[i]) return false;
    const before = [1, 2, 3, 4].every((gap) => read(start - gap) === false);
    const after = [0, 1, 2, 3].every((gap) => read(start + 7 + gap) === false);
    return before || after;
  };
  for (let i = 0; i < size; i += 1) {
    // Outside the symbol is the quiet zone, which is light — so a finder-like run against the
    // edge counts, which is exactly the case the rule is about.
    const row = (j: number) => (j < 0 || j >= size ? false : at(i, j));
    const col = (j: number) => (j < 0 || j >= size ? false : at(j, i));
    for (let j = 0; j <= size - 7; j += 1) {
      if (matches(row, j)) score += 40;
      if (matches(col, j)) score += 40;
    }
  }

  // Rule 4: ten points for every five percent the dark share is away from half.
  let dark = 0;
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) if (at(row, col)) dark += 1;
  }
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}
