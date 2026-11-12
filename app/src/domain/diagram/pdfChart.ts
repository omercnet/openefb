// Logic of Views/Map/ChartPDFView.swift: load state (loading, loaded, failed with retry) and the expiry banner. Rendering
// is the platform viewer (react-native-pdf, ui/map/ChartPdfView.tsx); fetching the PDF is the chart-pack service.
//
// Reconciled with S1c: the chart is S1c's `TerminalChart`; adapters/terminalPdfSource.ts adapts the terminal procedure service.
import type { TerminalChart } from '../../services/terminal/dtpp';
import { evaluateFreshness, freshnessRank } from '../core';

/** S1c's terminal chart (one d-TPP PDF). */
export type PdfChartRef = TerminalChart;

export interface ChartPdfSource {
  /** Local file uri of the chart PDF, downloading it when needed. Rejects on failure. */
  pdfUri(chart: PdfChartRef): Promise<string>;
  /** End of the chart's cycle (epoch ms), or null for an unknown cycle code. */
  cycleExpiry(cycle: string): number | null;
}

export type PdfLoadState = { kind: 'loading' } | { kind: 'loaded'; uri: string } | { kind: 'failed'; message: string };

export const PDF_OPEN_FAILED = 'The chart file could not be opened. Retry downloads it again.';

const messageOf = (e: unknown): string => (e instanceof Error && e.message ? e.message : String(e));

export class PdfChartController {
  private state: PdfLoadState = { kind: 'loading' };
  private token = 0;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly source: ChartPdfSource,
    private chart: PdfChartRef,
  ) {}

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getSnapshot = (): PdfLoadState => this.state;

  private set(state: PdfLoadState): void {
    this.state = state;
    for (const l of [...this.listeners]) l();
  }

  /** Loads (or retries) the chart. A newer load, or showing another chart, makes an older result a no-op. */
  async load(chart: PdfChartRef = this.chart): Promise<void> {
    this.chart = chart;
    const token = ++this.token;
    this.set({ kind: 'loading' });
    try {
      const uri = await this.source.pdfUri(chart);
      if (token === this.token) this.set({ kind: 'loaded', uri });
    } catch (e) {
      if (token === this.token) this.set({ kind: 'failed', message: messageOf(e) });
    }
  }

  /** The viewer reported it cannot open the file (corrupt or truncated download). */
  openFailed(): void {
    if (this.state.kind === 'loaded') this.set({ kind: 'failed', message: PDF_OPEN_FAILED });
  }

  dispose(): void {
    this.token += 1;
    this.listeners.clear();
  }
}

export interface ExpiryBanner {
  text: string;
  severity: 'caution' | 'warning';
}

const formatDate = (ms: number): string =>
  new Date(ms).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** The chart's own cycle decides: expired charts say so, and near expiry says so too. Null when fresh or unknown. */
export function expiryBanner(cycle: string, cycleExpiry: number | null, nowMs: number): ExpiryBanner | null {
  if (cycleExpiry === null) return null;
  const f = evaluateFreshness('chartCycle', { validUntil: cycleExpiry, now: nowMs });
  if (freshnessRank(f.level) < freshnessRank('old')) return null;
  if (nowMs > cycleExpiry)
    return { text: `EXPIRED: cycle ${cycle} ended ${formatDate(cycleExpiry)}`, severity: 'warning' };
  return { text: `Cycle ${cycle} ${f.text.toLowerCase()}`, severity: 'caution' };
}
