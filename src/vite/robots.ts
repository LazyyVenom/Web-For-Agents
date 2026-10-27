import { AI_BOTS } from "../shared/bots";
import { SITEMAP_PATH } from "../shared/conventions";
import type { ResolvedOptions } from "./options";

export { AI_BOTS };

export function buildRobots(opts: ResolvedOptions): string {
  const { ai, disallow = [] } = opts.robots;
  const overrides = ai.overrides ?? {};

  const blocked: string[] = [];
  const add = (bot: string) => {
    if (!blocked.includes(bot)) blocked.push(bot);
  };
  if (ai.training === "block") AI_BOTS.training.forEach(add);
  if (ai.search === "block") AI_BOTS.search.forEach(add);

  for (const [bot, rule] of Object.entries(overrides)) {
    const i = blocked.findIndex((b) => b.toLowerCase() === bot.toLowerCase());
    if (rule === "block") {
      if (i === -1) blocked.push(bot);
    } else if (i !== -1) blocked.splice(i, 1);
  }

  const blocks: string[] = [
    ["User-agent: *", "Allow: /", ...disallow.map((p) => `Disallow: ${p}`)].join("\n"),
  ];
  if (blocked.length) {
    blocks.push([...blocked.map((b) => `User-agent: ${b}`), "Disallow: /"].join("\n"));
  }
  if (opts.sitemap) blocks.push(`Sitemap: ${opts.siteUrl}${SITEMAP_PATH}`);

  return blocks.join("\n\n") + "\n";
}
