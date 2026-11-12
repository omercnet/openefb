// FlightLogFlown (efb-212/Views/Log/FlightLogRows.swift): the departure and the route points already passed.
import { Text, View } from 'react-native';
import { departureCode } from '../../domain/route';
import { ColumnRule, SectionBand, useTheme } from '../Primitives';
import { Space, Type, tracked } from '../tokens';
import { useFlightLog } from './hooks';
import { followedRoute, type NavState } from './logic';

/** Departure first, then the points passed on the followed route; a US plan shows its departure only. */
export function flownCodes(nav: NavState): string[] {
  const route = followedRoute(nav);
  const departure = route && departureCode(route);
  if (route && departure != null) return [departure, ...route.legs.slice(0, route.currentLeg).map((l) => l.toCode)];
  if (nav.directTo == null && nav.activeFlightPlan && nav.planDeparture != null) return [nav.planDeparture];
  return [];
}

export function FlightLogFlown() {
  const t = useTheme();
  const { data } = useFlightLog();
  const rows = flownCodes(data);
  if (rows.length === 0) return null;
  return (
    <View>
      <SectionBand title="Flown" />
      {rows.map((code, index) => (
        <View key={index}>
          {index > 0 ? <ColumnRule /> : null}
          <View
            accessible
            accessibilityLabel={index === 0 ? `Departed ${code}` : `Passed ${code}`}
            style={{
              flexDirection: 'row',
              alignItems: 'baseline',
              gap: Space.m,
              paddingHorizontal: Space.m,
              paddingVertical: Space.s,
            }}
          >
            <Text style={[Type.rowIdent, { color: t.inkSecondary }]}>{code}</Text>
            {index === 0 ? <Text style={[Type.stripLabel, tracked, { color: t.inkSecondary }]}>DEP</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}
