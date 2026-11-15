// Views/Planning/FlightPlanSummaryCard.swift: a compact card with the route header (DEP -> DEST) and the plan's distance
// (nm), ETE (h:mm) and, with an aircraft fuel burn, fuel (gal). The planner shows it under the airport fields; the map can
// overlay it. The text comes from logic.ts (`summaryMetrics`, `routeLabel`).
import { Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { ArrowRight } from './planIcons';
import { useTheme } from '../../Primitives';
import { Radius, Space, type Theme } from '../../tokens';
import { routeLabel, summaryMetrics } from './logic';

export interface FlightPlanSummaryCardProps {
  /** Nautical miles. */
  distanceNM: number;
  /** Pre-formatted "h:mm" (logic.ts `formattedETE`). */
  ete: string;
  /** Gallons; null without an aircraft profile fuel burn, which leaves the fuel cell out. */
  fuelGallons: number | null;
  /** ICAO identifier. */
  departure: string;
  /** ICAO identifier. */
  destination: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** SF .headline bold, .title3 bold and .caption. */
const HEADLINE: TextStyle = { fontSize: 17, lineHeight: 22, fontWeight: '700' };
const TITLE3: TextStyle = { fontSize: 20, lineHeight: 25, fontWeight: '700' };
const CAPTION: TextStyle = { fontSize: 12, lineHeight: 16 };

/** `.regularMaterial` over the form: a light (dark at night) grey, opaque enough to read over the map too. */
export const materialFill = (t: Theme) => (t.night ? 'rgba(37,37,37,0.94)' : 'rgba(242,242,247,0.94)');

export function FlightPlanSummaryCard({
  distanceNM,
  ete,
  fuelGallons,
  departure,
  destination,
  style,
  testID = 'fp-summary',
}: FlightPlanSummaryCardProps) {
  const t = useTheme();
  return (
    <View
      testID={testID}
      style={[
        {
          padding: Space.l,
          gap: Space.s,
          borderRadius: Radius.l,
          backgroundColor: materialFill(t),
          shadowColor: '#000',
          shadowOpacity: 0.33,
          shadowRadius: 4,
          shadowOffset: { width: 0, height: 0 },
          elevation: 3,
        },
        style,
      ]}
    >
      <View
        testID="fp-summary-route"
        accessible
        accessibilityLabel={routeLabel(departure, destination)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: Space.s }}
      >
        <Text style={[HEADLINE, { color: t.primaryText }]}>{departure}</Text>
        <ArrowRight color={t.secondaryText} />
        <Text style={[HEADLINE, { color: t.primaryText }]}>{destination}</Text>
      </View>
      <View style={{ height: 1, backgroundColor: t.rule }} />
      <View style={{ flexDirection: 'row', gap: Space.l }}>
        {summaryMetrics({ distanceNM, ete, fuelGallons }).map((metric) => (
          <View
            key={metric.unit}
            testID={`fp-summary-${metric.unit.toLowerCase()}`}
            accessible
            accessibilityLabel={metric.label}
            accessibilityValue={{ text: metric.accessibilityValue }}
            style={{ alignItems: 'center' }}
          >
            <Text style={[TITLE3, { color: t.primaryText, fontVariant: ['tabular-nums'] }]}>{metric.value}</Text>
            <Text style={[CAPTION, { color: t.secondaryText }]}>{metric.unit}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
