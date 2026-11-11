// SF Symbols the recording notices use, redrawn as react-native-svg paths in the style of ui/Icons.tsx.
import Svg, { Path, Rect } from 'react-native-svg';

type P = { color: string; size?: number };
const line = { strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };

/** mic.slash.fill (.subheadline) */
export const MicSlashFill = ({ color, size = 18 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 20 20">
    <Rect x={7} y={2} width={6} height={9.5} rx={3} fill={color} />
    <Path
      d="M4.6 9.6C4.6 12.9 7 15 10 15S15.4 12.9 15.4 9.6M10 15V18M7 18H13"
      stroke={color}
      strokeWidth={1.5}
      {...line}
    />
    <Path d="M3 3L17 17" stroke={color} strokeWidth={1.9} {...line} />
  </Svg>
);

/** trash.slash.fill (.subheadline) */
export const TrashSlashFill = ({ color, size = 18 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 20 20">
    <Path d="M5.2 6.4H14.8L14 17H6Z" fill={color} />
    <Path d="M3.8 4.6H16.2M8 4.6V3H12V4.6" stroke={color} strokeWidth={1.5} {...line} />
    <Path d="M3 3L17 17" stroke={color} strokeWidth={1.9} {...line} />
  </Svg>
);
