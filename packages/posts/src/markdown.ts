/**
 * What a reader needs from a post's Markdown without an editor (founder, 2026-10-22): which of
 * its files the words show, and the words with the markup taken out.
 *
 * **A photograph in the words names one of the post's own files**: `![](attachment:<id>)`, the
 * id of an attachment of this post or of an earlier version of it. A reader resolves the id among
 * that post's files and nowhere else, so words naming any other file in the record show nothing:
 * the gate's rule that a post carries its own attachments only (ADR-24 §3) holds for the words as
 * well as for the rows. Any other image address is not shown at all, which is also what keeps a
 * reader from fetching one (AGENTS.md rule 2).
 *
 * @module
 */

/** The scheme of an image address that names one of the post's own files. */
export const ATTACHMENT_SCHEME = 'attachment:';

/** An attachment id as `@cosys/crypto/ulid` writes one. */
const ID = '[0-9A-HJKMNP-TV-Z]{26}';
const PHOTO = new RegExp(`!\\[[^\\]]*\\]\\(${ATTACHMENT_SCHEME}(${ID})(?:\\s+"[^"]*")?\\)`, 'g');

/** The markup for a photograph of this post, as the editor writes it. */
export function photoMarkdown(id: string): string {
  return `![](${ATTACHMENT_SCHEME}${id})`;
}

/** The attachment id an image address names, or `null` for any other address. */
export function attachmentIdOf(src: string): string | null {
  const match = new RegExp(`^${ATTACHMENT_SCHEME}(${ID})$`).exec(src);
  return match === null ? null : match[1]!;
}

/** The ids of the files the words show, in order, each once. */
export function attachmentRefsOf(markdown: string): readonly string[] {
  return [...new Set([...markdown.matchAll(PHOTO)].map((match) => match[1]!))];
}

/**
 * The words without their markup, for a card's excerpt and for what a screen reader says about
 * a card. Not a Markdown parser: it removes what GitHub-flavoured Markdown adds around the words
 * line by line, and leaves anything it does not recognise as typed.
 */
export function plainTextOf(markdown: string): string {
  const lines = markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .split('\n')
    .filter((line) => !/^\s*(```|~~~)/.test(line))
    .filter((line) => !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line))
    .filter((line) => !/^\s*([-*_])(\s*\1){2,}\s*$/.test(line))
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, '')
        .replace(/^\s*(>\s?)+/, '')
        .replace(/^\s*([-*+]|\d+[.)])\s+/, '')
        .replace(/^\[[ xX]\]\s+/, '')
        .replace(/^\s*\|(.*)\|\s*$/, '$1')
        .replace(/\s*\|\s*/g, '  ')
        .replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
        .replace(/(^|[^\w*])[*_]([^*_\s][^*_]*?)[*_](?=$|[^\w*])/g, '$1$2')
        .replace(/`([^`]*)`/g, '$1')
        .trim(),
    );
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
