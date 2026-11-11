// DebriefView (efb-212/Views/Flights/DebriefView.swift): the AI debrief of a flight: the narrative summary, the observations of each
// phase, improvements and an overall rating, shown as the model streams them in, with Regenerate. Not shown on Android (owner
// decision Q8). Navigation is the shell's (I1).
import { useEffect, type ReactNode } from 'react';
import { ActivityIndicator, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useStore } from 'zustand';
import {
  debriefErrorText,
  debriefPane,
  executionBadge,
  ratingStars,
  ratingText,
} from '../../domain/debrief/debriefView';
import type { FlightDebrief, PhaseObservation } from '../../domain/debrief/types';
import type { PartialPhaseObservation } from '../../domain/ports/debriefEngine';
import { BorderedButton } from '../components/BorderedButton';
import { NavBar } from '../form/Form';
import { FormType } from '../form/formStyle';
import { WarningTriangle, XmarkCircleFill } from '../Icons';
import { useTheme } from '../Primitives';
import type { DebriefViewStore } from '../state/debriefStore';
import { Radius } from '../tokens';
import { withAlpha } from './alpha';
import {
  ArrowCounterclockwise,
  BrainHead,
  CheckCircleFill,
  DocText,
  Lightbulb,
  ListClipboard,
  Sparkles,
  Star,
} from './icons';

/** The decorative hero glyph: 48 pt, growing with Dynamic Type from the largeTitle size. */
const HERO = 48;

function SectionHeader({ icon, title }: { icon: ReactNode; title: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {icon}
      </View>
      <Text accessibilityRole="header" style={[FormType.headline, { color: t.primaryText }]}>
        {title}
      </Text>
    </View>
  );
}

function Rule() {
  const t = useTheme();
  return <View style={{ height: 1, backgroundColor: t.rule }} />;
}

/** Phase verdict: glyph plus text, so the result never relies on colour alone. */
function ExecutionBadge({ executedWell }: { executedWell: boolean }) {
  const t = useTheme();
  const badge = executionBadge(executedWell);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Text style={[FormType.footnote, { fontWeight: '500', color: t.secondaryText }]}>{badge.text}</Text>
      <View accessibilityElementsHidden importantForAccessibility="no">
        {badge.ok ? (
          <CheckCircleFill color={t.ok} mark={t.paper} />
        ) : (
          <XmarkCircleFill color={t.caution} cross={t.paper} />
        )}
      </View>
    </View>
  );
}

/** One phase: complete (tinted by its verdict), or still being written (every field may be missing). */
function PhaseCard({
  observation,
  streaming,
}: {
  observation: PhaseObservation | PartialPhaseObservation;
  streaming: boolean;
}) {
  const t = useTheme();
  const tint = streaming ? t.fill : withAlpha(observation.executedWell ? t.ok : t.caution, 0.1);
  return (
    <View style={{ gap: 6, padding: 16, borderRadius: Radius.s, backgroundColor: tint }}>
      {observation.phase !== undefined || observation.executedWell !== undefined ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          {observation.phase !== undefined ? (
            <Text style={[FormType.caption, { fontWeight: '700', color: t.secondaryText }]}>
              {observation.phase.toUpperCase()}
            </Text>
          ) : (
            <View />
          )}
          {observation.executedWell !== undefined ? <ExecutionBadge executedWell={observation.executedWell} /> : null}
        </View>
      ) : null}
      {(observation.observations ?? []).map((text, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
          <Text
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={[FormType.subheadline, { color: t.secondaryText }]}
          >
            {'\u2022'}
          </Text>
          <Text style={[FormType.subheadline, { flex: 1, color: t.primaryText }]}>{text}</Text>
        </View>
      ))}
    </View>
  );
}

function Improvements({ items }: { items: readonly string[] }) {
  const t = useTheme();
  return (
    <>
      <SectionHeader icon={<Lightbulb color={t.primaryText} />} title="Improvements" />
      {items.map((text, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
          <View
            style={{ minWidth: 20, alignItems: 'center' }}
            accessibilityElementsHidden
            importantForAccessibility="no"
          >
            <Lightbulb color={t.caution} filled />
          </View>
          <Text style={[FormType.body, { flex: 1, color: t.primaryText }]}>{text}</Text>
        </View>
      ))}
      <Rule />
    </>
  );
}

