// ChartPdfSource (domain/diagram/pdfChart.ts) over S1c's terminal procedure service: the PDF comes from `pdfPath` (downloaded
// and checked on first use), and the cycle end from the chart's own d-TPP cycle code.
import type { ChartPdfSource } from '../domain/diagram/pdfChart';
import { cycleWithCode } from '../services/terminal/dtpp';
import type { TerminalProcedureServiceLike } from '../services/terminal/terminalProcedureService';

export const fileUri = (path: string): string => (path.startsWith('file://') ? path : `file://${path}`);

export function createTerminalPdfSource(
  service: Pick<TerminalProcedureServiceLike, 'pdfPath'>,
  now: () => number = Date.now,
): ChartPdfSource {
  return {
    async pdfUri(chart) {
      return fileUri(await service.pdfPath(chart));
    },
    cycleExpiry(cycle) {
      return cycleWithCode(cycle, now())?.expirationMs ?? null;
    },
  };
}
