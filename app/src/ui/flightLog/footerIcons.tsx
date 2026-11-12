// SF Symbols only the footer uses, in the style of ../Icons.tsx.
import Svg, { Path } from 'react-native-svg';

/** location.fill (.title3): the Recenter cell. */
export const LocationFill = ({ color }: { color: string }) => (
  <Svg width={18} height={18} viewBox="0 0 18 18">
    <Path d="M17 1L1.2 8.2 8.4 9.6 9.8 16.8Z" fill={color} stroke={color} strokeWidth={1.2} strokeLinejoin="round" />
  </Svg>
);
