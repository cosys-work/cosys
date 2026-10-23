import { bytesToHex, fromBase64, randomBytes, sha256, toBase64, utf8 } from './deps.ts';

/**
 * Pairing: the string two people exchange, and the code they read to each other (ADR-18 §4).
 *
 * ADR-16 §6's design stands — **the directory is never authoritative about a key**
 * (`directory.ts`), so a confirmation step is the only thing between a substituted record and a
 * silent impostor. §4 changes three things about it, and two of them are in this file.
 *
 * ## The long code is the specified path and the QR is an accelerator
 *
 * ADR-16 §6 wrote the QR as primary with the code as a second factor. In the field the two
 * devices are frequently not in one room — a daughter in Pokhara, a mother in Kathmandu — and
 * the string will be pasted into Viber or WhatsApp. That path is specified rather than
 * tolerated, so the string is built to survive a chat app: one line, no spaces, a URL scheme a
 * message client will make tappable, and a checksum so that a truncated paste fails loudly
 * instead of producing a key that is merely wrong.
 *
 * ## The confirmation is four emoji and six digits, from both keys and never from a name
 *
 * A name is attacker-supplied. A confirmation screen that reads out a name when one is set has
 * replaced a security property with a comfort, and an impostor types the mother's name. Names
 * are shown *beside* the derived code as context, never instead of it (§4.2), and nothing in
 * this file takes a name as input to the derivation.
 *
 * **Emoji rather than words** because the code has to work at variable literacy and in two
 * languages, and because a word list would put a 256-entry Nepali vocabulary on the 1.0
 * critical path — which ADR-16 §Consequences requires be settled by pilot users rather than
 * translated.
 *
 * **Digits alongside, for one specific reason:** emoji glyphs differ across Android versions
 * and fonts, two phones can render the same codepoint differently, and a pair seeing a *false*
 * mismatch is how people learn to proceed anyway. The digits are the arbiter when the pictures
 * disagree — and the emoji set ships as bundled vector assets rather than from the system font,
 * which reduces that case rather than relying on the digits to catch it.
 *
 * ## Between two people, the code commits before it reveals (2026-10-16)
 *
 * The code above is a hash of the two identity keys and nothing else, and that is not enough
 * when the chat carrying the strings is the attacker's. The review of PR #121 found it: someone
 * who can swap the key in each string chooses both keys, so they can generate keypairs offline
 * until the two codes the victims see agree. Six digits is about twenty bits, and knowing both
 * victims' keys in advance turns that into a birthday search of about a thousand keypairs.
 *
 * So two people pair in three messages (founder, 2026-10-16: *"Third paste"*; ADR-18 §4.5):
 *
 * 1. **The invite** carries the inviter's key and a commitment to a fresh random nonce.
 * 2. **The reply** carries the joiner's key and the joiner's own nonce.
 * 3. **The reveal** carries the inviter's nonce, sent only after the reply has arrived.
 *
 * The code is derived from both keys **and both nonces** (`pairingConfirmation`). Whoever sits
 * in the middle has to commit to a nonce towards the joiner before seeing the joiner's, and has
 * to send the inviter a nonce before seeing the inviter's, so neither of the two codes can be
 * steered towards the other. One attempt matches by chance one time in a million on the digits,
 * and an attempt is a pairing two people abandon, not a keypair on a laptop.
 *
 * `confirmationCode` stays for the clinic route (ADR-20 §3), where the clinic's key reaches the
 * phone inside a listing the operator signed, so the chat is not the channel the key arrives by.
 */

/** The scheme a chat app will linkify, and a QR can carry. One line, no spaces. */
export const PAIRING_URI_PREFIX = 'tapp://pair/1/';

