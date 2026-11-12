// SF Symbols the forms and onboarding use that Icons.tsx does not have, redrawn as react-native-svg paths in the same style.
import { View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { Airplane } from '../Icons';

type P = { color: string; size?: number };
const line = { strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };

/** location.fill (the onboarding hero) */
export const LocationFill = ({ color, size = 64 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 64 64">
    <Path d="M58 6L6 29 30 34 35 58Z" fill={color} stroke={color} strokeWidth={6} strokeLinejoin="round" />
  </Svg>
);

/** map.fill (.title2) */
export const MapFill = ({ color, size = 28 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 28 28">
    <Path
      d="M3 7.5L9.6 5.2V22.5L3 24.8ZM11.4 5.2L16.6 7.5V24.8L11.4 22.5ZM18.4 7.5L25 5.2V22.5L18.4 24.8Z"
      fill={color}
    />
  </Svg>
);

/** icloud.slash (.title2) */
export const CloudSlash = ({ color, size = 28 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 28 28">
    <Path
      d="M7.4 22.4C4.6 22.4 2.6 20.4 2.6 17.8 2.6 15.6 4.2 13.8 6.3 13.4 6.9 10.3 9.5 8 12.7 8 14 8 15.2 8.4 16.2 9.1M20 12.2C22.6 12.5 25 14.5 25 17.4 25 20.2 22.8 22.4 20 22.4H10"
      stroke={color}
      strokeWidth={1.7}
      {...line}
    />
    <Path d="M4 4.5L24 24.5" stroke={color} strokeWidth={1.7} {...line} />
  </Svg>
);

/** exclamationmark.shield.fill (.title2) */
export const ShieldExclamation = ({ color, bang, size = 28 }: P & { bang: string }) => (
  <Svg width={size} height={size} viewBox="0 0 28 28">
    <Path d="M14 2.4L24 6V13.2C24 19.4 19.8 24 14 26 8.2 24 4 19.4 4 13.2V6Z" fill={color} />
    <Path d="M14 8.6V14.6" stroke={bang} strokeWidth={2.2} {...line} />
    <Circle cx={14} cy={18.4} r={1.3} fill={bang} />
  </Svg>
);

/** checkmark (selected row in an inline picker) */
export const Checkmark = ({ color, size = 17 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 17 17">
    <Path d="M2.5 9L6.6 13 14.5 3.6" stroke={color} strokeWidth={2} {...line} />
  </Svg>
);

/** chevron.up.chevron.down (the trailing glyph of a menu picker row) */
export const UpDownChevrons = ({ color }: P) => (
  <Svg width={10} height={16} viewBox="0 0 10 16">
    <Path d="M1 5.6L5 1.6 9 5.6M1 10.4L5 14.4 9 10.4" stroke={color} strokeWidth={1.4} {...line} />
  </Svg>
);

/** arrow.down.circle.fill (a newer edition is available) */
export const ArrowDownCircleFill = ({ color, arrow, size = 14 }: P & { arrow: string }) => (
  <Svg width={size} height={size} viewBox="0 0 14 14">
    <Circle cx={7} cy={7} r={7} fill={color} />
    <Path d="M7 3.4V10M4.2 7.4L7 10.2 9.8 7.4" stroke={arrow} strokeWidth={1.4} {...line} />
  </Svg>
);

/** airplane.circle (.title3): the airplane inside a ring. */
export const AirplaneCircle = ({ color, size = 28 }: P) => (
  <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
    <Svg width={size} height={size} viewBox="0 0 28 28" style={{ position: 'absolute' }}>
      <Circle cx={14} cy={14} r={12.6} stroke={color} strokeWidth={1.5} fill="none" />
    </Svg>
    <Airplane color={color} />
  </View>
);

/** lock.fill (a confirmed logbook entry) */
export const LockFill = ({ color, size = 16 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 16 16">
    <Rect x={2.6} y={7} width={10.8} height={7.6} rx={1.8} fill={color} />
    <Path d="M5 7V5.2C5 3.5 6.3 2.4 8 2.4S11 3.5 11 5.2V7" stroke={color} strokeWidth={1.5} {...line} />
  </Svg>
);

/** person.circle (.title3): a head and shoulders inside a ring. */
export const PersonCircle = ({ color, size = 28 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 28 28">
    <Circle cx={14} cy={14} r={12.6} stroke={color} strokeWidth={1.5} fill="none" />
    <Circle cx={14} cy={11} r={3.6} stroke={color} strokeWidth={1.5} fill="none" />
    <Path d="M6.8 21.6C8.2 18.2 10.8 16.6 14 16.6S19.8 18.2 21.2 21.6" stroke={color} strokeWidth={1.5} {...line} />
  </Svg>
);

/** person.badge.plus (.body): a person with a plus. */
export const PersonPlus = ({ color, size = 24 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Circle cx={9.5} cy={7.5} r={3.6} stroke={color} strokeWidth={1.6} fill="none" />
    <Path d="M2.8 19.6C3.8 16 6.4 14.4 9.5 14.4S13.2 15.4 14.4 17.4" stroke={color} strokeWidth={1.6} {...line} />
    <Path d="M18.6 10.4V17.4M15.1 13.9H22.1" stroke={color} strokeWidth={1.7} {...line} />
  </Svg>
);

/** pencil (.body) */
export const Pencil = ({ color, size = 20 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 20 20">
    <Path
      d="M3 17L3.9 13.1 13.6 3.4C14.2 2.8 15.2 2.8 15.8 3.4L16.6 4.2C17.2 4.8 17.2 5.8 16.6 6.4L6.9 16.1Z"
      stroke={color}
      strokeWidth={1.5}
      {...line}
    />
    <Path d="M12 5L15 8" stroke={color} strokeWidth={1.5} {...line} />
  </Svg>
);

/** moon.fill (.body) */
export const MoonFill = ({ color, size = 20 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 20 20">
    <Path
      d="M16.6 12.6C15.6 13 14.6 13.2 13.5 13.2 9.9 13.2 7 10.3 7 6.7 7 5.6 7.3 4.6 7.7 3.7 4.9 4.6 3 7.2 3 10.2 3 14 6 17 9.8 17 12.8 17 15.4 15.1 16.6 12.6Z"
      fill={color}
    />
  </Svg>
);
