// SF Symbols the strip uses, redrawn as react-native-svg paths. Each Svg is the symbol's layout frame at its
// rendered size (points, measured from the iOS screenshots); stroke widths match SF Symbols regular weight.
import Svg, { Circle, Path, Rect } from 'react-native-svg';

type P = { color: string; size?: number };
const line = { strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };

/** list.bullet (.title3) */
export const ListBullet = ({ color }: P) => (
  <Svg width={21} height={16} viewBox="0 0 21 16">
    {[1.5, 8, 14.5].map((y) => (
      <Circle key={y} cx={1.6} cy={y} r={1.6} fill={color} />
    ))}
    {[1.5, 8, 14.5].map((y) => (
      <Path key={`l${y}`} d={`M6 ${y}H20`} stroke={color} strokeWidth={1.7} {...line} />
    ))}
  </Svg>
);

/** magnifyingglass (.title3) */
export const Magnifier = ({ color }: P) => (
  <Svg width={20} height={22} viewBox="0 -1 20 22">
    <Circle cx={8.2} cy={8.2} r={7} stroke={color} strokeWidth={1.7} fill="none" />
    <Path d="M13.3 13.3L18.6 18.6" stroke={color} strokeWidth={2} {...line} />
  </Svg>
);

/** square.3.layers.3d (.title3) */
export const Layers = ({ color }: P) => (
  <Svg width={20} height={24} viewBox="0 -1 20 24">
    <Path d="M10 1.2L18.6 6 10 10.8 1.4 6Z" stroke={color} strokeWidth={1.6} {...line} />
    <Path d="M3.4 9.2L1.4 10.4 10 15.2 18.6 10.4 16.6 9.2" stroke={color} strokeWidth={1.6} {...line} />
    <Path d="M3.4 13.6L1.4 14.8 10 19.6 18.6 14.8 16.6 13.6" stroke={color} strokeWidth={1.6} {...line} />
  </Svg>
);

/** plus (.title3) */
export const Plus = ({ color }: P) => (
  <Svg width={18} height={18} viewBox="0 0 18 18">
    <Path d="M9 1V17M1 9H17" stroke={color} strokeWidth={1.8} {...line} />
  </Svg>
);

/** minus (.title3) */
export const Minus = ({ color }: P) => (
  <Svg width={18} height={4} viewBox="0 0 18 4">
    <Path d="M1 2H17" stroke={color} strokeWidth={1.8} {...line} />
  </Svg>
);

/** chevron.backward (7 x 13), chevron.right (7 x 11) and chevron.down (11 x 7), caption size */
export const Chevron = ({ color, dir }: P & { dir: 'left' | 'right' | 'down' }) => {
  const d = { left: 'M6 1L1 6.5 6 12', right: 'M1 1L5.8 5.5 1 10', down: 'M1 1L5.5 5.8 10 1' }[dir];
  const [w, h] = { left: [7, 13], right: [7, 11], down: [11, 7] }[dir];
  return (
    <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <Path d={d} stroke={color} strokeWidth={1.3} {...line} />
    </Svg>
  );
};

/** arrow.up (VS climb arrow beside ALT, dataEmphasis size) */
export const ArrowUp = ({ color, size = 13 }: P) => (
  <Svg width={size * 0.85} height={size} viewBox="0 0 11 13">
    <Path d="M5.5 12.2V1.2M1 5.6L5.5 1.1 10 5.6" stroke={color} strokeWidth={1.5} {...line} />
  </Svg>
);

/** arrow.up.right (Direct button) */
export const ArrowUpRight = ({ color }: P) => (
  <Svg width={12} height={12} viewBox="0 0 12 12">
    <Path d="M1.5 10.5L10.5 1.5M3.5 1.5H10.5V8.5" stroke={color} strokeWidth={1.7} {...line} />
  </Svg>
);

/** arrow.clockwise */
export const ArrowClockwise = ({ color, size = 16 }: P) => (
  <Svg width={size} height={size * 1.1} viewBox="0 0 16 17.6">
    <Path d="M10.4 2.6A6.8 6.8 0 1 1 3.6 4.4" stroke={color} strokeWidth={1.5} {...line} />
    <Path d="M7.3 0.6L10.6 2.6 8.3 5.6" stroke={color} strokeWidth={1.5} {...line} />
  </Svg>
);

