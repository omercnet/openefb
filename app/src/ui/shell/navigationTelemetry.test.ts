import { createAppStore } from '../state/appStore';
import { bindNavigationTelemetry } from './navigationTelemetry';

function setup() {
  const app = createAppStore();
  const events: unknown[][] = [];
  const stop = bindNavigationTelemetry(app, { signal: ((...args: unknown[]) => void events.push(args)) as never });
  return { app, events, stop };
}

describe('navigation telemetry', () => {
  it('counts each change of the selected screen, and nothing else', () => {
    const { app, events, stop } = setup();
    app.getState().setScreen('log');
    app.getState().setScreen('log');
    app.getState().setScreen('map');
    app.getState().setStripColumn('layers');
    expect(events).toEqual([
      ['Navigation.screen', { screen: 'log' }],
      ['Navigation.screen', { screen: 'map' }],
    ]);
    stop();
  });

  it('counts the briefing when it opens, not when it closes', () => {
    const { app, events, stop } = setup();
    app.getState().openBriefing(null);
    app.getState().setPresentingBriefing(false);
    expect(events).toEqual([['Israel.briefingOpened']]);
    stop();
  });
});