const PAIRING_VERSION = 1;
/** The three messages of a pairing between two people, by their first byte (see above). */
const INVITE_VERSION = 2;
const REPLY_VERSION = 3;
const REVEAL_VERSION = 4;
const CHECKSUM_BYTES = 4;
/** A pairing nonce. Sixteen bytes, so a commitment to one cannot be opened two ways. */
export const PAIRING_NONCE_BYTES = 16;
/** The commitment's length: a truncated digest, and still 128 bits nobody can collide. */
const COMMITMENT_BYTES = 16;
/** The longest name a pairing message may carry, in UTF-8 bytes after trimming. */
export const MAX_PAIRING_NAME_BYTES = 48;

const CONFIRMATION_CONTEXT = utf8('tapp-peer/pair-confirm/v1');
const COMMITMENT_CONTEXT = utf8('tapp-peer/pair-commit/v2');
const CONFIRMATION_V2_CONTEXT = utf8('tapp-peer/pair-confirm/v2');

/**
 * The sixty-four pictures, as ids rather than codepoints.
 *
 * **The id is the contract and the drawing is an asset** (§4 of ADR-18, "The peer install" —
 * the section on pairing and the confirmation code). Keeping the id as the contract is what
 * lets the drawing change without changing the protocol, and it is why this list is names.
 *
 * Sixty-four, so an index is six bits of a byte with no modulo bias, and four of them carry
 * twenty-four bits.
 *
 * ## How they are drawn, amended 2026-09-22 (founder call)
 *
 * This comment used to say the set ships as **bundled vector assets**, on the grounds that two
 * Android versions draw the same emoji codepoint differently and could produce a false
 * mismatch — and that a renderer which cannot find an asset must fail rather than fall back to
 * the system font. The drawings were never commissioned, so the confirmation screen could not
 * be built at all, which is a worse outcome than a cosmetic difference.
 *
 * **So the interim is system emoji, and the id stays the contract.** The app maps each id to a
 * codepoint in `src/features/pairing/glyphs.ts`; swapping to commissioned drawings later
 * changes that one map and nothing here. The original concern is real but small for this list:
 * every entry is a concrete everyday noun, and a Samsung apple and a Pixel apple are both
 * plainly an apple. What carries the security is the **six digits** beside the pictures; the
 * pictures carry the *usability*, which is that two people can confirm a code aloud without
 * sharing a written language.
 *
 * ## Seven names changed with it, and this is the moment it is free
 *
 * `bucket`, `feather`, `kettle`, `ladder`, `window` (Emoji 13.0) and `nest`, `wheel` (14.0)
 * have no codepoint an Android 10 or 11 handset can draw — they render as a tofu box, which is
 * worse than either problem above. They are replaced by `anchor`, `basket`, `broom`, `camera`,
 * `shell`, `train`, `turtle`, all Emoji 12.0 or earlier.
 *
 * **Changing this list changes which picture a given pair of keys produces**, so it is a
 * breaking change to pairing — and pairing has not shipped, so it costs nothing today and
 * could not be done at all after the first two people have paired.
 *
 * ## What is not in the list, and why
 *
 * Nothing clinical — no pill, no syringe, no drop of blood, no heart: this screen appears at
 * the moment somebody decides to share a medical record, and a picture that looks like a
 * symbol of the thing being shared invites a reading that is not there (ADR-09 "Look and
 * feel", §B — the stigma vocabulary and illustration rules). Nothing religious, national or
 * political — which is also why `flag` is the chequered one. No faces or hand gestures, whose
 * meanings are not stable across cultures. No two items hard to tell apart at the size a
 * confirmation screen draws them — one boat, one bird, one cat. And **no two names that sound
 * alike when read down a phone line**, which is how `corn` lost to `turtle` beside `carrot`.
 */
