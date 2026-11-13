// New in TS: the expo-audio permission adapter (Swift read AVAudioApplication.shared.recordPermission directly).
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import { Linking } from 'react-native';

import { createMicrophonePermission, microphoneStatusOf } from './microphonePermission';

jest.mock('expo-audio', () => ({
  getRecordingPermissionsAsync: jest.fn(),
  requestRecordingPermissionsAsync: jest.fn(),
}));

const response = (status: string, granted: boolean, canAskAgain = true) => ({
  status,
  granted,
  canAskAgain,
  expires: 'never',
});

describe('microphoneStatusOf', () => {
  it.each([
    [response('granted', true), 'granted'],
    [response('undetermined', false), 'undetermined'],
    [response('denied', false, true), 'denied'], // Android after one refusal: still "off", whatever canAskAgain says
    [response('denied', false, false), 'denied'],
    [response('granted', false), 'undetermined'], // inconsistent answers never read as granted
  ])('%j -> %s', (permission, expected) => {
    expect(microphoneStatusOf(permission as never)).toBe(expected);
  });
});

describe('createMicrophonePermission', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reads the status without asking', async () => {
    jest.mocked(getRecordingPermissionsAsync).mockResolvedValue(response('denied', false) as never);
    expect(await createMicrophonePermission().status()).toBe('denied');
    expect(requestRecordingPermissionsAsync).not.toHaveBeenCalled();
  });

  it('asks and returns the answer', async () => {
    jest.mocked(requestRecordingPermissionsAsync).mockResolvedValue(response('granted', true) as never);
    expect(await createMicrophonePermission().request()).toBe('granted');
    expect(requestRecordingPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('opens the system Settings page of the app', async () => {
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    await createMicrophonePermission().openSettings();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('a failing native call rejects instead of reading as a status', async () => {
    jest.mocked(getRecordingPermissionsAsync).mockRejectedValue(new Error('native module missing'));
    await expect(createMicrophonePermission().status()).rejects.toThrow('native module missing');
  });
});
