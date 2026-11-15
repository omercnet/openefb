import type { IsraelNotam } from '../../../domain/israel/notamTypes';
import { TINT_COLORS, highlightFor } from './briefingHighlight';

const points: Record<string, { lat: number; lon: number }> = {
  AAA: { lat: 32, lon: 34.8 },
  BBB: { lat: 32.2, lon: 35 },
};
const lookup = (code: string) => points[code] ?? null;
const notam = (over: Record<string, unknown>) =>
  ({ geometry: { polygon: null, circle: null }, q: null, closures: [], ...over }) as unknown as IsraelNotam;

describe('briefing highlight', () => {
  it('draws a closure chain in the tint colour and frames its box', () => {
    const h = highlightFor(notam({ closures: [{ chain: ['AAA', 'BBB'] }] }), 'closure', lookup);
    expect(h?.source.features[0]?.properties).toMatchObject({ color: TINT_COLORS.closure });
    expect(h?.bounds).toEqual({ south: 32, west: 34.8, north: 32.2, east: 35 });
  });

  it('has nothing to show for a NOTAM with no area or route (or points the data does not know)', () => {
    expect(highlightFor(notam({}), 'info', lookup)).toBeNull();
    expect(highlightFor(notam({ closures: [{ chain: ['XXX', 'YYY'] }] }), 'caution', lookup)).toBeNull();
  });

  it('the tint colours are the Swift MapColor values', () => {
    expect(TINT_COLORS).toEqual({ closure: '#FF3B30', caution: '#FF9500', info: '#007AFF' });
  });
});