export const CONFIRMATION_EMOJI = [
  'anchor',
  'apple',
  'balloon',
  'banana',
  'basket',
  'bell',
  'bicycle',
  'bird',
  'boat',
  'book',
  'bread',
  'bridge',
  'broom',
  'butterfly',
  'cactus',
  'camera',
  'candle',
  'carrot',
  'cat',
  'chair',
  'clock',
  'cloud',
  'cup',
  'door',
  'drum',
  'egg',
  'elephant',
  'envelope',
  'fish',
  'flag',
  'flower',
  'football',
  'fork',
  'glasses',
  'grapes',
  'guitar',
  'hammer',
  'hat',
  'house',
  'key',
  'kite',
  'lamp',
  'leaf',
  'lemon',
  'lock',
  'moon',
  'mountain',
  'mushroom',
  'onion',
  'pencil',
  'rainbow',
  'ring',
  'scissors',
  'shell',
  'shoe',
  'snowflake',
  'spoon',
  'star',
  'sun',
  'train',
  'tree',
  'turtle',
  'umbrella',
  'watch',
] as const;

/** One picture of a confirmation code, by its name in `CONFIRMATION_EMOJI`. */
export type ConfirmationEmoji = (typeof CONFIRMATION_EMOJI)[number];

/** How many pictures a pair compares. Four, with the digits, is §4's confirmation. */
export const CONFIRMATION_EMOJI_COUNT = 4;

/** How many digits sit beside them. Six, read aloud in two groups of three. */
export const CONFIRMATION_DIGITS = 6;

/** A pairing invite in its first format: the inviter's key and the name it gives itself. */
export interface PairingInvite {
  /** The inviting device's Ed25519 identity key, lowercase hex. */
  readonly peer: string;
  /**
   * What the inviter calls themselves. Self-asserted, shown as context, and **not** an input
   * to the confirmation code (§4.2, §4.3).
   */
  readonly name: string;
}

/**
 * The string that is scanned or pasted.
 *
 * Both paths land on the same confirmation screen, which is where the security is in either
 * case — so there is one format, and the QR is a way of typing it.
 */
export function encodePairingInvite(invite: PairingInvite): string {
  if (!/^[0-9a-f]{64}$/.test(invite.peer)) {
    throw new TypeError('a pairing invite carries a 32-byte identity key as lowercase hex');
  }
  const name = utf8(invite.name.trim());
  if (name.length > MAX_PAIRING_NAME_BYTES) {
    throw new RangeError(`a pairing name is at most ${MAX_PAIRING_NAME_BYTES} bytes`);
  }

  const key = hexToBytes(invite.peer);
  const body = new Uint8Array(1 + key.length + 1 + name.length);
  body[0] = PAIRING_VERSION;
  body.set(key, 1);
  body[1 + key.length] = name.length;
  body.set(name, 2 + key.length);

  const payload = new Uint8Array(body.length + CHECKSUM_BYTES);
  payload.set(body, 0);
  payload.set(sha256(body).subarray(0, CHECKSUM_BYTES), body.length);
  return PAIRING_URI_PREFIX + base64Url(payload);
}

/**
 * Reads a string somebody pasted.
 *
 * **Null rather than a throw, and null rather than a guess.** This is untrusted input that
 * arrived through a chat app, so it may be truncated by a line wrap, decorated by an
 * auto-linker, or simply the wrong thing entirely — and the caller's job is to say *that code
 * did not work, check it and try again*, which is one branch. The checksum is what turns a
 * paste that lost its last characters into a refusal instead of a wrong key: without it a
 * truncated string decodes to a shorter key and pairs the patient with nobody, which is a
 * failure they would discover days later as an empty screen.
 *
 * Whitespace is stripped first, because a string pasted out of a message often arrives with a
 * newline in the middle of it and a person who did nothing wrong should not be told they did.
 */
export function decodePairingInvite(input: string): PairingInvite | null {
  const message = decodePairingMessage(input);
  if (message === null || message.kind === 'reveal') return null;
  return { peer: message.peer, name: message.name };
}

