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
  framedLabel = false,
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
  /**
   * `minSize` frames the label inside the button (`Text.frame(minWidth:minHeight:)` in a large bordered button, as the recording
   * notices do), so the button is the frame plus the control's own padding (about 14 pt by 20 pt) and 88 pt tall at 60.
   */
  framedLabel?: boolean;
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
        minWidth: framedLabel ? undefined : minSize,
        minHeight: framedLabel ? undefined : minSize,
        paddingHorizontal: framedLabel ? 20 : Space.l,
        paddingVertical: framedLabel ? 14 : undefined,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: Space.xs,
        borderRadius: framedLabel ? 44 : minSize / 2,
        alignSelf: stretch ? 'stretch' : undefined,
        backgroundColor: prominent ? t.accent : t.infoFill,
      }}
    >
      {icon ? (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {icon}
        </View>
      ) : null}
      <View
        style={{
          minWidth: framedLabel ? minSize : undefined,
          minHeight: framedLabel ? minSize : undefined,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={[FormType.body, { color: text }]}>{title}</Text>
      </View>
    </Pressy>
  );
}
