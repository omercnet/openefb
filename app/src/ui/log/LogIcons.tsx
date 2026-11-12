// SF Symbols of the Log screen redrawn as react-native-svg paths, sized from reference/ipad-log.png (points).
import Svg, { Circle, Path, Rect } from 'react-native-svg';

type P = { color: string };
const line = { strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };

/** map (toolbar, .body): a three-panel folded map, 23 x 23. */
export const MapGlyph = ({ color }: P) => (
  <Svg width={23} height={23} viewBox="0 0 23 23">
    <Path
      d="M1.3 4.8L7.8 1.6 14.6 5.2 21.8 2V18.2L14.6 21.5 7.8 17.9 1.3 21Z M7.8 1.6V17.9 M14.6 5.2V21.5"
      stroke={color}
      strokeWidth={1.7}
      {...line}
    />
  </Svg>
);

// gearshape: eight teeth around a hub, 26 x 26.
const GEAR_PATH = (() => {
  const c = 13;
  const point = (r: number, deg: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return `${(c + r * Math.cos(a)).toFixed(2)} ${(c + r * Math.sin(a)).toFixed(2)}`;
  };
  const steps: string[] = [];
  for (let i = 0; i < 8; i++) {
    const a = i * 45;
    steps.push(point(8.6, a - 15), point(11.2, a - 8), point(11.2, a + 8), point(8.6, a + 15));
  }
  return `M${steps.join('L')}Z`;
})();

/** gearshape (toolbar, .body). */
export const GearGlyph = ({ color }: P) => (
  <Svg width={26} height={26} viewBox="0 0 26 26">
    <Path d={GEAR_PATH} stroke={color} strokeWidth={1.6} {...line} />
    <Circle cx={13} cy={13} r={3.6} stroke={color} strokeWidth={1.6} fill="none" />
  </Svg>
);

/** plus at a given box size and stroke: 30 / 3.8 beside "Plan a flight" (rowIdent), 14 / 1.5 in the Flown header. */
export const PlusGlyph = ({ color, size, stroke }: P & { size: number; stroke: number }) => {
  const a = stroke / 2;
  const b = size - stroke / 2;
  const m = size / 2;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Path d={`M${m} ${a}V${b}M${a} ${m}H${b}`} stroke={color} strokeWidth={stroke} {...line} />
    </Svg>
  );
};

/** signature (dataEmphasis): a scribble over its baseline. */
export const SignatureGlyph = ({ color }: P) => (
  <Svg width={18} height={15} viewBox="0 0 18 15">
    <Path
      d="M1.5 9.5C3 5 4.5 2 6 2.5S5 10 6.5 10 9 5.5 10.5 6 10 9.5 11.5 9.5 14 7.5 16.5 8"
      stroke={color}
      strokeWidth={1.4}
      {...line}
    />
    <Path d="M1.5 13.5H16.5" stroke={color} strokeWidth={1.4} {...line} />
  </Svg>
);

/** book.closed (dataEmphasis). */
export const BookClosedGlyph = ({ color }: P) => (
  <Svg width={14} height={16} viewBox="0 0 14 16">
    <Rect x={1.2} y={1} width={11.6} height={14} rx={1.6} stroke={color} strokeWidth={1.4} fill="none" />
    <Path d="M4.2 1.2V14.8" stroke={color} strokeWidth={1.4} {...line} />
  </Svg>
);

/** checkmark (data). */
export const CheckmarkGlyph = ({ color }: P) => (
  <Svg width={14} height={13} viewBox="0 0 14 13">
    <Path d="M1.5 7L5.3 11 12.5 1.8" stroke={color} strokeWidth={1.6} {...line} />
  </Svg>
);
