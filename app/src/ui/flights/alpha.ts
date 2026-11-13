/** `color` with its alpha replaced (SwiftUI `Color.opacity(_)`): #RRGGBB or rgba(r,g,b,a), as the theme's colours are. */
export function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('#')) {
    const n = parseInt(color.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }
  const m = /rgba?\(([^,]+),([^,]+),([^,)]+)/.exec(color);
  return m ? `rgba(${m[1]},${m[2]},${m[3]},${alpha})` : color;
}
