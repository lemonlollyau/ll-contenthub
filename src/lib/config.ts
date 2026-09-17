/** Central app settings. Change the Claude model here (or via env) and nowhere else. */
export const config = {
  claudeModel: process.env.CLAUDE_MODEL ?? "claude-sonnet-5",
  buffer: { apiUrl: "https://api.buffer.com" },
  storage: {
    renderedBucket: "rendered",
    thumbsBucket: "thumbs",
    importsBucket: "imports",
  },
  batch: {
    driveFilesPerCall: 50,
    aiImagesPerCall: 5,
    matchItemsPerCall: 3,
    renderItemsPerCall: 4,
  },
} as const;
