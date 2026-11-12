// ColumnHeader (efb-212/Views/Log/AirportColumnView.swift): the 60 pt header row every strip column starts with, a
// "Log" back button then the column's title content, on the secondary paper with a hairline under it.
import type { ReactNode } from 'react';
import { View, Text } from 'react-native';
import { Chevron } from '../Icons';
import { ColumnRule, Pressy, useTheme } from '../Primitives';
import { useAppStore } from '../state/appStore';
import { Space, StripMetrics, Type } from '../tokens';

export function ColumnHeader({ children }: { children: ReactNode }) {
  const t = useTheme();
  const setStripColumn = useAppStore((s) => s.setStripColumn);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: Space.s,
        paddingHorizontal: Space.s,
        minHeight: StripMetrics.cell,
        backgroundColor: t.paperSecondary,
      }}
    >
      <Pressy
        accessibilityLabel="Back to flight log"
        testID="column-back-to-log"
        onPress={() => setStripColumn('log')}
        style={{
          minWidth: StripMetrics.cell,
          minHeight: StripMetrics.cell,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 11,
        }}
      >
        <Chevron dir="left" color={t.ink} />
        <Text style={[Type.label, { color: t.ink }]}>Log</Text>
      </Pressy>
      <View style={{ flex: 1 }}>{children}</View>
      <ColumnRule style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }} />
    </View>
  );
}
