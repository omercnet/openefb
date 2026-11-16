import type { Haptics } from '../adapters/haptics';
import { haptic, setHaptics } from './haptics';

describe('view haptics', () => {
  afterEach(() => setHaptics(null));

  it('are silent until the shell installs the adapter, then forward to it', () => {
    expect(() => haptic.light()).not.toThrow();
    const real: Haptics = { warning: jest.fn(), success: jest.fn(), light: jest.fn() };
    setHaptics(real);
    haptic.warning();
    haptic.success();
    haptic.light();
    expect(real.warning).toHaveBeenCalledTimes(1);
    expect(real.success).toHaveBeenCalledTimes(1);
    expect(real.light).toHaveBeenCalledTimes(1);
  });
});
