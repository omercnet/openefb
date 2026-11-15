import { openNodeSqliteDb } from '../../../tests/support/nodeSqliteDb';
import { openRecordingDatabase } from '../../data/recording';
import { DebriefEngine } from '../../domain/debriefEngine';
import { unavailableDebriefModel, type DebriefModel } from '../../domain/ports/debriefModel';
import { createFlightScreenStores, portEngineFor } from './flightScreens';

const flight = {
  id: 'f1',
  startDate: 1_700_000_000_000,
  departureICAO: 'LLHZ',
  arrivalICAO: 'LLIB',
  departureName: null,
  arrivalName: null,
  durationSeconds: 120,
  notes: '',
  trackPointCount: 2,
  transcriptSegmentCount: 0,
  audioQuality: 'standard',
  hasDebrief: false,
  audioFileURL: null,
} as never;

const point = (i: number) => ({
  id: `p${i}`,
  flightID: 'f1',
  timestamp: 1_700_000_000_000 + i * 1000,
  latitude: 32 + i * 0.001,
  longitude: 34.8,
  altitudeFeet: 1500,
  groundSpeedKnots: 90,
  verticalSpeedFPM: 0,
  courseDegrees: 0,
});

const availableModel: DebriefModel = {
  offered: true,
  availability: () => ({ kind: 'available' }),
  openSession: () => {
    throw new Error('not needed');
  },
};

async function setup(debrief: DebriefEngine | null) {
  const database = await openRecordingDatabase(openNodeSqliteDb());
  await database.insertTrackPoint(point(0));
  await database.insertTrackPoint(point(1));
  const stores = createFlightScreenStores({
    flight,
    database,
    israel: null,
    debrief,
    openAudio: () => null,
  });
  return { database, stores };
}

describe('flight screen stores', () => {
  it('the replay reads the flight track from the recording database', async () => {
    const { stores } = await setup(null);
    await stores.replay.getState().loadFlight({ id: 'f1', audioFileURL: null });
    expect(stores.replay.getState().loadError).toBeNull();
    expect(stores.replay.getState().isLoading).toBe(false);
    expect(stores.replay.getState().totalDuration).toBeGreaterThan(0);
    stores.replay.getState().cleanup();
    stores.dispose();
  });

  it('without a debrief engine (Android) the flight has no AI debrief and no debrief screen', async () => {
    const { stores } = await setup(null);
    expect(stores.detail.getState().hasEngine).toBe(false);
    expect(stores.debrief).toBeNull();
    stores.dispose();
  });

  it('outside Israel the flight shows no CVFR debrief', async () => {
    const { stores } = await setup(null);
    await stores.detail.getState().appear();
    expect(stores.detail.getState().cvfr).toBeNull();
    stores.detail.getState().disappear();
    stores.dispose();
  });

  it('with the model the detail asks its availability, and the engine state is stable until it changes', async () => {
    const engine = new DebriefEngine({ model: availableModel });
    const { stores, database } = await setup(engine);
    expect(stores.detail.getState().hasEngine).toBe(true);
    expect(stores.debrief).not.toBeNull();
    await stores.detail.getState().appear();
    expect(stores.detail.getState().availability).toEqual({ kind: 'available' });
    const port = portEngineFor(engine, database);
    const first = port.state;
    expect(port.state).toBe(first); // read twice between changes: the same object (external-store rule)
    const changed = jest.fn();
    port.subscribe(changed);
    engine.checkAvailability();
    expect(changed).toHaveBeenCalled();
    expect(port.state).not.toBe(first);
    stores.dispose();
  });

  it('a platform without the model is not offered', () => {
    expect(unavailableDebriefModel('Not on this platform').offered).toBe(false);
  });
});
