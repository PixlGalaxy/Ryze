/** Discord CDN images go through our server so they load inside the Activity sandbox. */
export function cdn(url: string | null | undefined): string {
  return (url ?? '').replace(/^https:\/\/cdn\.discordapp\.com\//, '/cdn/');
}

export function timeAgo(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'hace unos segundos';
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const hrs = Math.round(m / 60);
  if (hrs < 24) return `hace ${hrs} h`;
  const d = Math.round(hrs / 24);
  return d < 30 ? `hace ${d} d` : new Date(ms).toLocaleDateString('es');
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
