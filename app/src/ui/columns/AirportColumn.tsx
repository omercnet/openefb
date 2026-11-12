// AirportColumnView (efb-212/Views/Log/AirportColumnView.swift): the shared header with the airport's title over the
// scrolling body: Direct, info chips, weather, then `AIRPORT_SECTIONS` each under a rule. Without an airport record the
// region's station still shows its weather; with neither, the column is loading. Data: `useAirportColumn()`.
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { ColumnRule, useTheme } from '../Primitives';
import { Space, Type } from '../tokens';
import { ColumnHeader } from './ColumnHeader';
import {
  AirportTitle,
  DirectButton,
  InfoChipsRow,
  StationOnlyNote,
  WeatherSection,
  shownSections,
  type AirportSectionProps,
} from './airport/sections';
import { useAirportColumn } from './airport/store';

/** The whole airport column: the shared header over the scrolling body. */
export function AirportColumn() {
  const model = useAirportColumn();
  return (
    <>
      <ColumnHeader>
        <AirportTitle model={model} />
      </ColumnHeader>
      <AirportBody model={model} />
    </>
  );
}

function AirportBody({ model }: AirportSectionProps) {
  const t = useTheme();
  if (!model.data?.airport && !model.station) {
    return (
      <View testID="airport-loading" style={{ alignItems: 'center', gap: Space.s, paddingTop: 40 }}>
        <ActivityIndicator color={t.inkSecondary} />
        <Text style={[Type.systemSubheadline, { color: t.secondaryText }]}>Loading airport...</Text>
      </View>
    );
  }
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: Space.l, gap: Space.l }}
      showsVerticalScrollIndicator={false}
      testID="airport-body"
    >
      {model.data?.airport ? (
        <>
          <DirectButton model={model} />
          <InfoChipsRow model={model} />
          <WeatherSection model={model} />
          {shownSections(model).map(({ id, Component }) => (
            <View key={id} style={{ gap: Space.l }}>
              <ColumnRule />
              <Component model={model} />
            </View>
          ))}
        </>
      ) : (
        <>
          <WeatherSection model={model} />
          <StationOnlyNote model={model} />
        </>
      )}
    </ScrollView>
  );
}
