/** Recommended title and meta description lengths, in characters. */
export const TITLE_MAX_CHARS = 60;
export const DESCRIPTION_MIN_CHARS = 50;
export const DESCRIPTION_MAX_CHARS = 160;

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
    if (title && title.length > TITLE_MAX_CHARS) longTitle.push(`${route} (${title.length})`);
    if (!description) continue;
    if (description.length < DESCRIPTION_MIN_CHARS) shortDesc.push(`${route} (${description.length})`);
    else if (description.length > DESCRIPTION_MAX_CHARS) longDesc.push(`${route} (${description.length})`);
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
