/** Shared by the lazy Blog and Post chunks, so the build emits it as its own preloaded chunk. */
export function byline(author: string): string {
  return `Written by ${author.trim().toUpperCase()} for the fixture blog`;
}
