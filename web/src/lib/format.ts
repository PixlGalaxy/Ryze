/** Discord CDN images go through our server so they load inside the Activity sandbox. */
export function cdn(url: string | null | undefined): string {
  return (url ?? '').replace(/^https:\/\/cdn\.discordapp\.com\//, '/cdn/');
}

export function timeAgo(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const hrs = Math.round(m / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const d = Math.round(hrs / 24);
  return d < 30 ? `${d} d ago` : new Date(ms).toLocaleDateString('en');
}

/** Readable message for Errors and for the plain objects the Discord SDK rejects with ({ code, message }). */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const { message, code } = error as { message?: unknown; code?: unknown };
    if (typeof message === 'string' && message) return code !== undefined ? `${message} (code ${String(code)})` : message;
    try {
      return JSON.stringify(error);
    } catch {
      /* fall through */
    }
  }
  return String(error);
}
