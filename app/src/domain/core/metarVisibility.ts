// Port of Core/MetarVisibility.swift.

/** Prevailing visibility in metres from a raw ICAO METAR; null for statute-mile reports or when absent. */
export function visibilityMetres(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const tokens = raw.split(/[ \t\r\n\v\f\u0085\u2028\u2029]+/).filter((t) => t.length > 0);
  if (tokens.includes('CAVOK')) return 9999;
  const wind = tokens.findIndex((t) => t.endsWith('KT') || t.endsWith('MPS'));
  if (wind < 0) return null;
  for (const token of tokens.slice(wind + 1)) {
    if (/^\d{4}$/.test(token)) return Number(token);
    if (token.endsWith('SM')) return null;
    if (token.startsWith('Q') || token.includes('/')) return null;
  }
  return null;
}

export function formatVisibility(metres: number): string {
  return metres >= 9999 ? '\u226510 km' : `${metres} m`;
}
