// Two SF Symbols the US flight plan screen uses (kept beside it so the shared Icons.tsx stays untouched until wiring).
import Svg, { Circle, Path } from 'react-native-svg';

type P = { color: string; size?: number };
const line = { strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };

/** checkmark.circle.fill: a filled disc with the check knocked out in `check` (the active saved plan). */
export const CheckmarkCircleFill = ({ color, check, size = 17 }: P & { check: string }) => (
  <Svg width={size} height={size} viewBox="0 0 17 17">
    <Circle cx={8.5} cy={8.5} r={8.5} fill={color} />
    <Path d="M5 8.8L7.5 11.2L12 5.9" stroke={check} strokeWidth={1.7} {...line} />
  </Svg>
);

/** arrow.right (the arrow between the ends of a route) */
export const ArrowRight = ({ color, size = 13 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 13 13">
    <Path d="M1.5 6.5H11.5M7.3 2.3L11.5 6.5L7.3 10.7" stroke={color} strokeWidth={1.6} {...line} />
  </Svg>
);
