import { replayTitle } from '../../domain/replay/replayView';
import { CAPTURE_FLIGHT } from '../screens/captureReplayFixtures';

describe('the replay title (ReplayView.navigationTitleText)', () => {
  it('names the departure and the arrival, not the departure twice', () => {
    expect(replayTitle('LLHA', 'LLMG')).toBe('LLHA to LLMG');
    expect(replayTitle(CAPTURE_FLIGHT.departureICAO, CAPTURE_FLIGHT.arrivalICAO)).toBe('LLHA to LLMG');
  });

  it('is "Flight Replay" when neither airport is known', () => {
    expect(replayTitle('', '')).toBe('Flight Replay');
    expect(replayTitle(null, null)).toBe('Flight Replay');
  });
});
