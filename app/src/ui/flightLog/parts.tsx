// Flight log building blocks not in the shared Primitives / Icons: FlightLogCellButton (with its identifier), the NOW
// cell's text buttons, the notice row (RecordingOverlayView.swift `noticeRow`) and the SF Symbols only the strip uses.
import type { ReactNode } from 'react';
import { Text, View, type ViewProps } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { Pressy, useTheme } from '../Primitives';
import { Radius, Space, StripMetrics, Type, tracked } from '../tokens';

type P = { color: string; size?: number };
const line = { strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };

/** mic.fill (.title3) */
export const MicFill = ({ color }: P) => (
  <Svg width={14} height={21} viewBox="0 0 14 21">
    <Rect x={3.2} y={0.8} width={7.6} height={12.4} rx={3.8} fill={color} />
    <Path d="M1 9.4C1 13 3.7 15.6 7 15.6S13 13 13 9.4M7 15.6V20" stroke={color} strokeWidth={1.7} {...line} />
  </Svg>
);

/** doc.text.magnifyingglass (.title3) */
export const DocMagnifier = ({ color }: P) => (
  <Svg width={19} height={22} viewBox="0 0 19 22">
    <Path
      d="M11 20.5H3.2C2 20.5 1 19.5 1 18.3V3.2C1 2 2 1 3.2 1H12.8C14 1 15 2 15 3.2V9"
      stroke={color}
      strokeWidth={1.6}
      {...line}
    />
    <Path d="M4.5 6H11.5M4.5 9.5H9" stroke={color} strokeWidth={1.5} {...line} />
    <Circle cx={13} cy={14.5} r={3.6} stroke={color} strokeWidth={1.6} fill="none" />
    <Path d="M15.6 17.1L18 19.5" stroke={color} strokeWidth={1.8} {...line} />
  </Svg>
);

/** diamond.fill (TypeRole.data) */
export const Diamond = ({ color, size = 12 }: P) => (
  <Svg width={size} height={size} viewBox="0 0 12 12">
    <Path d="M6 0.5L11.5 6 6 11.5 0.5 6Z" fill={color} />
  </Svg>
);

/** location.slash.fill, wifi.slash, mic.slash.fill: the glyph of a notice label, drawn as a struck-through shape. */
export const Slashed = ({ color, glyph }: P & { glyph: 'location' | 'wifi' | 'mic' }) => (
  <Svg width={16} height={16} viewBox="0 0 16 16">
    {glyph === 'location' ? <Path d="M14.5 1.5L1.5 7.4 8 8.2 8.8 14.5Z" fill={color} /> : null}
    {glyph === 'wifi' ? (
      <Path
        d="M1.5 6.2C5 2.8 11 2.8 14.5 6.2M4 9C6.3 6.9 9.7 6.9 12 9M6.5 11.8C7.4 11 8.6 11 9.5 11.8"
        stroke={color}
        strokeWidth={1.5}
        {...line}
      />
    ) : null}
    {glyph === 'mic' ? <Rect x={5.5} y={1} width={5} height={9} rx={2.5} fill={color} /> : null}
    <Path d="M2 1.5L14 14.5" stroke={color} strokeWidth={1.6} {...line} />
  </Svg>
);

/** FlightLogCellButton: a 60pt strip control, glyph over an uppercase tracked label. */
export function FlightLogCellButton({
  title,
  label,
  icon,
  onPress,
  testID,
}: {
  title: string;
  label: string;
  icon: ReactNode;
  onPress: () => void;
  testID?: string;
}) {
  const t = useTheme();
  return (
    <Pressy
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      style={{
        minWidth: StripMetrics.cell,
        minHeight: StripMetrics.cell,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {icon}
      <Text
        numberOfLines={1}
        style={[Type.stripLabel, tracked, { color: t.ink, marginTop: 2, textTransform: 'uppercase' }]}
      >
        {title}
      </Text>
    </Pressy>
  );
}

/** NOW cell controls (Prev, Next, Clear): dataEmphasis on paperSecondary, 60pt, 40% when disabled. */
export function ControlButton({
  title,
  label,
  testID,
  enabled = true,
  onPress,
}: {
  title: string;
  label: string;
  testID: string;
  enabled?: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressy
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      testID={testID}
      style={{
        minWidth: StripMetrics.cell,
        minHeight: StripMetrics.cell,
        paddingHorizontal: Space.m,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: Radius.s,
        backgroundColor: t.paperSecondary,
        opacity: enabled ? 1 : 0.4,
      }}
    >
      <Text style={[Type.dataEmphasis, { color: t.ink }]}>{title}</Text>
    </Pressy>
  );
}

/** Full-width notice row: active-cell background with a 4pt leading rule in the notice's colour. */
export function NoticeRow({ tint, children, ...rest }: ViewProps & { tint: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View {...rest} style={{ padding: Space.m, backgroundColor: t.activeCell }}>
      {children}
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: tint }} />
    </View>
  );
}
