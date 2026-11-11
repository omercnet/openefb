import type { Theme } from '../tokens';

/** SwiftUI's .ultraThinMaterial behind the replay overlays, as a translucent fill (there is no blur view in the app's dependencies). */
export const materialFill = (t: Theme): string => (t.night ? 'rgba(22,26,31,0.86)' : 'rgba(255,255,255,0.86)');

/** `.dynamicTypeSize(...DynamicTypeSize.xxxLarge)` on the controls over the map: text stops growing at 1.35x (xxxLarge). */
export const overlayText = { maxFontSizeMultiplier: 1.35 } as const;
