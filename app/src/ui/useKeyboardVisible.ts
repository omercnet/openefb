import { useEffect, useState } from 'react';
import { Keyboard, Platform, type KeyboardEvent } from 'react-native';

/** Starts from what the platform already knows: the keyboard may be up when the view mounts (react-native-web has no `isVisible`). */
const keyboardUp = (): boolean => (typeof Keyboard.isVisible === 'function' ? Keyboard.isVisible() : false);

/**
 * Whether the software keyboard is up. SwiftUI replaces the bottom safe area (the home indicator) with the keyboard, so a
 * view that pads for the indicator must stop doing so while the keyboard covers it. iOS announces the change before it
 * animates (`...Will...`), Android after (`...Did...`). An announcement without height (an empty frame) does not count.
 * Never true on web.
 */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(keyboardUp);
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (event?: KeyboardEvent) =>
      setVisible((event?.endCoordinates?.height ?? 1) > 0),
    );
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}
