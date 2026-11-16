import { act } from 'react';
import { ActionSheetIOS, Platform } from 'react-native';
import { press, render } from '../../../tests/support/ui';
import { STOP_CONFIRMATION } from '../../domain/recording/recordingNotices';
import { captureRecordingLab } from '../screens/captureRecordingFixtures';
import { POPOVER_WIDTH, popoverPosition, StopRecordingDialog } from './StopRecordingDialog';
import { createRecordButtonAnchorRef, recordButtonView, registerRecordButtonAnchor } from './stopAnchor';

const original = { os: Platform.OS, pad: (Platform as { isPad?: boolean }).isPad };
const setPlatform = (os: 'ios' | 'android', isPad = false) => {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  Object.defineProperty(Platform, 'isPad', { value: isPad, configurable: true });
};
afterEach(() => {
  setPlatform(original.os as 'ios' | 'android', original.pad === true);
  registerRecordButtonAnchor(null);
  jest.useRealTimers();
  jest.restoreAllMocks();
});

/** A record button that sits at x 300..376, y 30..74 in the window. */
const button = {
  measureInWindow: (done: (x: number, y: number, w: number, h: number) => void) => done(300, 30, 76, 44),
} as never;
const has = (view: Awaited<ReturnType<typeof render>>, id: string) =>
  view.all((n) => n.props?.testID === id).length > 0;

describe('popoverPosition', () => {
  const window = { width: 1032, height: 1376 };
  it('opens under the record button, with the same offset as the SwiftUI popover', () => {
    expect(popoverPosition({ x: 300, y: 30, width: 76, height: 44 }, window)).toEqual({ left: 225, top: 82 });
  });

  it('stays inside the window at either edge', () => {
    expect(popoverPosition({ x: 0, y: 30, width: 40, height: 44 }, window).left).toBe(8);
    expect(popoverPosition({ x: 1000, y: 30, width: 40, height: 44 }, window).left).toBe(1032 - POPOVER_WIDTH - 8);
  });

  it('is centred in the window with no record button to point at', () => {
    expect(popoverPosition(null, window).left).toBe((1032 - POPOVER_WIDTH) / 2);
  });
});

