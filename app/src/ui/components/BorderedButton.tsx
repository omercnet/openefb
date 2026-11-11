// SwiftUI's .buttonStyle(.bordered) and .borderedProminent in the control size large: a pill with the accent at 15% and accent
// text, or an accent fill with the on-accent text. The icon is the Label's symbol (decorative: the title says it).
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { FormType } from '../form/formStyle';
import { Pressy, useTheme } from '../Primitives';
import { Space } from '../tokens';

export function BorderedButton({
  title,
  label,
  onPress,
  icon,
  prominent = false,
  minSize = 44,
  stretch = false,
  testID,
}: {
  title: string;
  /** The spoken label when it differs from the title ("Dismiss recording problem"). */
  label?: string;
  onPress: () => void;
  icon?: ReactNode;
  /** .borderedProminent: the accent fill. */
  prominent?: boolean;
  /** The minimum width and height: 44 pt, or 60 pt for the in-flight controls. */
  minSize?: number;
  /** Fills the width (frame(maxWidth: .infinity)). */
  stretch?: boolean;
  testID?: string;
}) {
  const t = useTheme();
  const text = prominent ? t.onAccent : t.accent;
  return (
    <Pressy
      accessibilityLabel={label ?? title}
      onPress={onPress}
      testID={testID}
      style={{
        minWidth: minSize,
        minHeight: minSize,
        paddingHorizontal: Space.l,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: Space.xs,
        borderRadius: minSize / 2,
        alignSelf: stretch ? 'stretch' : undefined,
        backgroundColor: prominent ? t.accent : t.infoFill,
      }}
    >
      {icon ? (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {icon}
        </View>
      ) : null}
      <Text style={[FormType.body, { color: text }]}>{title}</Text>
    </Pressy>
  );
}
