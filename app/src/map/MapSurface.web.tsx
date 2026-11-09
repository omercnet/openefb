// Web preview placeholder (the map is native-only). Owned by the native agent.
import { View } from 'react-native';

export function MapSurface({ night }: { night: boolean }) {
  return <View style={{ flex: 1, backgroundColor: night ? '#10141A' : '#B9C7A8' }} />;
}
