export function progressBar(score: number | null, width: number = 10): string {
  if (score === null) return "─".repeat(width);
  const filled = Math.round((score / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}
