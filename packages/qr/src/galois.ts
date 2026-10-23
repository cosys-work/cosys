/**
 * GF(256) and the Reed–Solomon remainder a QR symbol's error correction is (ISO/IEC 18004 §7.5).
 *
 * The field is the one the standard names: 256 elements, primitive polynomial
 * x⁸ + x⁴ + x³ + x² + 1 (`0x11d`), generator 2. Everything below is table lookups over that.
 *
 * Kept apart from the encoder because it is the half with no QR in it — a polynomial remainder
 * over a finite field, testable against values worked out by hand, and the place a mistake would
 * be invisible in a rendered symbol (a wrong ECC byte still draws a tidy square).
 */

const PRIMITIVE = 0x11d;

/** `EXP[i] = α^i`, doubled so `EXP[log a + log b]` never needs a modulo. */
const EXP = new Uint8Array(512);
/** `LOG[α^i] = i`. `LOG[0]` is unused: zero has no logarithm. */
const LOG = new Uint8Array(256);

{
  let value = 1;
  for (let power = 0; power < 255; power += 1) {
    EXP[power] = value;
    LOG[value] = power;
    value <<= 1;
    if (value & 0x100) value ^= PRIMITIVE;
  }
  for (let power = 255; power < 512; power += 1) EXP[power] = EXP[power - 255]!;
}

export function multiply(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a]! + LOG[b]!]!;
}

/**
 * The generator polynomial for `degree` error-correction codewords: ∏(x − α^i), i < degree.
 *
 * Returned highest-power-first with a leading 1, which is what makes the division below a
 * plain XOR of the shifted generator.
 */
export function generatorPolynomial(degree: number): Uint8Array {
  let poly = Uint8Array.of(1);
  for (let i = 0; i < degree; i += 1) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] = (next[j] ?? 0) ^ poly[j]!;
      next[j + 1] = (next[j + 1] ?? 0) ^ multiply(poly[j]!, EXP[i]!);
    }
    poly = next;
  }
  return poly;
}

/** The `degree` error-correction codewords for one block of data codewords. */
export function errorCorrection(data: Uint8Array, degree: number): Uint8Array {
  const generator = generatorPolynomial(degree);
  const working = new Uint8Array(data.length + degree);
  working.set(data);

  for (let i = 0; i < data.length; i += 1) {
    const lead = working[i]!;
    if (lead === 0) continue;
    // `generator[0]` is 1, so this step always clears `working[i]` — which is what makes the
    // loop a division rather than an accumulation.
    for (let j = 0; j < generator.length; j += 1) {
      working[i + j] = working[i + j]! ^ multiply(generator[j]!, lead);
    }
  }
  return working.slice(data.length);
}
