// Pieces the PIREP and winds aloft sections share, drawn like their twins in ../sections.tsx (SystemHeader, the
// caution label, the bordered Retry button) so the sections sit in the airport column with the same look.
import { ActivityIndicator, Text, View } from 'react-native';
import { WarningTriangle } from '../../../Icons';
import { Pressy, useTheme } from '../../../Primitives';
import { Radius, Space, StripMetrics, Type } from '../../../tokens';

/** SectionHeader (DesignTokens.swift): Archivo SemiBold 12 in the system secondary color. */
export function SystemHeader({ title }: { title: string }) {
  const t = useTheme();
  return (
    <Text accessibilityRole="header" style={[Type.sectionHeader, { color: t.secondaryText }]}>
      {title}
    </Text>
  );
}

/** `ProgressView().frame(maxWidth: .infinity, alignment: .leading)`. */
export function LoadingRow({ testID, label }: { testID: string; label: string }) {
  const t = useTheme();
  return (
    <View testID={testID} accessible accessibilityLabel={label} style={{ flexDirection: 'row', alignItems: 'center' }}>
      <ActivityIndicator size="small" color={t.secondaryText} />
    </View>
  );
}

/** `.bordered` `.controlSize(.large)` Retry button. */
export function RetryButton({ onPress, testID }: { onPress: () => void; testID?: string }) {
  const t = useTheme();
  return (
    <Pressy
      accessibilityLabel="Retry"
      testID={testID}
      onPress={onPress}
      style={{
        alignSelf: 'flex-start',
        minHeight: StripMetrics.cell,
        justifyContent: 'center',
        paddingHorizontal: Space.l,
        borderRadius: Radius.m,
        backgroundColor: t.infoFill,
      }}
    >
      <Text style={[Type.systemSubheadline, { color: t.accent, fontWeight: '600' }]}>Retry</Text>
    </Pressy>
  );
}

/** Label with the filled warning triangle in the caution colour, subheadline (failures) or caption (notices). */
export function CautionLabel({
  text,
  size,
  testID,
}: {
  text: string;
  size: 'subheadline' | 'caption';
  testID?: string;
}) {
  const t = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={text}
      testID={testID}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}
    >
      <WarningTriangle color={t.caution} bang={t.night ? '#000000' : '#FFFFFF'} />
      <Text
        style={[size === 'subheadline' ? Type.systemSubheadline : Type.caption, { color: t.caution, flexShrink: 1 }]}
      >
        {text}
      </Text>
    </View>
  );
}

/** The failure state: the caution label, then Retry (`VStack(spacing: Space.xs)`). */
export function FailureBlock({ text, onRetry, testID }: { text: string; onRetry: () => void; testID: string }) {
  return (
    <View testID={testID} style={{ gap: Space.xs }}>
      <CautionLabel text={text} size="subheadline" />
      <RetryButton onPress={onRetry} testID={`${testID}-retry`} />
    </View>
  );
}
