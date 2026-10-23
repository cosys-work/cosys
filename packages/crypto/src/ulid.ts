/**
 * ULID generation and parsing: 26-character, Crockford base32 ids that sort by creation time,
 * monotonic within a millisecond.
 *
 * @module
 */

import { randomBytes } from './entropy.ts';

/** Crockford base32, per the ULID spec. */
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LEN = 10;
const RANDOM_LEN = 16;

/** Length of a ULID string: 10 time characters and 16 random ones. */
export const ULID_LENGTH = TIME_LEN + RANDOM_LEN;

function encodeTime(now: number): string {
  if (!Number.isFinite(now) || now < 0 || now > 0xffffffffffff) {
    throw new RangeError(`timestamp out of ULID range: ${now}`);
  }
  let remaining = Math.floor(now);
  let out = '';
  for (let i = 0; i < TIME_LEN; i += 1) {
    const mod = remaining % 32;
    out = ENCODING[mod] + out;
    remaining = (remaining - mod) / 32;
  }
  return out;
}

function randomSymbols(): number[] {
  const bytes = randomBytes(RANDOM_LEN);
  return Array.from({ length: RANDOM_LEN }, (_, i) => (bytes[i] ?? 0) % 32);
}

/**
 * The last ULID issued, so the next one within the same millisecond can be made to sort
 * after it. Without this, two rows written in the same millisecond sort in random order —
 * which shows up as the three pages of a scanned lab report appearing shuffled, and as a
 * flaky test that passes until a machine gets fast enough to write twice in one tick.
 */
let lastTime = -1;
let lastSymbols: number[] = [];

/** Increments the random part in place, base-32, returning false on overflow. */
function incrementSymbols(symbols: number[]): boolean {
  for (let i = symbols.length - 1; i >= 0; i -= 1) {
    if ((symbols[i] ?? 0) < 31) {
      symbols[i] = (symbols[i] ?? 0) + 1;
      return true;
    }
    symbols[i] = 0;
  }
  return false;
}

/**
 * ADR-02 §2: ULID primary keys, generated client-side — sortable by creation time,
 * globally unique, no coordination with a server.
 *
 * **Monotonic within a millisecond**, following the ULID spec's monotonic factory: a
 * second id issued in the same millisecond increments the random component instead of
 * redrawing it, so ids issued in a loop sort in the order they were issued. Every list in
 * the app breaks a timestamp tie with the id, so this is what makes "oldest first" mean
 * what it says — it is the difference between the three pages of a scanned lab report
 * appearing in order and appearing shuffled.
 *
 * Unlike the spec's factory this never *clamps* a timestamp it was given. A caller that
 * passes an explicit time — a restore replaying a row, a test with a fixed clock — gets
 * that time encoded, even if it is in the past. Monotonicity is a tie-break, not a clock.
 */
export function ulid(now: number = Date.now()): string {
  const time = Math.floor(now);
  const encodedTime = encodeTime(time); // Validates the range before any state changes.

  if (time === lastTime && lastSymbols.length === RANDOM_LEN) {
    const symbols = [...lastSymbols];
    lastSymbols = incrementSymbols(symbols) ? symbols : randomSymbols();
  } else {
    lastSymbols = randomSymbols();
  }
  lastTime = time;
  return encodedTime + lastSymbols.map((value) => ENCODING[value]).join('');
}

/** Resets the monotonic state. Tests only — nothing in the app needs it. */
export function resetUlidMonotonicity(): void {
  lastTime = -1;
  lastSymbols = [];
}

/** True for a well-formed ULID string (length and alphabet only). */
export function isUlid(value: string): boolean {
  if (value.length !== ULID_LENGTH) return false;
  for (const char of value) {
    if (!ENCODING.includes(char)) return false;
  }
  return true;
}

/** The millisecond timestamp encoded in a ULID. Throws when the string is not a ULID. */
export function ulidTime(value: string): number {
  if (!isUlid(value)) throw new TypeError(`not a ULID: ${value}`);
  let time = 0;
  for (const char of value.slice(0, TIME_LEN)) {
    time = time * 32 + ENCODING.indexOf(char);
  }
  return time;
}
