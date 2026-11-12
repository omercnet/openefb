// The profile and logbook screens as the fidelity captures and the web preview mount them (routes kanaf-dev://aircraft,
// aircraftedit, pilot, logbookentry, logbooklocked; iOS -KanafScreen). Fakes only; the page switcher stands in for the shell's
// navigation (I1) so the flows can be tried in the preview.
import { useState } from 'react';
import { AircraftEditScreen } from './AircraftEditScreen';
import { AircraftListScreen } from './AircraftListScreen';
import { StripFrame } from './CaptureScreens';
import {
  CAPTURE_AIRCRAFT_ID,
  CAPTURE_CONFIRMED_ENTRY_ID,
  CAPTURE_DRAFT_ENTRY_ID,
  captureProfileStores,
} from './captureProfileFixtures';
import { LogbookEntryScreen } from './LogbookEntryScreen';
import { NightLandingScreen, PilotEditScreen } from './PilotEditScreen';
import { PilotProfileScreen } from './PilotProfileScreen';

type Page =
  | { name: 'aircraft' }
  | { name: 'aircraftEdit'; id: string | null }
  | { name: 'pilot' }
  | { name: 'pilotEdit'; id: string }
  | { name: 'nightLandings' };

function ProfilesFlow({ initial }: { initial: Page }) {
  const [stores] = useState(captureProfileStores);
  const [page, setPage] = useState<Page>(initial);
  const go = (next: Page) => () => setPage(next);
  const { now, aircraft, pilot } = stores;
  switch (page.name) {
    case 'aircraft':
      return (
        <AircraftListScreen
          store={aircraft}
          navigation={{
            onAdd: go({ name: 'aircraftEdit', id: null }),
            onEdit: (id) => setPage({ name: 'aircraftEdit', id }),
            onOpenPilot: go({ name: 'pilot' }),
          }}
        />
      );
    case 'aircraftEdit':
      return <AircraftEditScreen store={aircraft} profileId={page.id} now={now} onClose={go({ name: 'aircraft' })} />;
    case 'pilot':
      return (
        <PilotProfileScreen
          store={pilot}
          navigation={{
            onBack: go({ name: 'aircraft' }),
            onEdit: (id) => setPage({ name: 'pilotEdit', id }),
            onLogNightLandings: go({ name: 'nightLandings' }),
          }}
        />
      );
    case 'pilotEdit':
      return <PilotEditScreen store={pilot} profileId={page.id} now={now} onClose={go({ name: 'pilot' })} />;
    case 'nightLandings':
      return <NightLandingScreen store={pilot} now={now} onClose={go({ name: 'pilot' })} />;
  }
}

/** kanaf-dev://aircraft: the aircraft list, with the pilot profile one tap away. */
export function AircraftCapture() {
  return (
    <StripFrame>
      <ProfilesFlow initial={{ name: 'aircraft' }} />
    </StripFrame>
  );
}

/** kanaf-dev://aircraftedit: the editor of the active aircraft, every section filled. */
export function AircraftEditCapture() {
  return (
    <StripFrame>
      <ProfilesFlow initial={{ name: 'aircraftEdit', id: CAPTURE_AIRCRAFT_ID }} />
    </StripFrame>
  );
}

/** kanaf-dev://pilot: the pilot profile with its currency status. */
export function PilotCapture() {
  return (
    <StripFrame>
      <ProfilesFlow initial={{ name: 'pilot' }} />
    </StripFrame>
  );
}

/** kanaf-dev://logbookentry (editable draft) and logbooklocked (confirmed, read-only). */
export function LogbookEntryCapture({ locked }: { locked: boolean }) {
  const [stores] = useState(captureProfileStores);
  return (
    <StripFrame>
      <LogbookEntryScreen
        store={stores.logbookEntry}
        entryId={locked ? CAPTURE_CONFIRMED_ENTRY_ID : CAPTURE_DRAFT_ENTRY_ID}
        onClose={() => undefined}
      />
    </StripFrame>
  );
}
