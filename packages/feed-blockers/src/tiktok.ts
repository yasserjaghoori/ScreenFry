/** Identity only; query/tracking parameters do not make a different video. */
export function tiktokVideoId(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (
      parsed.hostname !== "tiktok.com" &&
      !parsed.hostname.endsWith(".tiktok.com")
    )
      return;
    return /^\/@[^/]+\/video\/([^/]+)/.exec(parsed.pathname)?.[1];
  } catch {
    return;
  }
}
