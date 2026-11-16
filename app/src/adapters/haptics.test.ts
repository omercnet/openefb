import * as ExpoHaptics from 'expo-haptics';
import { createHaptics } from './haptics';

describe('haptics adapter', () => {
  it('plays the system warning and success notifications and the light impact', () => {
    const notificationAsync = jest.fn(async () => undefined);
    const impactAsync = jest.fn(async () => undefined);
    const haptics = createHaptics({ notificationAsync, impactAsync });
    haptics.warning();
    haptics.success();
    haptics.light();
    expect(notificationAsync).toHaveBeenNthCalledWith(1, ExpoHaptics.NotificationFeedbackType.Warning);
    expect(notificationAsync).toHaveBeenNthCalledWith(2, ExpoHaptics.NotificationFeedbackType.Success);
    expect(impactAsync).toHaveBeenCalledWith(ExpoHaptics.ImpactFeedbackStyle.Light);
  });

  it('a failing platform call is logged, never thrown', async () => {
    const log = jest.fn();
    createHaptics(
      { notificationAsync: async () => Promise.reject(new Error('no engine')), impactAsync: async () => undefined },
      log,
    ).warning();
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('no engine'));
  });
});
