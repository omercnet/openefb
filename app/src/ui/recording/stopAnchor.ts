// Where the End recording confirmation points: the record button (Swift: confirmationDialog attached to it, a popover on
// iPad). The button registers its view here, the dialog reads it when it opens.
import type { HostInstance } from 'react-native';

let anchor: HostInstance | null = null;

export const registerRecordButtonAnchor = (view: HostInstance | null): void => {
  anchor = view;
};

export const recordButtonAnchor = (): HostInstance | null => anchor;