/**
 * One of the messages two people exchange, or the single code a phone shows the clinic's desk.
 *
 * - `identity` is the first format: a key and a name. The clinic route still shows it, and the
 *   desk reads any of the first three kinds for the key and the name (`decodePairingInvite`).
 * - `invite`, `reply` and `reveal` are the three steps of a pairing between two people, above.
 *
 * The nonce and the commitment are lowercase hex, like the key.
 */
export type PairingMessage =
  | { readonly kind: 'identity'; readonly peer: string; readonly name: string }
  | {
      readonly kind: 'invite';
      readonly peer: string;
      readonly name: string;
      readonly commitment: string;
    }
  | { readonly kind: 'reply'; readonly peer: string; readonly name: string; readonly nonce: string }
  | { readonly kind: 'reveal'; readonly nonce: string };

const VERSION_OF = {
  identity: PAIRING_VERSION,
  invite: INVITE_VERSION,
  reply: REPLY_VERSION,
  reveal: REVEAL_VERSION,
} as const;

/**
 * Encodes a pairing message as `PAIRING_URI_PREFIX`, base64url, with a 4-byte checksum. Throws
 * `TypeError` for a key, nonce or commitment that is not lowercase hex of its length, and
 * `RangeError` for a name longer than `MAX_PAIRING_NAME_BYTES`.
 */
export function encodePairingMessage(message: PairingMessage): string {
  const parts: Uint8Array[] = [Uint8Array.of(VERSION_OF[message.kind])];
  if (message.kind === 'reveal') {
    parts.push(fixedHex(message.nonce, PAIRING_NONCE_BYTES, 'a pairing nonce'));
  } else {
    parts.push(fixedHex(message.peer, 32, 'an identity key'));
    if (message.kind === 'invite')
      parts.push(fixedHex(message.commitment, COMMITMENT_BYTES, 'a commitment'));
    if (message.kind === 'reply')
      parts.push(fixedHex(message.nonce, PAIRING_NONCE_BYTES, 'a pairing nonce'));
    const name = utf8(message.name.trim());
    if (name.length > MAX_PAIRING_NAME_BYTES) {
      throw new RangeError(`a pairing name is at most ${MAX_PAIRING_NAME_BYTES} bytes`);
    }
    parts.push(Uint8Array.of(name.length), name);
  }
  const body = concat(parts);
  return PAIRING_URI_PREFIX + base64Url(concat([body, sha256(body).subarray(0, CHECKSUM_BYTES)]));
}

/**
 * Reads a string somebody pasted or scanned, of any kind, or null.
 *
 * Null rather than a throw and rather than a guess, for the reasons `decodePairingInvite` gives:
 * a paste may be truncated, decorated or the wrong thing, and the caller says *that code did not
 * work* in one branch. Whitespace is stripped first, because a string pasted out of a message
 * often arrives with a newline in the middle of it.
 */
