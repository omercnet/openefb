import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { describeError } from '../../domain/describeError';
import { Day } from '../tokens';
import { LiveApp } from './LiveApp';
import { getRuntime, type AppRuntime } from './runtime';

/**
 * The launch sequence in front of the first screen: the user database and its migrations, the saved region, the aviation
 * databases and the saved remote config (startup.ts), then the live app. Paper until then, like the Swift launch screen.
 */
export function LiveAppGate() {
  const [state, setState] = useState<{ runtime: AppRuntime } | { error: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    getRuntime().then(
      (runtime) => !cancelled && setState({ runtime }),
      (error) => !cancelled && setState({ error: describeError(error) }),
    );
    return () => {
      cancelled = true;
    };
  }, []);
  if (state && 'runtime' in state) return <LiveApp runtime={state.runtime} />;
  return (
    <View style={styles.paper} testID="launchScreen">
      {state ? <Text style={styles.error}>{`Kanaf could not start: ${state.error}`}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  paper: { flex: 1, backgroundColor: Day.paper, justifyContent: 'center', padding: 24 },
  error: { color: Day.ink, fontSize: 16 },
});
