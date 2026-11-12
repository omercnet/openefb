import { LogReference } from '../ui/log/LogReference';
import { LogScreen } from '../ui/screens/LogScreen';

/** Route log: the full-screen Log (no map) in the reference/ipad-log.png state, for the fidelity gate. */
export default function LogRoute() {
  return (
    <LogReference>
      <LogScreen />
    </LogReference>
  );
}
