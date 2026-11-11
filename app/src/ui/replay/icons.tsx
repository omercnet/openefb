// SF Symbols the replay screen uses, redrawn as react-native-svg paths in the style of ui/Icons.tsx.
import Svg, { Circle, Path, Rect } from 'react-native-svg';

type P = { color: string; size?: number };
const line = { strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };

/** play.fill (.title2) */
export const PlayFill = ({ color, size = 22 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 20 20">
    <Path d="M6.2 3.8L16 10L6.2 16.2Z" fill={color} stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
  </Svg>
);

/** pause.fill (.title2) */
export const PauseFill = ({ color, size = 22 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 20 20">
    <Rect x={4.6} y={3.6} width={4} height={12.8} rx={1.2} fill={color} />
    <Rect x={11.4} y={3.6} width={4} height={12.8} rx={1.2} fill={color} />
  </Svg>
);

/** location.fill (.body) */
export const LocationFill = ({ color, size = 20 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 20 20">
    <Path d="M16.8 3.2L3.4 8.9L9 11L11.1 16.6Z" fill={color} stroke={color} strokeWidth={1.2} strokeLinejoin="round" />
  </Svg>
);

/** sidebar.trailing (.body) */
export const SidebarTrailing = ({ color, size = 20 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 20 20">
    <Rect x={2.5} y={3.5} width={15} height={13} rx={2.6} stroke={color} strokeWidth={1.5} fill="none" />
    <Path d="M12 4V16" stroke={color} strokeWidth={1.5} />
    <Rect x={12} y={4} width={5} height={12} fill={color} />
  </Svg>
);

/** text.bubble and text.bubble.fill */
export const TextBubble = ({ color, size = 20, filled = false }: P & { filled?: boolean }) => (
  <Svg width={size} height={size} viewBox="0 0 20 20">
    <Path
      d="M4.5 3.5H15.5A2 2 0 0 1 17.5 5.5V12A2 2 0 0 1 15.5 14H9L5.5 17V14H4.5A2 2 0 0 1 2.5 12V5.5A2 2 0 0 1 4.5 3.5Z"
      stroke={color}
      strokeWidth={1.5}
      strokeLinejoin="round"
      fill={filled ? color : 'none'}
    />
    {filled ? null : <Path d="M6 7.2H14M6 10.2H11.5" stroke={color} strokeWidth={1.4} {...line} />}
  </Svg>
);

/** speaker.slash.fill (.caption) */
export const SpeakerSlashFill = ({ color, size = 14 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 20 20">
    <Path d="M3 7.6H6L10.6 3.6V16.4L6 12.4H3Z" fill={color} />
    <Path
      d="M13.4 7.4C14.5 8.2 14.5 11.8 13.4 12.6M15.4 5.4C17.6 7.4 17.6 12.6 15.4 14.6"
      stroke={color}
      strokeWidth={1.4}
      {...line}
    />
    <Path d="M3 3L17 17" stroke={color} strokeWidth={1.9} {...line} />
  </Svg>
);

/** checkmark (.caption) */
export const Checkmark = ({ color, size = 14 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 20 20">
    <Path d="M4 10.5L8.2 14.6L16 5.4" stroke={color} strokeWidth={2.2} {...line} />
  </Svg>
);

/** record.circle (.largeTitle) */
export const RecordCircle = ({ color, size = 40 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 20 20">
    <Circle cx={10} cy={10} r={8.4} stroke={color} strokeWidth={1.4} fill="none" />
    <Circle cx={10} cy={10} r={5} fill={color} />
  </Svg>
);
