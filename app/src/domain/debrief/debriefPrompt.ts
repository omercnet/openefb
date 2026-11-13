import { promptFacts, type CVFRDebrief } from './cvfrDebrief';
import { buildPromptForFlight, type DebriefDataSource } from './flightSummaryBuilder';
import type { FlightMetadata } from './types';

/**
 * The prompt for a flight's AI debrief (DebriefView.generateDebrief): the L5 summary of the recording, with the CVFR facts added
 * when the flight was flown on the Israel network. A CVFR debrief that cannot be loaded leaves the facts out (Swift's loadBundled
 * swallows its errors); a recording database that cannot be read fails the prompt, so the pilot can try again.
 */
export async function debriefPrompt(args: {
  flightId: string;
  metadata: FlightMetadata;
  source: DebriefDataSource;
  loadCvfr(): Promise<CVFRDebrief | null>;
}): Promise<string> {
  const cvfr = await args.loadCvfr().catch(() => null);
  const facts = cvfr === null ? null : promptFacts(cvfr);
  return buildPromptForFlight(args.flightId, args.source, args.metadata, facts);
}
