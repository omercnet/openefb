import { act } from 'react';
import { ActionSheetIOS, Platform } from 'react-native';
import { render } from '../../../tests/support/ui';
import { STOP_CONFIRMATION } from '../../domain/recording/recordingNotices';
import { captureRecordingLab } from '../screens/captureRecordingFixtures';
import { StopRecordingDialog } from './StopRecordingDialog';
import { recordButtonHandle, registerRecordButtonAnchor } from './stopAnchor';

const original = Platform.OS;
afterEach(() => {
  Object.defineProperty(ReactNative, 'findNodeHandle', {
    value: realFindNodeHandle,
    configurable: true,
    writable: true,
  });
  registerRecordButtonAnchor(null);
  jest.useRealTimers();
  Object.defineProperty(Platform, 'OS', { value: original });
  jest.restoreAllMocks();
});

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the module object the code under test reads at call time
const ReactNative = require('react-native') as typeof import('react-native');
const button = { name: 'record button view' } as never;
const tagOf = (view: unknown): number | null => (view === button ? 4242 : null);
const realFindNodeHandle = ReactNative.findNodeHandle;
const installTags = () =>
  Object.defineProperty(ReactNative, 'findNodeHandle', { value: tagOf, configurable: true, writable: true });

describe('StopRecordingDialog', () => {
  it('iOS: the sheet is anchored on the record button (its native tag), so iPad gets a popover under it', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios' });
    installTags();
    const show = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => undefined);
    registerRecordButtonAnchor(button);
    const lab = captureRecordingLab();
    await render(<StopRecordingDialog store={lab.store} />);
    await act(async () => lab.store.getState().requestStop());
    expect(show.mock.calls[0]![0]).toMatchObject({ anchor: 4242 });
  });

  it('iOS: a screen that opens on the question waits for the record button instead of opening unanchored', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios' });
    installTags();
    const show = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => undefined);
    const lab = captureRecordingLab();
    lab.store.getState().requestStop(); // asked before the button exists
    await render(<StopRecordingDialog store={lab.store} />);
    expect(show).not.toHaveBeenCalled();
    await act(async () => registerRecordButtonAnchor(button));
    expect(show).toHaveBeenCalledTimes(1);
    expect(show.mock.calls[0]![0]).toMatchObject({ anchor: 4242 });
  });

  it('iOS: with no record button at all the question still appears, after a short wait', async () => {
    jest.useFakeTimers();
    Object.defineProperty(Platform, 'OS', { value: 'ios' });
    const show = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => undefined);
    const lab = captureRecordingLab();
    lab.store.getState().requestStop();
    await render(<StopRecordingDialog store={lab.store} />);
    expect(show).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTime(1100));
    expect(show).toHaveBeenCalledTimes(1);
    expect(show.mock.calls[0]![0].anchor).toBeUndefined();
  });

  it('a stale unmount does not clear a newer registration', async () => {
    installTags();
    registerRecordButtonAnchor(button);
    registerRecordButtonAnchor(null);
    registerRecordButtonAnchor(button);
    expect(recordButtonHandle()).toBe(4242);
  });

  it('iOS: the system action sheet (a popover on iPad) with End Recording destructive and tap-outside as cancel', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios' });
    installTags();
    registerRecordButtonAnchor(button);
    const show = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => undefined);
    const lab = captureRecordingLab();
    await render(<StopRecordingDialog store={lab.store} />);
    expect(show).not.toHaveBeenCalled();
    await act(async () => lab.store.getState().requestStop());
    expect(show).toHaveBeenCalledTimes(1);
    const [options, callback] = show.mock.calls[0]!;
    expect(options).toMatchObject({
      title: STOP_CONFIRMATION.title,
      message: STOP_CONFIRMATION.message,
      options: [STOP_CONFIRMATION.confirm, STOP_CONFIRMATION.cancel],
      destructiveButtonIndex: 0,
      cancelButtonIndex: 1,
    });
    await act(async () => callback(1));
    expect(lab.store.getState().showStopConfirmation).toBe(false);
  });

  it('iOS: End Recording confirms the stop', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios' });
    installTags();
    registerRecordButtonAnchor(button);
    const show = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => undefined);
    const lab = captureRecordingLab();
    const confirm = jest.spyOn(lab.store.getState(), 'confirmStop');
    await render(<StopRecordingDialog store={lab.store} />);
    await act(async () => lab.store.getState().requestStop());
    await act(async () => show.mock.calls[0]![1](0));
    expect(confirm).toHaveBeenCalled();
  });

  it('Android keeps the in-app dialog with Cancel', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android' });
    const show = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => undefined);
    const lab = captureRecordingLab();
    const view = await render(<StopRecordingDialog store={lab.store} />);
    await act(async () => lab.store.getState().requestStop());
    expect(show).not.toHaveBeenCalled();
    expect(view.byTestId('stop-recording-cancel')).toBeTruthy();
  });
});
