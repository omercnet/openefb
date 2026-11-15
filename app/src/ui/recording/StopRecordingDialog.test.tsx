import { act } from 'react';
import { ActionSheetIOS, Platform } from 'react-native';
import { render } from '../../../tests/support/ui';
import { STOP_CONFIRMATION } from '../../domain/recording/recordingNotices';
import { captureRecordingLab } from '../screens/captureRecordingFixtures';
import { StopRecordingDialog } from './StopRecordingDialog';

const original = Platform.OS;
afterEach(() => {
  Object.defineProperty(Platform, 'OS', { value: original });
  jest.restoreAllMocks();
});

describe('StopRecordingDialog', () => {
  it('iOS: the system action sheet (a popover on iPad) with End Recording destructive and tap-outside as cancel', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios' });
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
