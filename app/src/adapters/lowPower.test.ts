import { createLowPowerMode, type BatteryLike } from './lowPower';

function fakeBattery(initial: boolean | Error) {
  let listener: ((e: { lowPowerMode: boolean }) => void) | null = null;
  const remove = jest.fn();
  const battery: BatteryLike = {
    isLowPowerModeEnabledAsync: () => (initial instanceof Error ? Promise.reject(initial) : Promise.resolve(initial)),
    addLowPowerModeListener: (l) => {
      listener = l;
      return { remove };
    },
  };
  return { battery, emit: (v: boolean) => listener!({ lowPowerMode: v }), remove };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('low power mode', () => {
  it('is off until the platform answers, then follows the answer and every change', async () => {
    const { battery, emit } = fakeBattery(true);
    const source = createLowPowerMode(battery);
    expect(source.isEnabled()).toBe(false);
    await settle();
    expect(source.isEnabled()).toBe(true);
    emit(false);
    expect(source.isEnabled()).toBe(false);
    emit(true);
    expect(source.isEnabled()).toBe(true);
  });

  it('a platform that cannot say reads as normal power', async () => {
    const source = createLowPowerMode(fakeBattery(new Error('no')).battery);
    await settle();
    expect(source.isEnabled()).toBe(false);
  });

  it('stopping detaches the listener', () => {
    const { battery, remove } = fakeBattery(false);
    createLowPowerMode(battery).stop();
    expect(remove).toHaveBeenCalled();
  });
});
