/**
 * The file formats a post may carry, and the check that tells them apart by their bytes.
 *
 * @module
 */
/**
 * What a post may carry (founder, 2026-10-22, ADR-24 §4 as amended): **any known and safe file
 * format**, decided by the bytes and not by the name or the type a sender declares. Safe means a
 * format a renderer displays without running anything in it: images, audio, video, PDF and plain
 * text. Nothing executable, no HTML, no SVG (it can carry script), no archive (it can carry
 * anything). A format outside this list is refused when the post is written.
 *
 * Whether the reader's app can show a format is a different question, the renderer's: a format
 * here with no renderer installed opens to a closed state that says so (TApp's `PostScreen`).
 */
export const POST_MEDIA_TYPES = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'image/heic': 'image',
  'audio/mpeg': 'audio',
  'audio/mp4': 'audio',
  'audio/ogg': 'audio',
  'video/mp4': 'video',
  'video/webm': 'video',
  'application/pdf': 'document',
  'text/plain': 'text',
} as const;

/** A media type a post may carry. */
export type PostMediaType = keyof typeof POST_MEDIA_TYPES;
/** The class of a format a post may carry: image, audio, video, document or text. */
export type PostContentClass = (typeof POST_MEDIA_TYPES)[PostMediaType];

const starts = (bytes: Uint8Array, prefix: readonly number[], offset = 0) =>
  bytes.length >= offset + prefix.length &&
  prefix.every((byte, index) => bytes[offset + index] === byte);
const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

/** The media type the bytes are, among the ones a post may carry, or `null`. */
export function sniffMediaType(bytes: Uint8Array): PostMediaType | null {
  if (starts(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts(bytes, ascii('RIFF')) && starts(bytes, ascii('WEBP'), 8)) return 'image/webp';
  if (starts(bytes, ascii('GIF87a')) || starts(bytes, ascii('GIF89a'))) return 'image/gif';
  if (starts(bytes, ascii('ftyp'), 4)) {
    const brand = String.fromCharCode(...bytes.slice(8, 12));
    if (['heic', 'heix', 'mif1', 'msf1'].includes(brand)) return 'image/heic';
    if (['M4A ', 'M4B '].includes(brand)) return 'audio/mp4';
    return 'video/mp4';
  }
  if (starts(bytes, ascii('ID3')) || starts(bytes, [0xff, 0xfb]) || starts(bytes, [0xff, 0xf3]))
    return 'audio/mpeg';
  if (starts(bytes, ascii('OggS'))) return 'audio/ogg';
  if (starts(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm';
  if (starts(bytes, ascii('%PDF-'))) return 'application/pdf';
  return isPlainText(bytes) ? 'text/plain' : null;
}

/** UTF-8 with no control characters but tab and line ends, and nothing that opens as markup. */
function isPlainText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return false;
  return !/^\s*</.test(text);
}

/** The content class a file is, when a post may carry it; `null` refuses it. */
export function postContentOf(
  bytes: Uint8Array,
): { readonly mediaType: PostMediaType; readonly content: PostContentClass } | null {
  const mediaType = sniffMediaType(bytes);
  return mediaType === null ? null : { mediaType, content: POST_MEDIA_TYPES[mediaType] };
}
