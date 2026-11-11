import { FakeMicrophonePermission } from './microphonePermission';

describe('FakeMicrophonePermission', () => {
  it('reports the status it was given', async () => {
    expect(await new FakeMicrophonePermission('denied').status()).toBe('denied');
    expect(await new FakeMicrophonePermission('undetermined').status()).toBe('undetermined');
  });

  it('asking resolves the configured answer, which then becomes the status, and counts the prompt', async () => {
    const permission = new FakeMicrophonePermission('undetermined', 'granted');
    expect(await permission.request()).toBe('granted');
    expect(await permission.status()).toBe('granted');
    expect(permission.requestCalls).toBe(1);

    const refusing = new FakeMicrophonePermission('undetermined', 'denied');
    expect(await refusing.request()).toBe('denied');
    expect(await refusing.status()).toBe('denied');
  });

  it('opening Settings is counted', async () => {
    const permission = new FakeMicrophonePermission('denied');
    await permission.openSettings();
    await permission.openSettings();
    expect(permission.openSettingsCalls).toBe(2);
  });

  it('a configured failure rejects, so callers can be tested against a broken permission API', async () => {
    const broken = new FakeMicrophonePermission('granted');
    broken.failure = new Error('permission module missing');
    await expect(broken.status()).rejects.toThrow('permission module missing');
    await expect(broken.request()).rejects.toThrow('permission module missing');
  });
});
