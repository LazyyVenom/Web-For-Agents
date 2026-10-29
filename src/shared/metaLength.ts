/** Recommended title and meta description lengths, in characters as measured by metaLength. */
export const TITLE_MAX_CHARS = 60;
export const DESCRIPTION_MIN_CHARS = 50;
export const DESCRIPTION_MAX_CHARS = 160;

/** East Asian wide characters: Han, Hiragana, Katakana, Hangul, CJK punctuation and fullwidth forms. */
const WIDE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}　-〿！-｠￠-￦]/u;
/** Halfwidth Katakana and Hangul are narrow although their scripts are not. */
const HALFWIDTH = /[｡-ￜ]/u;

/**
 * The length search engines budget for a title or description: wide characters (see WIDE) count as 2,
 * since a snippet fits about half as many of them; every other code point counts as 1.
 */
export function metaLength(text: string): number {
  let n = 0;
  for (const c of text) n += WIDE.test(c) && !HALFWIDTH.test(c) ? 2 : 1;
  return n;
}

export interface MetaLengthPage {
  route: string;
  title?: string;
  description?: string;
}

/** Grouped build-time warnings for routes with a long title or a too short or too long description. */
export function metaLengthWarnings(pages: MetaLengthPage[]): string[] {
  const longTitle: string[] = [];
  const shortDesc: string[] = [];
  const longDesc: string[] = [];
  for (const { route, title, description } of pages) {
    const t = title ? metaLength(title) : 0;
    if (t > TITLE_MAX_CHARS) longTitle.push(`${route} (${t})`);
    if (!description) continue;
    const d = metaLength(description);
    if (d < DESCRIPTION_MIN_CHARS) shortDesc.push(`${route} (${d})`);
    else if (d > DESCRIPTION_MAX_CHARS) longDesc.push(`${route} (${d})`);
  }
  const out: string[] = [];
  if (longTitle.length > 0) {
    out.push(`[web-for-agents] Title longer than ${TITLE_MAX_CHARS} characters on ${longTitle.join(", ")}`);
  }
  if (shortDesc.length > 0) {
    out.push(`[web-for-agents] Meta description shorter than ${DESCRIPTION_MIN_CHARS} characters on ${shortDesc.join(", ")}`);
  }
  if (longDesc.length > 0) {
    out.push(`[web-for-agents] Meta description longer than ${DESCRIPTION_MAX_CHARS} characters on ${longDesc.join(", ")}`);
  }
  return out;
}