describe('StopRecordingDialog', () => {
  it('iPad: a popover under the record button, End Recording only (no Cancel, no dim), tap outside cancels', async () => {
    setPlatform('ios', true);
    const sheet = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => undefined);
    registerRecordButtonAnchor(button);
    const lab = captureRecordingLab();
    const view = await render(<StopRecordingDialog store={lab.store} />);
    expect(has(view, 'stop-recording-popover')).toBe(false);
    await act(async () => lab.store.getState().requestStop());
    expect(sheet).not.toHaveBeenCalled();
    const popover = view.byTestId('stop-recording-popover');
    expect(JSON.stringify(popover.props.style)).toContain('"top":82');
    expect(has(view, 'stop-recording-cancel')).toBe(false);
    expect(view.text()).toContain(STOP_CONFIRMATION.message);
    await press(view.byTestId('stop-recording-backdrop'));
    expect(lab.store.getState().showStopConfirmation).toBe(false);
  });

  it('iPad: End Recording confirms the stop', async () => {
    setPlatform('ios', true);
    registerRecordButtonAnchor(button);
    const lab = captureRecordingLab();
    const confirm = jest.spyOn(lab.store.getState(), 'confirmStop');
    const view = await render(<StopRecordingDialog store={lab.store} />);
    await act(async () => lab.store.getState().requestStop());
    await press(view.byTestId('stop-recording-confirm'));
    expect(confirm).toHaveBeenCalled();
  });

  it('iPad: a screen that opens on the question waits for the record button, then points at it', async () => {
    setPlatform('ios', true);
    const lab = captureRecordingLab();
    lab.store.getState().requestStop(); // asked before the button exists
    const view = await render(<StopRecordingDialog store={lab.store} />);
    expect(has(view, 'stop-recording-popover')).toBe(false);
    await act(async () => registerRecordButtonAnchor(button));
    expect(JSON.stringify(view.byTestId('stop-recording-popover').props.style)).toContain('"top":82');
  });

  it('iPad: with no record button at all the question still appears, after a short wait', async () => {
    jest.useFakeTimers();
    setPlatform('ios', true);
    const lab = captureRecordingLab();
    lab.store.getState().requestStop();
    const view = await render(<StopRecordingDialog store={lab.store} />);
    expect(has(view, 'stop-recording-popover')).toBe(false);
    await act(async () => jest.advanceTimersByTime(1100));
    expect(has(view, 'stop-recording-popover')).toBe(true);
  });

  it('iPhone: the system action sheet, End Recording destructive and tap-outside as cancel', async () => {
    setPlatform('ios', false);
    const sheet = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => undefined);
    const lab = captureRecordingLab();
    await render(<StopRecordingDialog store={lab.store} />);
    expect(sheet).not.toHaveBeenCalled();
    await act(async () => lab.store.getState().requestStop());
    expect(sheet).toHaveBeenCalledTimes(1);
    const [options, callback] = sheet.mock.calls[0]!;
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

  it('iPhone: End Recording confirms the stop', async () => {
    setPlatform('ios', false);
    const sheet = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => undefined);
    const lab = captureRecordingLab();
    const confirm = jest.spyOn(lab.store.getState(), 'confirmStop');
    await render(<StopRecordingDialog store={lab.store} />);
    await act(async () => lab.store.getState().requestStop());
    await act(async () => sheet.mock.calls[0]![1](0));
    expect(confirm).toHaveBeenCalled();
  });

  it('Android keeps the in-app dialog with Cancel', async () => {
    setPlatform('android');
    const sheet = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => undefined);
    const lab = captureRecordingLab();
    const view = await render(<StopRecordingDialog store={lab.store} />);
    await act(async () => lab.store.getState().requestStop());
    expect(sheet).not.toHaveBeenCalled();
    expect(view.byTestId('stop-recording-cancel')).toBeTruthy();
  });

  it('a stale unmount does not clear a newer registration', () => {
    const other = { measureInWindow: () => undefined } as never;
    const refA = createRecordButtonAnchorRef();
    const refB = createRecordButtonAnchorRef();
    refA(button);
    refB(other); // a second button takes over
    refA(null); // the first one unmounts late
    expect(recordButtonView()).toBe(other);
    refB(null);
    expect(recordButtonView()).toBeNull();
  });

  it('iPad: the backdrop has no dim and is not a VoiceOver element, and the card has the escape gesture', async () => {
    setPlatform('ios', true);
    registerRecordButtonAnchor(button);
    const lab = captureRecordingLab();
    const view = await render(<StopRecordingDialog store={lab.store} />);
    await act(async () => lab.store.getState().requestStop());
    const backdrop = view.byTestId('stop-recording-backdrop');
    expect(JSON.stringify(backdrop.props.style)).not.toContain('backgroundColor');
    expect(backdrop.props.accessible).toBe(false);
    expect(has(view, 'stop-recording-popover')).toBe(true);
    // The backdrop is a self-closing sibling of the card, so a tap on the card never reaches its onPress.
    const escape = view.byTestId('stop-recording-popover').props.onAccessibilityEscape;
    await act(async () => escape());
    expect(lab.store.getState().showStopConfirmation).toBe(false);
  });

  it('iPad: the popover follows the button when the window changes size', async () => {
    setPlatform('ios', true);
    let x = 300;
    const moving = {
      measureInWindow: (done: (x: number, y: number, w: number, h: number) => void) => done(x, 30, 76, 44),
    } as never;
    registerRecordButtonAnchor(moving);
    const lab = captureRecordingLab();
    const view = await render(<StopRecordingDialog store={lab.store} />);
    await act(async () => lab.store.getState().requestStop());
    expect(JSON.stringify(view.byTestId('stop-recording-popover').props.style)).toContain('"left":225');
    x = 100;
    const dims = require('react-native').Dimensions as typeof import('react-native').Dimensions; // eslint-disable-line @typescript-eslint/no-require-imports
    await act(async () => {
      dims.set({ window: { width: 800, height: 1000, scale: 2, fontScale: 1 } });
    });
    expect(JSON.stringify(view.byTestId('stop-recording-popover').props.style)).toContain('"left":25');
  });
});
