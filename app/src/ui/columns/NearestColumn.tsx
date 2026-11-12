// PLACEHOLDER until the Nearest column is ported (U3/U4): the shared header with the column title.
import { Text } from 'react-native';
import { useTheme } from '../Primitives';
import { Type } from '../tokens';
import { ColumnHeader } from './ColumnHeader';

export function NearestColumn() {
  const t = useTheme();
  return (
    <ColumnHeader>
      <Text style={[Type.title, { color: t.ink }]}>Nearest</Text>
    </ColumnHeader>
  );
}