function Rating({ rating }: { rating: number }) {
  const t = useTheme();
  const text = ratingText(rating);
  return (
    <View style={{ alignItems: 'center', gap: 8 }}>
      <View
        style={{ flexDirection: 'row', gap: 4 }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {ratingStars(rating).map((filled, i) => (
          <Star key={i} filled={filled} color={filled ? t.caution : t.secondaryText} />
        ))}
      </View>
      <Text accessibilityLabel={text.spoken} style={[FormType.subheadline, { color: t.secondaryText }]}>
        {text.text}
      </Text>
    </View>
  );
}

/** The finished debrief. */
function CompletedContent({ debrief }: { debrief: FlightDebrief }) {
  const t = useTheme();
  return (
    <>
      <SectionHeader icon={<DocText color={t.primaryText} />} title="Summary" />
      <Text style={[FormType.body, { color: t.primaryText }]}>{debrief.narrativeSummary}</Text>
      <Rule />
      <SectionHeader icon={<ListClipboard color={t.primaryText} />} title="Phase Observations" />
      {debrief.phaseObservations.map((observation, i) => (
        <PhaseCard key={i} observation={observation} streaming={false} />
      ))}
      <Rule />
      {debrief.improvements.length > 0 ? <Improvements items={debrief.improvements} /> : null}
      <Rating rating={debrief.overallRating} />
    </>
  );
}

/** What the model has written so far: each section appears when it has something in it. */
function StreamingContent({ store }: { store: DebriefViewStore }) {
  const t = useTheme();
  const partial = useStore(store, (s) => s.partial);
  if (partial === null) return null;
  return (
    <>
      {partial.narrativeSummary !== undefined ? (
        <>
          <SectionHeader icon={<DocText color={t.primaryText} />} title="Summary" />
          <Text style={[FormType.body, { color: t.primaryText }]}>{partial.narrativeSummary}</Text>
          <Rule />
        </>
      ) : null}
      {partial.phaseObservations && partial.phaseObservations.length > 0 ? (
        <>
          <SectionHeader icon={<ListClipboard color={t.primaryText} />} title="Phase Observations" />
          {partial.phaseObservations.map((observation, i) => (
            <PhaseCard key={i} observation={observation} streaming />
          ))}
          <Rule />
        </>
      ) : null}
      {partial.improvements && partial.improvements.length > 0 ? <Improvements items={partial.improvements} /> : null}
      {partial.overallRating !== undefined ? <Rating rating={partial.overallRating} /> : null}
    </>
  );
}

export function DebriefScreen({ store, onBack }: { store: DebriefViewStore; onBack?: () => void }) {
  const t = useTheme();
  const { fontScale } = useWindowDimensions();
  const completed = useStore(store, (s) => s.completed);
  const isGenerating = useStore(store, (s) => s.isGenerating);
  const partial = useStore(store, (s) => s.partial);
  const engineError = useStore(store, (s) => s.engineError);
  const promptError = useStore(store, (s) => s.promptError);
  const pane = debriefPane({ completed, isGenerating, partial, engineError, promptError });
  const hero = HERO * Math.min(Math.max(fontScale, 1), 2.5);

  // onAppear: show the debrief saved for the flight, if there is one.
  useEffect(() => {
    void store.getState().loadExisting();
  }, [store]);

  return (
    <View style={{ flex: 1, backgroundColor: t.paper }} testID="debrief-screen">
      <NavBar title="AI Debrief" onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        {pane === 'completed' && completed ? (
          <>
            <CompletedContent debrief={completed} />
            <View style={{ paddingTop: 8, alignItems: 'flex-start' }}>
              <BorderedButton
                title="Regenerate Debrief"
                onPress={() => void store.getState().regenerate()}
                icon={<ArrowCounterclockwise color={t.accent} />}
                testID="debrief-regenerate"
              />
            </View>
          </>
        ) : null}
        {pane === 'streaming' ? (
          <>
            <StreamingContent store={store} />
            <View style={{ paddingTop: 8, alignItems: 'center', gap: 8 }}>
              <ActivityIndicator color={t.secondaryText} />
              <Text style={[FormType.subheadline, { color: t.secondaryText }]}>Generating debrief...</Text>
            </View>
          </>
        ) : null}
        {pane === 'error' ? (
          <View style={{ paddingTop: 32, alignItems: 'center', gap: 16 }}>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <WarningTriangle color={t.caution} bang={t.paper} />
            </View>
            <Text style={[FormType.headline, { color: t.primaryText }]}>Debrief failed</Text>
            <Text style={[FormType.subheadline, { color: t.secondaryText, textAlign: 'center' }]}>
              {debriefErrorText(engineError, promptError)}
            </Text>
            <BorderedButton
              title="Try Again"
              prominent
              onPress={() => void store.getState().generate()}
              icon={<ArrowCounterclockwise color={t.onAccent} />}
              testID="debrief-try-again"
            />
          </View>
        ) : null}
        {pane === 'initial' ? (
          <View style={{ paddingTop: 32, alignItems: 'center', gap: 16 }}>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <BrainHead color={t.secondaryText} size={hero} />
            </View>
            <Text style={[FormType.headline, { color: t.primaryText }]}>Debrief this flight</Text>
            <Text style={[FormType.subheadline, { color: t.secondaryText, textAlign: 'center' }]}>
              Apple Intelligence reviews the GPS track, transcript and flight phases on this iPad. Nothing leaves the
              device.
            </Text>
            <BorderedButton
              title="Generate Debrief"
              prominent
              stretch
              onPress={() => void store.getState().generate()}
              icon={<Sparkles color={t.onAccent} />}
              testID="debrief-generate"
            />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
