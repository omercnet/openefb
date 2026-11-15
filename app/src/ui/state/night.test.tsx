import { act, useEffect } from 'react';
import { render } from '../../../tests/support/ui';
import type { DisplayMode } from '../../domain/displayMode';
import { useIsNight } from './night';

const SUMMER_NOON = Date.UTC(2026, 5, 21, 10, 0); // 13:00 in Israel
const MIDNIGHT = Date.UTC(2026, 5, 21, 22, 0);
const TEL_AVIV = { lat: 32.0, lon: 34.8 };

let seen: boolean | null = null;
function Probe({ mode }: { mode: DisplayMode }) {
  const night = useIsNight(mode, TEL_AVIV);
  useEffect(() => {
    seen = night;
  });
  return null;
}

describe('useIsNight', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('Day and Night are fixed', async () => {
    jest.setSystemTime(MIDNIGHT);
    await render(<Probe mode="day" />);
    expect(seen).toBe(false);
    await render(<Probe mode="night" />);
    expect(seen).toBe(true);
  });

  it('Auto read the clock when it became active, not the time Day was chosen', async () => {
    jest.setSystemTime(SUMMER_NOON);
    const view = await render(<Probe mode="day" />);
    expect(seen).toBe(false);
    jest.setSystemTime(MIDNIGHT); // hours pass with Day selected
    await view.update(<Probe mode="auto" />);
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(seen).toBe(true); // not a minute later
  });
});