/** airplane (filled, pointing right) */
export const Airplane = ({ color }: P) => (
  <Svg width={15} height={13} viewBox="0 0 15 13">
    <Path
      d="M14.4 6.5C14.4 5.8 13.6 5.4 12.7 5.4H9.6L6.2 0.3H4.8L6.6 5.4H3.4L2.3 3.7H1.2L1.9 6.5 1.2 9.3H2.3L3.4 7.6H6.6L4.8 12.7H6.2L9.6 7.6H12.7C13.6 7.6 14.4 7.2 14.4 6.5Z"
      fill={color}
    />
  </Svg>
);

/** fuelpump */
export const FuelPump = ({ color }: P) => (
  <Svg width={14} height={15} viewBox="0 0 14 15">
    <Rect x={1.2} y={1.2} width={7.4} height={12.6} rx={1.4} stroke={color} strokeWidth={1.3} fill="none" />
    <Rect x={3} y={3} width={3.8} height={3.4} rx={0.6} fill={color} />
    <Path d="M0.4 14H9.4M8.6 6.2H10.2C10.8 6.2 11.2 6.6 11.2 7.2V11.2C11.2 11.8 11.6 12.2 12.1 12.2 12.6 12.2 13 11.8 13 11.2V5.2L11 3" stroke={color} strokeWidth={1.2} {...line} />
  </Svg>
);

/** key (NOTAM API hint) */
export const Key = ({ color }: P) => (
  <Svg width={12} height={20} viewBox="0 0 12 20">
    <Circle cx={6} cy={5.2} r={4.4} stroke={color} strokeWidth={1.2} fill="none" />
    <Circle cx={6} cy={3.6} r={1.1} stroke={color} strokeWidth={1} fill="none" />
    <Path d="M6 9.6V18.4L7.8 16.6 6.6 15.4 7.8 14.2 6.6 13" stroke={color} strokeWidth={1.2} {...line} />
  </Svg>
);

/** exclamationmark.triangle.fill */
export const WarningTriangle = ({ color, bang }: P & { bang: string }) => (
  <Svg width={16} height={14} viewBox="0 0 16 14">
    <Path d="M6.6 1.2C7.2 0.1 8.8 0.1 9.4 1.2L15.5 11.6C16.1 12.7 15.3 14 14.1 14H1.9C0.7 14-0.1 12.7 0.5 11.6Z" fill={color} />
    <Path d="M8 4.2V8.4" stroke={bang} strokeWidth={1.8} {...line} />
    <Circle cx={8} cy={11} r={1.05} fill={bang} />
  </Svg>
);

/** xmark (.footnote) */
export const Xmark = ({ color, size = 13 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 13 13">
    <Path d="M1.5 1.5L11.5 11.5M11.5 1.5L1.5 11.5" stroke={color} strokeWidth={1.7} {...line} />
  </Svg>
);

/** xmark.circle.fill: a filled disc with the cross knocked out in `cross`. */
export const XmarkCircleFill = ({ color, cross, size = 17 }: P & { cross: string }) => (
  <Svg width={size} height={size} viewBox="0 0 17 17">
    <Circle cx={8.5} cy={8.5} r={8.5} fill={color} />
    <Path d="M5.6 5.6L11.4 11.4M11.4 5.6L5.6 11.4" stroke={cross} strokeWidth={1.6} {...line} />
  </Svg>
);

/** info.circle */
export const InfoCircle = ({ color, size = 17 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 17 17">
    <Circle cx={8.5} cy={8.5} r={7.6} stroke={color} strokeWidth={1.3} fill="none" />
    <Circle cx={8.5} cy={5} r={0.95} fill={color} />
    <Path d="M8.5 7.6V12.6" stroke={color} strokeWidth={1.5} {...line} />
  </Svg>
);

/** exclamationmark.octagon.fill (.title3) */
export const OctagonWarning = ({ color, bang, size = 20 }: P & { bang: string }) => (
  <Svg width={size} height={size} viewBox="0 0 20 20">
    <Path d="M6.2 1H13.8L19 6.2V13.8L13.8 19H6.2L1 13.8V6.2Z" fill={color} />
    <Path d="M10 5.4V11" stroke={bang} strokeWidth={1.8} {...line} />
    <Circle cx={10} cy={14} r={1.1} fill={bang} />
  </Svg>
);
