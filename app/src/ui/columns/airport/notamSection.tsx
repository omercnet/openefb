// NotamSection (efb-212/Views/Map/NotamSection.swift): the airport's effective NOTAMs, closures first and highlighted, tap to
// expand. Loading, no key, rejected key, failed (Retry) and loaded (refresh failed, incomplete, empty, rows) are its states.
import { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { evaluateFreshness } from '../../../domain/core/freshness';
import { closureLabel, effectiveWindowDescription, notamClosure, type Notam } from '../../../services/notam';
import { DataAgeBadge } from '../../components/Components';
import { Chevron } from '../../Icons';
import { Pressy, useTheme } from '../../Primitives';
import { Radius, Space, Type } from '../../tokens';
import { NOTAM_KEY_HINT } from './logic';
import { CautionLine, Note, NotamKeySection, RetryButton, SystemHeader, type AirportSectionProps } from './sections';

export const NOTAM_REFRESH_FAILED =
  'Refresh failed. Showing the copy from the last successful download; check NOTAMs again before flying.';
export const NOTAM_INCOMPLETE = 'List incomplete: too many NOTAMs to download. Closures may be missing.';

function NotamRow({ notam, expanded, onToggle }: { notam: Notam; expanded: boolean; onToggle: () => void }) {
  const t = useTheme();
  const closure = notamClosure(notam);
  return (
    <Pressy
      accessibilityLabel={`${closure !== null ? `${closureLabel(closure)}. ` : ''}NOTAM ${notam.number}. ${effectiveWindowDescription(notam)}. ${expanded && notam.fullText ? notam.fullText : notam.text}`}
      accessibilityHint={expanded ? 'Collapse NOTAM' : 'Expand NOTAM'}
      accessibilityState={{ expanded }}
      onPress={onToggle}
      testID={`notam-${notam.id}`}
      style={{
        minHeight: 44,
        padding: 8,
        gap: 4,
        borderRadius: Radius.s,
        backgroundColor: closure !== null ? `${t.warning}1F` : `${t.secondaryText}14`,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {closure !== null ? (
          <View style={{ backgroundColor: t.warning, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 }}>
            <Text style={[Type.caption, { color: t.onWarning, fontWeight: '700' }]}>{closureLabel(closure)}</Text>
          </View>
        ) : null}
        <Text style={[Type.caption, { color: t.ink, fontWeight: '600' }]}>{notam.number}</Text>
        <View style={{ flex: 1 }} />
        <View style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}>
          <Chevron dir="down" color={t.secondaryText} />
        </View>
      </View>
      <Text style={[Type.caption, { color: t.inkSecondary }]}>{effectiveWindowDescription(notam)}</Text>
      <Text numberOfLines={expanded ? undefined : 2} style={[Type.systemSubheadline, { color: t.ink }]}>
        {notam.text}
      </Text>
      {expanded && notam.fullText !== null && notam.fullText !== notam.text ? (
        <Text selectable style={[Type.data, { color: t.inkSecondary }]}>
          {notam.fullText}
        </Text>
      ) : null}
    </Pressy>
  );
}

function NotamAge({ fetchedAt, now }: { fetchedAt: number; now: number }) {
  const freshness = evaluateFreshness('notam', { observed: fetchedAt, now });
  return <DataAgeBadge level={freshness.level} text={freshness.text} productName="NOTAM" />;
}

/** The NOTAMS section: the key hint while the column never asked for a list, else the list and its states. */
export function NotamsSection({ model }: AirportSectionProps) {
  const state = model.data?.notams;
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  if (!state) return <NotamKeySection />;
  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  return (
    <View style={{ gap: Space.s }} testID="airport-notams">
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <SystemHeader title="NOTAMS" />
        {state.kind === 'loaded' ? <NotamAge fetchedAt={state.report.fetchedAt} now={model.now} /> : null}
      </View>
      {state.kind === 'loading' ? (
        <View testID="airport-notams-loading" style={{ alignSelf: 'flex-start' }}>
          <ActivityIndicator size="small" />
        </View>
      ) : null}
      {state.kind === 'notConfigured' ? <Note testID="airport-notam-key-hint">{NOTAM_KEY_HINT}</Note> : null}
      {state.kind === 'credentialsRejected' ? (
        <CautionLine text={state.message} testID="airport-notam-rejected" />
      ) : null}
      {state.kind === 'failed' ? (
        <View style={{ gap: 4 }} testID="airport-notams-failed">
          <Note>{`NOTAMs not loaded: ${state.message}`}</Note>
          <RetryButton onPress={model.retryNotams} testID="airport-notams-retry" />
        </View>
      ) : null}
      {state.kind === 'loaded' ? (
        <>
          {state.report.refreshFailed ? (
            <>
              <CautionLine text={NOTAM_REFRESH_FAILED} testID="notam-refresh-failed" />
              <RetryButton onPress={model.retryNotams} testID="airport-notams-retry" />
            </>
          ) : null}
          {state.report.isIncomplete ? <CautionLine text={NOTAM_INCOMPLETE} testID="notam-incomplete" /> : null}
          {state.report.notams.length === 0 ? (
            <Note testID="airport-notams-empty">
              {state.report.refreshFailed
                ? `No active NOTAMs in the saved copy for ${state.report.location}`
                : `No active NOTAMs for ${state.report.location}`}
            </Note>
          ) : (
            <View style={{ gap: 6 }}>
              {state.report.notams.map((notam) => (
                <NotamRow
                  key={notam.id}
                  notam={notam}
                  expanded={expanded.has(notam.id)}
                  onToggle={() => toggle(notam.id)}
                />
              ))}
            </View>
          )}
        </>
      ) : null}
    </View>
  );
}
