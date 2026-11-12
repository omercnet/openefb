// Settings > Region (Israel): the official CAAI chart row and the aerodrome diagram row
// (Views/Settings/IsraelChartDownloadSection.swift, IsraelDiagramDownloadSection.swift). Wording and button rules are in
// domain/settings/israelPacks.ts; these views only lay them out.
import { Text, View } from 'react-native';
import {
  israelChartActions,
  israelChartDetailLine,
  israelDiagramButtonTitle,
  israelDiagramShowsDownload,
  israelDiagramSummaryFor,
  progressPercent,
} from '../../domain/settings/israelPacks';
import type { IsraelChartStoreLike, IsraelDiagramStoreLike } from '../../domain/settings/packStores';
import { FormSection, InlineButton, ProgressBar, RowFrame } from '../form/Form';
import { ArrowDownCircleFill } from '../form/FormIcons';
import { FormType, toneColor } from '../form/formStyle';
import { WarningTriangle } from '../Icons';
import { useTheme } from '../Primitives';
import { usePackState } from '../state/useSettings';

const CHART_FOOTER =
  'The official CAAI CVFR low-level routes chart, converted and checked by Kanaf before release. ' +
  'Chart \u00A9 CAAI; base map \u00A9 Mapa Ltd. Supplemental reference only.';
const DIAGRAM_FOOTER =
  'Official CAAI aerodrome charts. Diagrams \u00A9 CAAI. Supplemental reference only. ' +
  'Street map packs are under Offline Maps.';

const column = { flexDirection: 'column', alignItems: 'stretch', gap: 6, paddingVertical: 12 } as const;

function Footnote({
  text,
  tone = 'secondary',
  testID,
}: {
  text: string;
  tone?: 'secondary' | 'caution';
  testID?: string;
}) {
  const t = useTheme();
  return (
    <Text testID={testID} style={[FormType.footnote, { color: toneColor(t, tone) }]}>
      {text}
    </Text>
  );
}

function ErrorLabel({ message, testID }: { message: string; testID: string }) {
  const t = useTheme();
  return (
    <View accessible testID={testID} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <WarningTriangle color={t.caution} bang={t.activeCell} />
      <Text style={[FormType.footnote, { flex: 1, color: t.primaryText }]}>{message}</Text>
    </View>
  );
}

function Downloading({ fraction }: { fraction: number }) {
  const percent = progressPercent(fraction);
  return (
    <>
      <ProgressBar percent={percent} />
      <Footnote text={`${percent}% \u00B7 downloading`} />
    </>
  );
}

export function IsraelChartSection({
  store,
  formatBytes,
}: {
  store: IsraelChartStoreLike;
  formatBytes: (bytes: number) => string;
}) {
  const t = useTheme();
  const s = usePackState(store);
  const actions = israelChartActions(s);
  return (
    <FormSection header="Official CAAI CVFR chart" footer={CHART_FOOTER}>
      <RowFrame testID="israel-chart-row" style={column}>
        <Text style={[FormType.body, { color: t.primaryText }]}>Official CAAI CVFR chart</Text>
        <Footnote testID="israel-chart-detail" text={israelChartDetailLine(s, formatBytes)} />
        {s.downloadProgress !== null ? (
          <Downloading fraction={s.downloadProgress} />
        ) : s.pausedProgress !== null ? (
          <Footnote
            text={`Paused at ${progressPercent(s.pausedProgress)}%. Download continues from where it stopped.`}
          />
        ) : null}
        {s.status.kind === 'updateAvailable' ? (
          <View accessible testID="israel-chart-update" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <ArrowDownCircleFill color={t.caution} arrow={t.activeCell} />
            <Footnote tone="caution" text={`Newer edition available: ${s.status.latestLabel}`} />
          </View>
        ) : null}
        {s.errorMessage !== null ? <ErrorLabel message={s.errorMessage} testID="israel-chart-error" /> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
          {actions.pause ? (
            <InlineButton title="Pause" onPress={() => store.pauseDownload()} />
          ) : actions.download !== null ? (
            <InlineButton
              title={actions.download}
              onPress={() => store.startDownload()}
              testID="israel-chart-download"
            />
          ) : (
            <View />
          )}
          {actions.remove ? (
            <InlineButton title="Delete" tone="warning" onPress={() => store.remove()} testID="israel-chart-delete" />
          ) : null}
        </View>
      </RowFrame>
    </FormSection>
  );
}

export function IsraelDiagramSection({ store }: { store: IsraelDiagramStoreLike }) {
  const t = useTheme();
  const s = usePackState(store);
  const summary = israelDiagramSummaryFor(s);
  return (
    <FormSection footer={DIAGRAM_FOOTER}>
      <RowFrame testID="israel-diagrams-row" style={column}>
        <Text style={[FormType.body, { color: t.primaryText }]}>Aerodrome diagrams</Text>
        <Footnote testID="israel-diagrams-detail" text={summary.detail} />
        {summary.placed !== null ? <Footnote testID="israel-diagrams-placed" text={summary.placed} /> : null}
        {s.downloadProgress !== null ? <Downloading fraction={s.downloadProgress} /> : null}
        {s.errorMessage !== null ? <ErrorLabel message={s.errorMessage} testID="israel-diagrams-error" /> : null}
        {israelDiagramShowsDownload(s) ? (
          <View style={{ alignItems: 'flex-start' }}>
            <InlineButton
              title={israelDiagramButtonTitle(s)}
              onPress={() => store.startDownload()}
              testID="israel-diagrams-download"
            />
          </View>
        ) : null}
      </RowFrame>
    </FormSection>
  );
}