export function decodePairingMessage(input: string): PairingMessage | null {
  const trimmed = input.replace(/\s+/g, '');
  // The prefix is matched without regard to case: a keyboard that capitalises the first
  // letter of a field (One UI's did, to Maestro's and adb's typing alike, 2026-10-05) or a
  // messaging app that capitalises a sentence turns `tapp://` into `Tapp://`, and the person
  // did nothing wrong. The payload after it is base64url and stays exactly as typed.
  const withoutPrefix =
    trimmed.slice(0, PAIRING_URI_PREFIX.length).toLowerCase() === PAIRING_URI_PREFIX
      ? trimmed.slice(PAIRING_URI_PREFIX.length)
      : trimmed;
  if (withoutPrefix.length === 0) return null;

  let payload: Uint8Array;
  try {
    payload = fromBase64Url(withoutPrefix);
  } catch {
    return null;
  }
  if (payload.length < 1 + CHECKSUM_BYTES) return null;
  const body = payload.subarray(0, payload.length - CHECKSUM_BYTES);
  const checksum = payload.subarray(payload.length - CHECKSUM_BYTES);
  const expected = sha256(body).subarray(0, CHECKSUM_BYTES);
  for (let index = 0; index < CHECKSUM_BYTES; index += 1) {
    if (checksum[index] !== expected[index]) return null;
  }

  const version = body[0];
  if (version === REVEAL_VERSION) {
    if (body.length !== 1 + PAIRING_NONCE_BYTES) return null;
    return { kind: 'reveal', nonce: bytesToHex(body.subarray(1)) };
  }
  const extra =
    version === PAIRING_VERSION
      ? 0
      : version === INVITE_VERSION
        ? COMMITMENT_BYTES
        : version === REPLY_VERSION
          ? PAIRING_NONCE_BYTES
          : -1;
  if (extra < 0) return null;
  const head = 1 + 32 + extra;
  if (body.length < head + 1) return null;
  const peer = bytesToHex(body.subarray(1, 33));
  const field = bytesToHex(body.subarray(33, head));
  const nameLength = body[head]!;
  const nameBytes = body.subarray(head + 1);
  if (nameBytes.length !== nameLength || nameLength > MAX_PAIRING_NAME_BYTES) return null;
  const name = new TextDecoder().decode(nameBytes);

  if (version === INVITE_VERSION) return { kind: 'invite', peer, name, commitment: field };
  if (version === REPLY_VERSION) return { kind: 'reply', peer, name, nonce: field };
  return { kind: 'identity', peer, name };
}

/** A fresh pairing nonce, from the app's CSPRNG (`deps.ts`), as hex. One per pairing, never reused. */
export function createPairingNonce(): string {
  return bytesToHex(randomBytes(PAIRING_NONCE_BYTES));
}

/** What the invite carries: a commitment to the inviter's nonce, bound to the inviter's key. */
export function pairingCommitment(inviter: Uint8Array | string, nonce: string): string {
  const material = concat([
    COMMITMENT_CONTEXT,
    asKey(inviter),
    fixedHex(nonce, PAIRING_NONCE_BYTES, 'a pairing nonce'),
  ]);
  return bytesToHex(sha256(material).subarray(0, COMMITMENT_BYTES));
}

/** Whether a revealed nonce opens the commitment an invite carried. The joiner's check. */
export function opensCommitment(
  inviter: Uint8Array | string,
  commitment: string,
  nonce: string,
): boolean {
  if (!/^[0-9a-f]{32}$/.test(nonce) || !/^[0-9a-f]{32}$/.test(commitment)) return false;
  return pairingCommitment(inviter, nonce) === commitment;
}

/**
 * The code two people compare, from both keys and both nonces (see the top of this file).
 *
 * **Ordered by role rather than sorted.** Both phones know which of them invited, because the
 * inviter is the one whose string carried a commitment, so the derivation can name the roles and
 * needs no sorting to agree. The inviter computes this once the reply arrives; the joiner once
 * the reveal does, and only after `opensCommitment` said yes.
 */
export function pairingConfirmation(input: {
  readonly inviter: Uint8Array | string;
  readonly joiner: Uint8Array | string;
  readonly inviterNonce: string;
  readonly joinerNonce: string;
}): ConfirmationCode {
  const inviter = asKey(input.inviter);
  const joiner = asKey(input.joiner);
  if (bytesToHex(inviter) === bytesToHex(joiner)) {
    throw new RangeError('a pairing confirmation needs two different identities');
  }
  return codeFrom(
    sha256(
      concat([
        CONFIRMATION_V2_CONTEXT,
        inviter,
        joiner,
        fixedHex(input.inviterNonce, PAIRING_NONCE_BYTES, 'a pairing nonce'),
        fixedHex(input.joinerNonce, PAIRING_NONCE_BYTES, 'a pairing nonce'),
      ]),
    ),
  );
}

