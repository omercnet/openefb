// Web preview placeholder: the self test exercises native modules (SQLite, location, audio, PDF, speech) only.
import { Text, View } from 'react-native';

export function SelfTestScreen() {
  return (
    <View style={{ flex: 1, padding: 32 }}>
      <Text style={{ fontSize: 24 }}>The native self test runs on iOS and Android only.</Text>
    </View>
  );
}
