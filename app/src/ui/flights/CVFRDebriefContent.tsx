// CVFRDebriefContent (efb-212/Views/Flights/CVFRDebriefContent.swift): the CVFR section of Flight Details: the flight unrolled on one
// distance axis, the per-leg altitude adherence against the published altitude, reporting-point passage and plain-language
// observations. All the numbers come from the L5 builder, so the section shows even where there is no AI debrief.
import { Text, View } from 'react-native';
import type { CVFRDebrief } from '../../domain/debrief/cvfrDebrief';
import {
  CVFR_LEG_HEADERS,
  CVFR_POINT_HEADERS,
  cvfrLegRows,
  cvfrNote,
  cvfrPointRows,
} from '../../domain/debrief/cvfrView';
import { FormType } from '../form/formStyle';
import { WarningTriangle } from '../Icons';
import { useTheme } from '../Primitives';
import { CurvePath } from './icons';
import { CVFRDebriefProfile } from './CVFRDebriefProfile';

function HeaderRow({ titles }: { titles: readonly string[] }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 8, paddingBottom: 4 }}>
      {titles.map((title) => (
        <Text key={title} style={[FormType.caption, { flex: 1, fontWeight: '700', color: t.secondaryText }]}>
          {title}
        </Text>
      ))}
    </View>
  );
}

function Rule() {
  const t = useTheme();
  return <View style={{ height: 1, backgroundColor: t.rule }} />;
}

/** One cell: a column of equal width, left aligned. */
const cell = { flex: 1 } as const;

function LegsTable({ debrief }: { debrief: CVFRDebrief }) {
  const t = useTheme();
  return (
    <View testID="cvfr-legs">
      <HeaderRow titles={CVFR_LEG_HEADERS} />
      {cvfrLegRows(debrief).map((row) => (
        <View key={row.id}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingVertical: 8 }}>
            <View style={[cell, { gap: 2 }]}>
              <Text style={[FormType.body, { fontWeight: '700', color: t.primaryText }]}>{row.route}</Text>
              <Text style={[FormType.caption, { color: t.secondaryText }]}>{row.times}</Text>
            </View>
            <Text style={[FormType.subheadline, cell, { color: t.primaryText }]}>{row.published}</Text>
            {row.adherence ? (
              <>
                {/* Amber below 80% within +-300 ft: feedback, not a hazard warning, so never red; the triangle keeps it from being colour only. */}
                <View accessible style={[cell, { flexDirection: 'row', alignItems: 'center', gap: 4 }]}>
                  {row.adherence.low ? (
                    <View accessibilityElementsHidden importantForAccessibility="no">
                      <WarningTriangle color={t.caution} bang={t.paper} />
                    </View>
                  ) : null}
                  <Text style={[FormType.subheadline, { color: row.adherence.low ? t.caution : t.primaryText }]}>
                    {row.adherence.text}
                  </Text>
                </View>
                <Text style={[FormType.subheadline, cell, { color: t.primaryText }]}>{row.maxDeviation}</Text>
              </>
            ) : (
              <>
                <Text style={[FormType.subheadline, cell, { color: t.secondaryText }]}>not measured</Text>
                <Text style={[FormType.subheadline, cell, { color: t.primaryText }]}>---</Text>
              </>
            )}
          </View>
          <Rule />
        </View>
      ))}
    </View>
  );
}

function PointsTable({ debrief }: { debrief: CVFRDebrief }) {
  const t = useTheme();
  return (
    <View testID="cvfr-points">
      <HeaderRow titles={CVFR_POINT_HEADERS} />
      {cvfrPointRows(debrief).map((row) => (
        <View key={row.id}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingVertical: 8 }}>
            <View style={[cell, { gap: 2 }]}>
              <Text style={[FormType.body, { fontWeight: '700', color: t.primaryText }]}>{row.code}</Text>
              {row.name ? <Text style={[FormType.caption, { color: t.secondaryText }]}>{row.name}</Text> : null}
            </View>
            <Text style={[FormType.subheadline, cell, { color: t.primaryText }]}>{row.time}</Text>
            <Text style={[FormType.subheadline, cell, { color: t.primaryText }]}>{row.closest}</Text>
            <Text
              accessibilityLabel={row.reported.spoken}
              style={[FormType.subheadline, cell, { color: row.reported.spoken ? t.secondaryText : t.primaryText }]}
            >
              {row.reported.text}
            </Text>
          </View>
          <Rule />
        </View>
      ))}
    </View>
  );
}

export function CVFRDebriefContent({ debrief }: { debrief: CVFRDebrief }) {
  const t = useTheme();
  return (
    <View testID="cvfr-debrief" style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View accessibilityElementsHidden importantForAccessibility="no">
          <CurvePath color={t.primaryText} />
        </View>
        <Text accessibilityRole="header" style={[FormType.headline, { color: t.primaryText }]}>
          CVFR Route
        </Text>
      </View>
      <Text style={[FormType.footnote, { color: t.secondaryText }]}>{cvfrNote(debrief)}</Text>
      {debrief.observations.length > 0 ? (
        <View testID="cvfr-observations" style={{ gap: 6 }}>
          {debrief.observations.map((line) => (
            <Text key={line} style={[FormType.subheadline, { color: t.primaryText }]}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}
      {/* The flight unrolled on one distance axis; the table below keeps the exact numbers. */}
      <CVFRDebriefProfile debrief={debrief} />
      <LegsTable debrief={debrief} />
      {debrief.points.length > 0 ? <PointsTable debrief={debrief} /> : null}
    </View>
  );
}
