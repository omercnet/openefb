// SF Symbols the flight detail and debrief screens use, redrawn as react-native-svg paths in the style of ui/Icons.tsx.
import Svg, { Circle, Path, Rect } from 'react-native-svg';

type P = { color: string; size?: number };
const line = { strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };

/** waveform (.headline) */
export const Waveform = ({ color, size = 20 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 20 20">
    <Path d="M2.5 8V12M6 5V15M10 2.5V17.5M14 6V14M17.5 8.5V11.5" stroke={color} strokeWidth={1.8} {...line} />
  </Svg>
);

/** play.circle (.headline and .title3) */
export const PlayCircle = ({ color, size = 20 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 20 20">
    <Circle cx={10} cy={10} r={8.3} stroke={color} strokeWidth={1.4} fill="none" />
    <Path d="M8 6.6L13.6 10L8 13.4Z" fill={color} />
  </Svg>
);

/** point.topleft.down.to.point.bottomright.curvepath (.headline) */
export const CurvePath = ({ color, size = 20 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 20 20">
    <Circle cx={4} cy={4} r={1.9} stroke={color} strokeWidth={1.4} fill="none" />
    <Circle cx={16} cy={16} r={1.9} stroke={color} strokeWidth={1.4} fill="none" />
    <Path d="M5.9 4H11C14 4 14 9 10 10C6 11 6 16 9 16H14.1" stroke={color} strokeWidth={1.4} {...line} />
  </Svg>
);

/** brain.head.profile (.headline): a head in profile with a brain's folds. */
export const BrainHead = ({ color, size = 20 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 20 20">
    <Path
      d="M7 17V14.2C4.6 13.1 3.2 10.9 3.2 8.4C3.2 4.9 6 2.4 9.4 2.4C13 2.4 15.8 4.9 15.8 8.2L17 10.6H15.8V13C15.8 13.8 15.2 14.4 14.4 14.4H12.4V17"
      stroke={color}
      strokeWidth={1.4}
      {...line}
    />
    <Path
      d="M7.2 6.4C8.4 5.6 10 6 10.4 7.2M8 10C9.2 9.2 10.8 9.6 11.2 10.8"
      stroke={color}
      strokeWidth={1.2}
      {...line}
    />
  </Svg>
);

/** brain (.title3): the folds, without the head. */
export const Brain = ({ color, size = 20 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 20 20">
    <Path
      d="M10 4V16M10 4C8 2.6 5.4 3.4 5 5.8C3.2 6.2 2.6 8.4 3.8 9.8C2.8 11.2 3.4 13.4 5.2 13.8C5.6 15.8 8 16.8 10 16M10 4C12 2.6 14.6 3.4 15 5.8C16.8 6.2 17.4 8.4 16.2 9.8C17.2 11.2 16.6 13.4 14.8 13.8C14.4 15.8 12 16.8 10 16"
      stroke={color}
      strokeWidth={1.4}
      {...line}
    />
  </Svg>
);

/** sparkles (.title3) */
export const Sparkles = ({ color, size = 20 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 20 20">
    <Path d="M8 3L9.6 7.4L14 9L9.6 10.6L8 15L6.4 10.6L2 9L6.4 7.4Z" fill={color} />
    <Path d="M15 2.5L15.7 4.3L17.5 5L15.7 5.7L15 7.5L14.3 5.7L12.5 5L14.3 4.3Z" fill={color} />
    <Path d="M15 12L15.6 13.4L17 14L15.6 14.6L15 16L14.4 14.6L13 14L14.4 13.4Z" fill={color} />
  </Svg>
);

/** doc.text (.headline) */
export const DocText = ({ color, size = 20 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 20 20">
    <Path
      d="M5 2.5H11.4L15.5 6.6V16.2C15.5 17 14.9 17.5 14.2 17.5H5.8C5.1 17.5 4.5 17 4.5 16.2V3.8C4.5 3 4.9 2.5 5 2.5Z"
      stroke={color}
      strokeWidth={1.4}
      {...line}
    />
    <Path d="M11 2.8V7H15.2M7 10.2H13M7 13H11" stroke={color} strokeWidth={1.3} {...line} />
  </Svg>
);

/** list.bullet.clipboard (.headline) */
export const ListClipboard = ({ color, size = 20 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 20 20">
    <Rect x={3.6} y={3.6} width={12.8} height={14} rx={2} stroke={color} strokeWidth={1.4} fill="none" />
    <Rect x={7} y={2} width={6} height={3.2} rx={1.2} stroke={color} strokeWidth={1.3} fill="none" />
    <Circle cx={7} cy={9.4} r={0.9} fill={color} />
    <Circle cx={7} cy={13} r={0.9} fill={color} />
    <Path d="M9.6 9.4H13.6M9.6 13H13.6" stroke={color} strokeWidth={1.3} {...line} />
  </Svg>
);

const BULB =
  'M10 2.6C6.9 2.6 5 4.8 5 7.4C5 9.2 5.9 10.4 6.8 11.4C7.4 12 7.5 12.5 7.5 13.2H12.5C12.5 12.5 12.6 12 13.2 11.4C14.1 10.4 15 9.2 15 7.4C15 4.8 13.1 2.6 10 2.6Z';

/** lightbulb and lightbulb.fill */
export const Lightbulb = ({ color, size = 20, filled = false }: P & { filled?: boolean }) => (
  <Svg width={size} height={size} viewBox="0 0 20 20">
    <Path d={BULB} stroke={color} strokeWidth={1.4} strokeLinejoin="round" fill={filled ? color : 'none'} />
    <Path d="M8 15.4H12M8.8 17.4H11.2" stroke={color} strokeWidth={1.4} {...line} />
  </Svg>
);

const STAR = 'M10 2.4L12.2 7.2L17.4 7.8L13.5 11.3L14.6 16.5L10 13.9L5.4 16.5L6.5 11.3L2.6 7.8L7.8 7.2Z';

/** star and star.fill (.title2) */
export const Star = ({ color, size = 24, filled }: P & { filled: boolean }) => (
  <Svg width={size} height={size} viewBox="0 0 20 20">
    <Path d={STAR} stroke={color} strokeWidth={1.3} strokeLinejoin="round" fill={filled ? color : 'none'} />
  </Svg>
);

/** checkmark.circle.fill (.footnote) */
export const CheckCircleFill = ({ color, mark, size = 17 }: P & { mark: string }) => (
  <Svg width={size} height={size} viewBox="0 0 17 17">
    <Circle cx={8.5} cy={8.5} r={8.5} fill={color} />
    <Path d="M4.8 8.8L7.4 11.4L12.2 5.8" stroke={mark} strokeWidth={1.7} {...line} />
  </Svg>
);

/** arrow.counterclockwise (.body) */
export const ArrowCounterclockwise = ({ color, size = 16 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 20 20">
    <Path d="M4 10A6 6 0 1 0 6 5.5M4.2 3V6.6H7.8" stroke={color} strokeWidth={1.6} {...line} />
  </Svg>
);
