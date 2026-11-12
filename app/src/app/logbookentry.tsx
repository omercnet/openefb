import { LogbookEntryCapture } from '../ui/screens/ProfileCaptures';

/** Route logbookentry: an editable logbook entry on fakes, for the fidelity capture and the web preview. */
export default function LogbookEntryRoute() {
  return <LogbookEntryCapture locked={false} />;
}
