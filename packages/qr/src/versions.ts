/**
 * The block structure of a QR symbol, for the versions this app can produce.
 *
 * ## Versions 1 to 20, at error-correction level M, and nothing else
 *
 * **This is a deliberate narrowing rather than an unfinished table.** The one thing the app
 * encodes is a pairing invite (ADR-18 "The peer install" §4): `tapp://pair/1/` followed by
 * base64url of a version byte, a 32-byte identity key, a name of at most 48 bytes and a 4-byte
 * checksum. That is 66 to 130 characters, which lands between versions 5 and 8. Version 10 at
 * level M holds 213 bytes, so the range has room for a longer name and for a second invite
 * format, and stops well before the tables get long enough to be worth nobody's proofreading.
 *
 * *Widened to version 20, 2026-10-02 (PLAN M13-D3).* The clinic's desk code carries its
 * operator-signed directory entry (ADR-20 §3), so a patient's phone can verify the clinic offline
 * before it shows a confirmation screen: a signature, two keys, the name, the registration, the
 * tier and two dates, about 550 characters once base64url'd. Version 20 holds 666 bytes at
 * level M. The rows for 11 to 20 are checked the same two ways as the first ten, against the
 * same reference encoder (`fixtures/extended.json`).
 *
 * A string that does not fit is refused by name (`QrTooLongError`) rather than silently
 * truncated, because a truncated invite encodes to a QR that scans perfectly and pairs with
 * nobody — the same failure the pairing checksum exists to turn into a refusal.
 *
 * **Level M** (about 15% recoverable) is the standard's own middle and what every QR library
 * defaults to. L would make the symbol one version smaller and is the wrong trade for a code
 * read off a phone screen at an angle, possibly with a fingerprint on it.
 *
 * ## Where these numbers come from
 *
 * ISO/IEC 18004 tables 9 and 13–22. Each row is checked twice over: the test asserts that
 * `blocks × (data + ec) = totalCodewords` for every version, and the fixtures assert that a
 * real encoder's output is reproduced byte for byte — a wrong row in this table cannot survive
 * either.
 */

export interface VersionSpec {
  /** Data plus error-correction codewords in the whole symbol. */
  readonly totalCodewords: number;
  /** Error-correction codewords in each block. The same for every block of a version. */
  readonly ecPerBlock: number;
  /** `[blockCount, dataCodewordsPerBlock]` for the short group, then the long one if any. */
  readonly groups: readonly (readonly [blocks: number, dataCodewords: number])[];
  /** Row and column centres of the alignment patterns. Empty at version 1. */
  readonly alignment: readonly number[];
}

/** The smallest version the encoder makes. */
export const MIN_VERSION = 1;
/** The largest version the encoder makes, which holds up to 666 bytes at level M. */
export const MAX_VERSION = 20;

export const VERSIONS: Readonly<Record<number, VersionSpec>> = {
  1: { totalCodewords: 26, ecPerBlock: 10, groups: [[1, 16]], alignment: [] },
  2: { totalCodewords: 44, ecPerBlock: 16, groups: [[1, 28]], alignment: [6, 18] },
  3: { totalCodewords: 70, ecPerBlock: 26, groups: [[1, 44]], alignment: [6, 22] },
  4: { totalCodewords: 100, ecPerBlock: 18, groups: [[2, 32]], alignment: [6, 26] },
  5: { totalCodewords: 134, ecPerBlock: 24, groups: [[2, 43]], alignment: [6, 30] },
  6: { totalCodewords: 172, ecPerBlock: 16, groups: [[4, 27]], alignment: [6, 34] },
  7: { totalCodewords: 196, ecPerBlock: 18, groups: [[4, 31]], alignment: [6, 22, 38] },
  8: { totalCodewords: 242, ecPerBlock: 22, groups: [[2, 38], [2, 39]], alignment: [6, 24, 42] },
  9: { totalCodewords: 292, ecPerBlock: 22, groups: [[3, 36], [2, 37]], alignment: [6, 26, 46] },
  10: { totalCodewords: 346, ecPerBlock: 26, groups: [[4, 43], [1, 44]], alignment: [6, 28, 50] },
  11: { totalCodewords: 404, ecPerBlock: 30, groups: [[1, 50], [4, 51]], alignment: [6, 30, 54] },
  12: { totalCodewords: 466, ecPerBlock: 22, groups: [[6, 36], [2, 37]], alignment: [6, 32, 58] },
  13: { totalCodewords: 532, ecPerBlock: 22, groups: [[8, 37], [1, 38]], alignment: [6, 34, 62] },
  14: { totalCodewords: 581, ecPerBlock: 24, groups: [[4, 40], [5, 41]], alignment: [6, 26, 46, 66] },
  15: { totalCodewords: 655, ecPerBlock: 24, groups: [[5, 41], [5, 42]], alignment: [6, 26, 48, 70] },
  16: { totalCodewords: 733, ecPerBlock: 28, groups: [[7, 45], [3, 46]], alignment: [6, 26, 50, 74] },
  17: { totalCodewords: 815, ecPerBlock: 28, groups: [[10, 46], [1, 47]], alignment: [6, 30, 54, 78] },
  18: { totalCodewords: 901, ecPerBlock: 26, groups: [[9, 43], [4, 44]], alignment: [6, 30, 56, 82] },
  19: { totalCodewords: 991, ecPerBlock: 26, groups: [[3, 44], [11, 45]], alignment: [6, 30, 58, 86] },
  20: { totalCodewords: 1085, ecPerBlock: 26, groups: [[3, 41], [13, 42]], alignment: [6, 34, 62, 90] },
};

/** Modules along one side: 21 at version 1, growing by four. */
export const sizeOf = (version: number): number => 17 + 4 * version;

/** Data codewords available to the message, before the mode and count headers. */
export function dataCodewords(version: number): number {
  const spec = VERSIONS[version]!;
  return spec.groups.reduce((total, [blocks, perBlock]) => total + blocks * perBlock, 0);
}

/**
 * Bits left over after the codewords, which are placed as zeros (ISO/IEC 18004 table 1).
 *
 * Versions 2 to 6 have seven; 1 and 7 to 13 have none; 14 to 20 have three. It is not a rounding error to ignore:
 * the data-placement walk visits every free module, so a symbol that stopped short would leave
 * whatever the mask puts there and fail its own checksum.
 */
export const remainderBits = (version: number): number =>
  version >= 2 && version <= 6 ? 7 : version >= 14 && version <= 20 ? 3 : 0;

/** Bits in the character-count header for byte mode: eight below version 10, sixteen from it. */
export const countBits = (version: number): number => (version < 10 ? 8 : 16);
