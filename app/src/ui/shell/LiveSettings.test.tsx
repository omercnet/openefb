import { act } from 'react';
import { render } from '../../../tests/support/ui';
import { AircraftEditScreen } from '../screens/AircraftEditScreen';
import { AircraftListScreen } from '../screens/AircraftListScreen';
import { DisclaimersScreen } from '../screens/DisclaimersScreen';
import { NightLandingScreen, PilotEditScreen } from '../screens/PilotEditScreen';
import { PilotProfileScreen } from '../screens/PilotProfileScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { LiveSettings } from './LiveSettings';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../screens/SettingsScreen', () => ({ SettingsScreen: jest.fn(() => null) }));
jest.mock('../screens/AircraftListScreen', () => ({ AircraftListScreen: jest.fn(() => null) }));
jest.mock('../screens/AircraftEditScreen', () => ({ AircraftEditScreen: jest.fn(() => null) }));
jest.mock('../screens/PilotProfileScreen', () => ({ PilotProfileScreen: jest.fn(() => null) }));
jest.mock('../screens/PilotEditScreen', () => ({
  PilotEditScreen: jest.fn(() => null),
  NightLandingScreen: jest.fn(() => null),
}));
jest.mock('../screens/DisclaimersScreen', () => ({ DisclaimersScreen: jest.fn(() => null) }));
jest.mock('../map/OfflineMapsView', () => ({ OfflineMapsView: jest.fn(() => null) }));

const last = <P,>(screen: unknown) => (screen as jest.Mock).mock.calls.at(-1)![0] as P;
const services = { now: () => 1_000 } as never;
const bounds = { south: 1, west: 2, north: 3, east: 4 };

async function open() {
  const onClose = jest.fn();
  const view = await render(
    <LiveSettings
      services={services}
      aircraft={{} as never}
      pilot={{} as never}
      offline={{} as never}
      mapBounds={() => bounds}
      onClose={onClose}
    />,
  );
  return { view, onClose };
}
const settings = () => last<{ navigation: Record<string, (...a: unknown[]) => void> }>(SettingsScreen).navigation;

describe('LiveSettings', () => {
  it('opens on Settings; its Back closes Settings', async () => {
    const { onClose } = await open();
    settings().onBack!();
    expect(onClose).toHaveBeenCalled();
  });

  it('Aircraft & Pilot: the aircraft list, its editor for a new and an existing aircraft, and Back pops one page', async () => {
    await open();
    await act(async () => settings().onOpenProfiles!());
    const list = () => last<{ navigation: Record<string, (...a: unknown[]) => void> }>(AircraftListScreen).navigation;
    await act(async () => list().onAdd!());
    expect(last<{ profileId: string | null }>(AircraftEditScreen).profileId).toBeNull();
    await act(async () => last<{ onClose: () => void }>(AircraftEditScreen).onClose());
    await act(async () => list().onEdit!('a1'));
    expect(last<{ profileId: string | null }>(AircraftEditScreen).profileId).toBe('a1');
    await act(async () => last<{ onClose: () => void }>(AircraftEditScreen).onClose());
    await act(async () => list().onBack!());
    expect(SettingsScreen).toHaveBeenCalled();
  });

  it('Pilot: the profile, its editor and the night landing sheet', async () => {
    await open();
    await act(async () => settings().onOpenProfiles!());
    await act(async () =>
      last<{ navigation: Record<string, () => void> }>(AircraftListScreen).navigation.onOpenPilot!(),
    );
    const pilot = () => last<{ navigation: Record<string, (...a: unknown[]) => void> }>(PilotProfileScreen).navigation;
    await act(async () => pilot().onEdit!('p1'));
    expect(last<{ profileId: string }>(PilotEditScreen).profileId).toBe('p1');
    await act(async () => last<{ onClose: () => void }>(PilotEditScreen).onClose());
    await act(async () => pilot().onLogNightLandings!());
    expect(NightLandingScreen).toHaveBeenCalled();
  });

  it('Disclaimers and Offline Maps open and pop back to Settings', async () => {
    const { view } = await open();
    await act(async () => settings().onOpenDisclaimers!());
    await act(async () => last<{ onBack: () => void }>(DisclaimersScreen).onBack());
    await act(async () => settings().onOpenOfflineMaps!());
    expect(view.all((n) => n.props?.testID === 'offline-maps-screen')).toHaveLength(1);
    const { OfflineMapsView } = jest.requireMock('../map/OfflineMapsView') as { OfflineMapsView: jest.Mock };
    expect(OfflineMapsView.mock.calls.at(-1)![0].visibleRegion).toEqual(bounds);
  });
});
