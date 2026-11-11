// StatusTag (NearestColumnView.swift): a short caution tag that is never truncated. Day: a filled amber or red block.
// Night: no filled amber blocks, so caution is an amber outline with amber text on the dark paper.
import { Text } from 'react-native';
import { useTheme } from '../../Primitives';
import { Radius, Type } from '../../tokens';

/** `.footnote.weight(.heavy)`: the SF footnote role at weight 800. */
const footnoteHeavy = { ...Type.systemFootnoteSemibold, fontVariant: undefined, fontWeight: '800' as const };

export function StatusTag({ text, spoken, isWarning }: { text: string; spoken: string; isWarning: boolean }) {
  const t = useTheme();
  const fill = isWarning ? t.warning : t.night ? 'transparent' : t.cautionFill;
  return (
    <Text
      accessibilityLabel={spoken}
      numberOfLines={1}
      style={[
        footnoteHeavy,
        {
          alignSelf: 'flex-start',
          color: isWarning ? t.onWarning : t.night ? t.caution : '#000000', // Color.black: no token
          backgroundColor: fill,
          borderColor: !isWarning && t.night ? t.caution : fill,
          borderWidth: !isWarning && t.night ? 1 : 0,
          borderRadius: Radius.xs,
          overflow: 'hidden',
          paddingHorizontal: 6,
          paddingVertical: 2,
        },
      ]}
    >
      {text}
    </Text>
  );
}
