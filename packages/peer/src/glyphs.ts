import { CONFIRMATION_EMOJI, type ConfirmationEmoji } from './pairing.ts';

/**
 * What each of the sixty-four confirmation ids is drawn as.
 *
 * *Moved here from TApp's `src/features/pairing/glyphs.ts`, 2026-10-02 (PLAN M13-D3):* the
 * clinic's desk shows the same four pictures a patient's phone shows, and one map is what makes
 * "the same" true. It is still the asset half; only its address changed.
 *
 * `packages/peer` deliberately names the pictures rather than choosing codepoints — *"the id
 * is the contract and the drawing is an asset"* (ADR-18 "The peer install", §4, pairing and the
 * confirmation code). This is the asset half, and it is the **interim** one: a founder call of
 * 2026-09-22 replaced the commissioned vector drawings with system emoji, because the drawings
 * were never commissioned and a screen that cannot be built is worse than one drawn in a font
 * that varies by vendor.
 *
 * **Swapping back is this file and nothing else.** When the drawings exist, this map becomes
 * `id → <Illustration>` and the protocol, the code derivation and every test above it are
 * untouched. That is the whole reason the package kept the ids.
 *
 * ## The floor, and why there is one
 *
 * **Emoji 12.0, which is Android 10.** Anything newer renders as a tofu box on a pilot-era
 * handset, and a box is worse than a vendor difference: two people comparing pictures can talk
 * about a Samsung apple and a Pixel apple, and cannot talk about □. Seven of the original ids
 * (`bucket`, `feather`, `kettle`, `ladder`, `window` at Emoji 13.0; `nest`, `wheel` at 14.0)
 * had no codepoint under that floor and were replaced in the package before pairing shipped —
 * which is the only moment that was free, since changing the list changes which picture a given
 * pair of keys produces.
 *
 * ## What this is and is not protecting
 *
 * The **six digits** beside the pictures carry the security. The pictures carry the usability:
 * two people confirming a code aloud, one of whom may not read the other's script. That is why
 * a vendor drawing the apple differently is a cosmetic risk rather than a security one — and
 * why every entry is a concrete everyday noun, with no two that sound alike down a phone line.
 */
export const CONFIRMATION_GLYPH: { readonly [K in ConfirmationEmoji]: string } = {
  anchor: '⚓',
  apple: '🍎',
  balloon: '🎈',
  banana: '🍌',
  basket: '🧺',
  bell: '🔔',
  bicycle: '🚲',
  bird: '🐦',
  boat: '⛵',
  book: '📖',
  bread: '🍞',
  bridge: '🌉',
  broom: '🧹',
  butterfly: '🦋',
  cactus: '🌵',
  camera: '📷',
  candle: '🕯️',
  carrot: '🥕',
  cat: '🐈',
  chair: '🪑',
  clock: '⏰',
  cloud: '☁️',
  cup: '🍵',
  door: '🚪',
  drum: '🥁',
  egg: '🥚',
  elephant: '🐘',
  envelope: '✉️',
  fish: '🐟',
  // The chequered flag, never a national one: ADR-09 §B keeps nationality out of a screen
  // that appears when somebody shares a medical record.
  flag: '🏁',
  flower: '🌸',
  football: '⚽',
  fork: '🍴',
  glasses: '👓',
  grapes: '🍇',
  guitar: '🎸',
  hammer: '🔨',
  hat: '🎩',
  house: '🏠',
  key: '🔑',
  kite: '🪁',
  lamp: '💡',
  leaf: '🍃',
  lemon: '🍋',
  lock: '🔒',
  moon: '🌙',
  mountain: '⛰️',
  mushroom: '🍄',
  onion: '🧅',
  pencil: '✏️',
  rainbow: '🌈',
  ring: '💍',
  scissors: '✂️',
  shell: '🐚',
  shoe: '👟',
  snowflake: '❄️',
  spoon: '🥄',
  star: '⭐',
  sun: '☀️',
  train: '🚆',
  tree: '🌳',
  turtle: '🐢',
  umbrella: '☂️',
  watch: '⌚',
};

/**
 * The glyph for an id, and it throws rather than falling back.
 *
 * The package's original note is right about this even though the assets changed: *"a renderer
 * that cannot find an asset for an id must fail rather than fall back to the system font,
 * because a silent fallback is exactly the case the bundling exists to prevent."* A blank or a
 * placeholder on a confirmation screen is two people agreeing about nothing. The map is total
 * over `ConfirmationEmoji`, so this can only throw if the package's list grew without this file
 * following — which is a type error first and this second.
 */
export function glyphFor(id: ConfirmationEmoji): string {
  const glyph = CONFIRMATION_GLYPH[id];
  if (glyph === undefined) throw new Error(`no confirmation glyph for "${id}"`);
  return glyph;
}

/** Every id has a glyph and no two ids share one. Asserted in `glyphs.test.ts`. */
export const CONFIRMATION_GLYPH_IDS = CONFIRMATION_EMOJI;
