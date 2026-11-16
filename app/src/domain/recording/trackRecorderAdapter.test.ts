import { FakeLocationSource, makeFix } from '../ports/location';
import type { PhaseMarker, TrackPoint } from '../../data/recording/records';
import { createTrackRecorderFactory } from './trackRecorderAdapter';

function setup() {
  const points: TrackPoint[] = [];
  const markers: PhaseMarker[] = [];
  const source = new FakeLocationSource();
  let n = 0;
  const make = createTrackRecorderFactory({
    source,
    newId: () => `id-${++n}`,
    store: {
      insertTrackPoint: async (p) => void points.push(p),
      insertPhaseMarker: async (m) => void markers.push(m),
      updatePhaseMarkerEnd: async () => undefined,
    },
  });
  return { make, source, points, markers };
}
const settle = () => new Promise((r) => setImmediate(r));

describe('track recorder adapter', () => {
  it('records fixes as track points for its flight, and reports the count and markers on stop', async () => {
    const { make, source, points } = setup();
    const recorder = make('flight-1');
    await recorder.startTracking();
    source.emitFix(makeFix({ timestampMs: 1000 }));
    source.emitFix(makeFix({ timestampMs: 2000 }));
    await settle();
    const summary = await recorder.stopTracking();
    expect(points.map((p) => p.flightID)).toEqual(['flight-1', 'flight-1']);
    expect(summary.trackPointCount).toBe(2);
    expect(points[0]!.timestamp).toBe(1000);
    expect(Array.isArray(summary.phaseMarkers)).toBe(true);
    expect(source.subscriberCount).toBe(0);
  });

  it('a location stream failure reaches the coordinator handler', async () => {
    const { make, source } = setup();
    const recorder = make('flight-2');
    const onStreamFailure = jest.fn();
    recorder.setFailureHandlers({ onWriteFailure: jest.fn(), onStreamFailure });
    await recorder.startTracking();
    source.fail(new Error('stream down'));
    expect(onStreamFailure).toHaveBeenCalledWith(expect.objectContaining({ message: 'stream down' }));
  });

  it('subscribes for airborne, background-capable updates', async () => {
    const { make, source } = setup();
    await make('flight-3').startTracking();
    expect(source.requests).toEqual([{ activity: 'airborne', background: true }]);
  });
});
