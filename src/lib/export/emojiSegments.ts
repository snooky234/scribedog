// Splits a string into emoji and non-emoji segments. The PDF exporter needs
// this because pdfmake/pdfkit can only embed a glyph-only emoji face (Noto
// Emoji): emoji runs have to be tagged with that font while surrounding text
// keeps the body font. DOCX/ODT don't need it — their viewers substitute a
// system emoji font automatically — so this lives only for the PDF path.

export type EmojiSegment = {
  text: string;
  emoji: boolean;
};

// Matches emoji-presentation codepoints: the Extended_Pictographic set plus
// regional indicators, joined by ZWJ / variation selectors / skin-tone
// modifiers so multi-codepoint emoji (flags, families, tones) stay in one
// segment. Deliberately excludes plain-text dingbats that Roboto covers
// (e.g. → U+2192) so they aren't forced through the emoji face and lost.
const EMOJI_PATTERN =
  /(?:\p{Regional_Indicator}\p{Regional_Indicator}|\p{Extended_Pictographic}(?:️|︎)?(?:[\u{1F3FB}-\u{1F3FF}])?(?:‍\p{Extended_Pictographic}(?:️|︎)?(?:[\u{1F3FB}-\u{1F3FF}])?)*)/gu;

export function splitEmojiSegments(text: string): EmojiSegment[] {
  if (!text) {
    return [];
  }

  const segments: EmojiSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(EMOJI_PATTERN)) {
    const start = match.index ?? 0;

    // A bare variation selector or keycap digit without a pictographic base
    // isn't an emoji we can render — skip zero-width-only matches.
    if (!match[0]) {
      continue;
    }

    if (start > lastIndex) {
      segments.push({ text: text.slice(lastIndex, start), emoji: false });
    }

    segments.push({ text: match[0], emoji: true });
    lastIndex = start + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), emoji: false });
  }

  return segments;
}
