// MicrophonePermission on expo-audio and the system Settings link. The audio recorder adapter asks for the permission itself
// when capture starts; this one lets the recording controls ask once up front and show "Microphone is off".
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync, type PermissionResponse } from 'expo-audio';
import { Linking } from 'react-native';

import type { MicrophonePermission, MicrophoneStatus } from '../domain/ports/microphonePermission';

/**
 * Not granted is "off": on Android a refusal that can be asked again (`canAskAgain`) still leaves the microphone off, so the
 * platform's own `status` decides and `granted` is only trusted when it agrees.
 */
export function microphoneStatusOf(permission: PermissionResponse): MicrophoneStatus {
  if (permission.granted && permission.status === 'granted') return 'granted';
  return permission.status === 'denied' ? 'denied' : 'undetermined';
}

export function createMicrophonePermission(): MicrophonePermission {
  return {
    status: async () => microphoneStatusOf(await getRecordingPermissionsAsync()),
    request: async () => microphoneStatusOf(await requestRecordingPermissionsAsync()),
    openSettings: () => Linking.openSettings(),
  };
}
