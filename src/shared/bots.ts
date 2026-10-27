/** Known AI crawler user agents, grouped by robots.ai policy. */
export const AI_BOTS: { training: readonly string[]; search: readonly string[] } = {
  training: [
    "GPTBot",
    "ClaudeBot",
    "CCBot",
    "Google-Extended",
    "Applebot-Extended",
    "Meta-ExternalAgent",
    "Bytespider",
    "cohere-training-data-crawler",
  ],
  search: [
    "OAI-SearchBot",
    "ChatGPT-User",
    "Claude-SearchBot",
    "Claude-User",
    "PerplexityBot",
    "Perplexity-User",
  ],
};
