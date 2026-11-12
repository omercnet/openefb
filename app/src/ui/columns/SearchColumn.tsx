// SearchColumnView (efb-212/Views/Log/SearchColumnView.swift): airport search in the strip column, a search field focused
// when the column opens and 60pt result rows. Selecting a result hands its identifier to `onSelect` and clears the search;
// closing the column keeps the query and results (the search lives in `searchSlice`).
import { useEffect } from 'react';
import { AccessibilityInfo, ActivityIndicator, Platform, ScrollView, Text, View } from 'react-native';
import type { Airport } from '../../domain/core';
import { SearchBar } from '../components/Components';
import { ColumnRule, Pressy, useTheme } from '../Primitives';
import { appStore } from '../state/appStore';
import { Space, StripMetrics, Type } from '../tokens';
import { ColumnHeader } from './ColumnHeader';
import { isSearchableQuery, useAirportSearch } from './search/search';

export function SearchColumn({
  onSelect = appStore.getState().showAirport,
}: { onSelect?: (icao: string) => void } = {}) {
  const t = useTheme();
  const search = useAirportSearch();
  const caption = [Type.caption, { color: t.inkSecondary, padding: Space.l }];
  let body = null;
  if (search.results.length > 0) {
    body = search.results.map((airport) => (
      <View key={airport.icao}>
        <ResultRow
          airport={airport}
          onPress={() => {
            onSelect(airport.icao);
            search.clear();
          }}
        />
        <ColumnRule />
      </View>
    ));
  } else if (search.isSearching) {
    body = (
      <View
        accessible
        accessibilityLabel="Searching"
        style={{ flexDirection: 'row', alignItems: 'center', gap: Space.s, padding: Space.l }}
      >
        <ActivityIndicator color={t.inkSecondary} />
        <Text style={[Type.caption, { color: t.inkSecondary }]}>{'Searching\u2026'}</Text>
      </View>
    );
  } else if (search.failed) {
    body = (
      <Text accessibilityRole="alert" testID="search-failed" style={caption}>
        Search is unavailable right now
      </Text>
    );
  } else if (isSearchableQuery(search.query.trim())) {
    body = (
      // Android announces it through the live region; iOS has none, so an effect announces it (below).
      <Text testID="search-no-results" accessibilityLiveRegion="polite" style={caption}>
        {`No airports match \u201C${search.query}\u201D`}
      </Text>
    );
  }
  const noResults =
    !search.isSearching && !search.failed && search.results.length === 0 && isSearchableQuery(search.query.trim());
  const noResultsText = `No airports match ${search.query}`;
  useEffect(() => {
    // Focus stays in the field, so the empty state is announced when it begins (iOS; Android has the live region).
    if (noResults && Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(noResultsText);
  }, [noResults, noResultsText]);
  return (
    <View style={{ flex: 1, backgroundColor: t.paper }}>
      <ColumnHeader>
        <Text accessibilityRole="header" style={[Type.title, { color: t.ink }]}>
          Search
        </Text>
      </ColumnHeader>
      <View style={{ padding: Space.l }}>
        <SearchBar
          text={search.query}
          onChangeText={search.setQuery}
          placeholder="ICAO, name or city"
          accessibilityLabel="Search airports"
          focusOnAppear
          onSubmit={search.submit}
        />
      </View>
      <ColumnRule />
      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
        {body}
      </ScrollView>
    </View>
  );
}

function ResultRow({ airport, onPress }: { airport: Airport; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressy
      accessibilityLabel={`${airport.icao}, ${airport.name}`}
      accessibilityHint="Shows airport information"
      testID={`search-result-${airport.icao}`}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: Space.m,
        paddingHorizontal: Space.l,
        paddingVertical: Space.s,
        minHeight: StripMetrics.cell,
      }}
    >
      <Text numberOfLines={1} style={[Type.rowIdent, { color: t.airspace }]}>
        {airport.icao}
      </Text>
      <Text style={[Type.body, { flex: 1, color: t.inkSecondary, textAlign: 'left' }]}>{airport.name}</Text>
    </Pressy>
  );
}