/** What two phones show each other to confirm a pairing: pictures and digits. */
export interface ConfirmationCode {
  /** `CONFIRMATION_EMOJI_COUNT` pictures, in order. */
  readonly emoji: readonly ConfirmationEmoji[];
  /** Six digits, zero-padded, as a string — `'048213'` is not 48 213. */
  readonly digits: string;
}

/**
 * The code both phones show, from both identity keys and from nothing else.
 *
 * **The clinic route's code since 2026-10-16**, where the clinic's key arrives signed by
 * the operator. Two people pair through `pairingConfirmation`, which adds the two nonces; a code
 * from the keys alone can be ground offline by whoever carries the strings (top of this file).
 *
 * **Symmetric by sorting.** Each side knows the pair of keys but not which of them is "first":
 * the inviter and the joiner run the same function and must get the same answer, so the two
 * keys are ordered by their bytes before hashing rather than by who dialled. A derivation that
 * depended on the role would show two different codes to two people looking at each other, and
 * they would conclude the pairing had failed.
 *
 * **Stable across attempts**, because the inputs are long-term keys. Re-pairing the same two
 * devices shows the same pictures, which is a small, real benefit: a pair who got interrupted
 * do not have to wonder whether the code changing means something.
 *
 * It refuses two identical keys. A device pairing with itself is a bug rather than a
 * relationship, and a confirmation screen is the wrong place to find out.
 */
export function confirmationCode(a: Uint8Array | string, b: Uint8Array | string): ConfirmationCode {
  const left = asKey(a);
  const right = asKey(b);
  if (bytesToHex(left) === bytesToHex(right)) {
    throw new RangeError('a pairing confirmation needs two different identities');
  }

  const [first, second] = bytesToHex(left) < bytesToHex(right) ? [left, right] : [right, left];
  const material = new Uint8Array(CONFIRMATION_CONTEXT.length + first.length + second.length);
  material.set(CONFIRMATION_CONTEXT, 0);
  material.set(first, CONFIRMATION_CONTEXT.length);
  material.set(second, CONFIRMATION_CONTEXT.length + first.length);
  return codeFrom(sha256(material));
}

function codeFrom(digest: Uint8Array): ConfirmationCode {
  // 64 divides 256, so a byte modulo the list length is unbiased — no rejection sampling and
  // no arithmetic anybody has to check.
  const emoji = Array.from({ length: CONFIRMATION_EMOJI_COUNT }, (_unused, index) => {
    return CONFIRMATION_EMOJI[digest[index]! % CONFIRMATION_EMOJI.length]!;
  });

  // Six bytes, read as a 48-bit integer: inside JavaScript's exact-integer range, and the
  // modulo bias against 10^6 is about one part in 2^28, which no pair will ever meet.
  let value = 0;
  for (let index = CONFIRMATION_EMOJI_COUNT; index < CONFIRMATION_EMOJI_COUNT + 6; index += 1) {
    value = value * 256 + digest[index]!;
  }
  const digits = String(value % 10 ** CONFIRMATION_DIGITS).padStart(CONFIRMATION_DIGITS, '0');

  return { emoji, digits };
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function fixedHex(value: string, length: number, what: string): Uint8Array {
  if (!new RegExp(`^[0-9a-f]{${length * 2}}$`).test(value)) {
    throw new TypeError(`${what} is ${length} bytes as lowercase hex`);
  }
  return hexToBytes(value);
}

function asKey(value: Uint8Array | string): Uint8Array {
  if (typeof value !== 'string') {
    if (value.length !== 32) throw new TypeError('an identity key is 32 bytes');
    return value;
  }
  if (!/^[0-9a-f]{64}$/.test(value)) throw new TypeError('an identity key is 64 lowercase hex');
  return hexToBytes(value);
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

/** base64url: `+/` become `-_` and the padding goes, so the string survives a URL and a QR. */
function base64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  return fromBase64(padded + '='.repeat((4 - (padded.length % 4)) % 4));
}
