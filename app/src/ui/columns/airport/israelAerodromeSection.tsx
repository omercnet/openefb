// IsraelAerodromeSection (efb-212/Views/Map/IsraelAerodromeSection.swift): what the curated AIP data says about an Israeli
// aerodrome: review state, operations (PPR, hours, circuit), runways in metres, remarks and where each value came from.
import { Text, View } from 'react-native';
import type { IsraelAerodrome } from '../../../data/aviation/israelTypes';
import { WarningTriangle } from '../../Icons';
import { useTheme } from '../../Primitives';
import { Radius, Space, Type } from '../../tokens';
import {
  UNREVIEWED_TEXT,
  circuitText,
  dimensions,
  groupLabel,
  isReviewed,
  pprText,
  spoken,
  surfaceAndHeading,
  useNote,
} from './israelAerodromeLogic';
import { Note, SystemHeader, type AirportSectionProps } from './sections';

const LABEL_COLUMN = 72;

function Row({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View accessible style={{ flexDirection: 'row', gap: Space.m, alignItems: 'baseline' }}>
      <Text style={[Type.caption, { color: t.secondaryText, minWidth: LABEL_COLUMN }]}>{label}</Text>
      <Text style={[Type.systemSubheadline, { color: t.ink, flex: 1 }]}>{value}</Text>
    </View>
  );
}

function SourceLine({ label, source }: { label: string; source: string | null }) {
  const t = useTheme();
  return source === null ? null : (
    <Text style={[Type.caption, { color: t.secondaryText }]}>{`${label}: ${source}`}</Text>
  );
}

export function IsraelAerodromeSection({ aerodrome }: { aerodrome: IsraelAerodrome }) {
  const t = useTheme();
  const reviewed = isReviewed(aerodrome);
  const circuit = circuitText(aerodrome);
  const note = useNote(aerodrome.use);
  return (
    <View style={{ gap: Space.xl }} testID="israel-aerodrome-section">
      {!reviewed ? (
        <View
          accessible
          testID="israel-unreviewed-note"
          style={{ gap: Space.xs, padding: Space.m, borderRadius: Radius.m, backgroundColor: t.infoFill }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <WarningTriangle color={t.caution} bang={t.night ? '#000000' : '#FFFFFF'} />
            <Text style={[Type.label, { color: t.caution }]}>Unreviewed data</Text>
          </View>
          <Text style={[Type.caption, { color: t.caution }]}>{UNREVIEWED_TEXT}</Text>
          {aerodrome.uncertainGroups.length > 0 ? (
            <Text style={[Type.caption, { color: t.caution, fontWeight: '600' }]}>
              {`The curator is unsure about: ${aerodrome.uncertainGroups.map(groupLabel).join(', ')}.`}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={{ gap: Space.s }}>
        <SystemHeader title="OPERATIONS" />
        <Text style={[Type.body, { color: t.secondaryText }]}>{aerodrome.nameHebrew}</Text>
        {note !== null ? <Text style={[Type.label, { color: t.caution }]}>{note}</Text> : null}
        <Row label="PPR" value={pprText(aerodrome)} />
        {aerodrome.hours !== null ? <Row label="Hours" value={aerodrome.hours} /> : null}
        {circuit !== null ? <Row label="Circuit" value={circuit} /> : null}
      </View>

      <View style={{ gap: Space.s }}>
        <SystemHeader title="RUNWAYS" />
        {aerodrome.runways.length === 0 ? <Note testID="israel-no-runways">No runway data published</Note> : null}
        {aerodrome.runways.map((runway) => (
          <View
            key={runway.id}
            accessible
            accessibilityLabel={`Runway ${runway.designator}`}
            accessibilityValue={{ text: spoken(runway) }}
            testID="israel-runway"
            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Space.m, alignItems: 'baseline' }}
          >
            <Text style={[Type.dataEmphasis, { color: t.ink, minWidth: LABEL_COLUMN }]}>
              {runway.designator === '?' ? 'RWY ?' : runway.designator}
            </Text>
            <Text style={[Type.data, { color: t.ink }]}>{dimensions(runway)}</Text>
            <Text style={[Type.body, { color: t.secondaryText }]}>{surfaceAndHeading(runway)}</Text>
          </View>
        ))}
      </View>

      {aerodrome.remarks !== null ? (
        <View style={{ gap: Space.s }}>
          <SystemHeader title="REMARKS" />
          <Text style={[Type.body, { color: t.ink }]}>{aerodrome.remarks}</Text>
        </View>
      ) : null}

      <View style={{ gap: Space.xs }}>
        <SystemHeader title="SOURCES" />
        <SourceLine label="Position, elevation" source={aerodrome.sources.identity} />
        <SourceLine label="Runways" source={aerodrome.sources.runways} />
        <SourceLine label="Frequencies" source={aerodrome.sources.frequencies} />
        <SourceLine label="Circuit" source={aerodrome.sources.circuit} />
        <SourceLine label="Hours" source={aerodrome.sources.hours} />
        <SourceLine label="Remarks, PPR" source={aerodrome.sources.remarks} />
        <Text
          style={[Type.caption, { color: reviewed ? t.secondaryText : t.caution, paddingTop: Space.xs }]}
          testID="israel-review-state"
        >
          {reviewed ? 'Reviewed against the AIP.' : 'Not yet reviewed against the AIP.'}
        </Text>
      </View>
    </View>
  );
}

/** The registry entry: the aerodrome record when the column loaded one (it replaces the generic runways). */
export function IsraelAerodromeEntry({ model }: AirportSectionProps) {
  const aerodrome = model.data?.aerodrome;
  return aerodrome ? <IsraelAerodromeSection aerodrome={aerodrome} /> : null;
}
