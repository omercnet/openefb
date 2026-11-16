import { act } from 'react';
import { render } from '../../../tests/support/ui';
import { FakeDebriefEngine } from '../../domain/ports/debriefEngine';
import { createDebriefStore } from '../state/debriefStore';
import { DebriefScreen } from '../flights/DebriefScreen';
import { CAPTURE_DEBRIEF, captureDebriefLab } from './captureDebriefFixtures';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

describe('the debrief capture route', () => {
  it('opens on the empty "Debrief this flight" state, as the Swift reference does (no saved debrief)', async () => {
    const lab = captureDebriefLab();
    const view = await render(<DebriefScreen store={lab.store} onBack={() => undefined} />);
    expect(view.text()).toContain('Debrief this flight');
    expect(view.text()).toContain('Generate Debrief');
    expect(view.text()).not.toContain('Phase Observations');
  });

  it('a saved debrief renders as the finished debrief', async () => {
    const engine = new FakeDebriefEngine({ kind: 'available' }, CAPTURE_DEBRIEF);
    const store = createDebriefStore({ engine, flightId: 'f1', buildPrompt: async () => 'p' });
    const view = await render(<DebriefScreen store={store} onBack={() => undefined} />);
    await act(async () => undefined);
    expect(view.text()).toContain('Phase Observations');
    expect(view.text()).toContain('Regenerate Debrief');
  });
});
