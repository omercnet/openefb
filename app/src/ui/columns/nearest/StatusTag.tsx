// StatusTag (NearestColumnView.swift): a short caution tag that is never truncated. Day: a filled amber or red block.
// Night: no filled amber blocks, so caution is an amber outline with amber text on the dark paper. CautionTags lays a row's
// tags out like the Swift ViewThatFits: all on one line when they fit, else one per line.
import { useState } from 'react';
import { Text, View, type LayoutChangeEvent } from 'react-native';
import { useTheme } from '../../Primitives';
import { Radius, Space, Type } from '../../tokens';

/** `.footnote.weight(.heavy)`: the SF footnote role at weight 800. */
const footnoteHeavy = { ...Type.systemFootnoteSemibold, fontVariant: undefined, fontWeight: '800' as const };

interface Tag {
  text: string;
  spoken: string;
  isWarning: boolean;
}

const widthOf = (e: LayoutChangeEvent): number => e.nativeEvent.layout.width;

export function StatusTag({
  text,
  spoken,
  isWarning,
  onLayout,
  minWidth,
  testID,
}: Tag & {
  /** Set on the measuring copy, which is not spoken. */
  onLayout?: (e: LayoutChangeEvent) => void;
  /** The tag's unconstrained width: a narrower parent then makes the badge overflow instead of wrapping its text. */
  minWidth?: number;
  testID?: string;
}) {
  const t = useTheme();
  const fill = isWarning ? t.warning : t.night ? 'transparent' : t.cautionFill;
  return (
    <Text
      accessibilityLabel={onLayout ? undefined : spoken}
      onLayout={onLayout}
      testID={testID}
      style={[
        footnoteHeavy,
        {
          alignSelf: 'flex-start',
          flexShrink: 0, // in the one-line row: never squeezed horizontally
          minWidth,
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

/**
 * ViewThatFits(in: .horizontal) { HStack(spacing: Space.s) { tags }; VStack(alignment: .leading, spacing: Space.xs) { tags } }
 * with every tag .lineLimit(1).fixedSize(). The tags are measured in a hidden copy with no width cap (a 10,000 pt row
 * inside a zero-size clipped box, out of the accessibility tree), so each width is the tag's natural width even when
 * that is wider than the column. Their sum plus the 8 pt gaps is compared with the width the row gives the visible box.
 * Nothing is shown until both are known (also after the tag set changes), so a guessed layout is never painted; the
 * visible tags keep their natural width (minWidth), overflowing like a fixed-size SwiftUI view rather than wrapping.
 */
export function CautionTags({ tags, testID = 'caution-tags' }: { tags: Tag[]; testID?: string }) {
  const [available, setAvailable] = useState<number | null>(null);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const measured = tags.every((tag) => widths[tag.text] !== undefined);
  const needed = tags.reduce((sum, tag) => sum + (widths[tag.text] ?? 0), Space.s * (tags.length - 1));
  const oneLine = needed <= (available ?? 0);
  return (
    <>
      <View
        testID={testID}
        onLayout={(e) => setAvailable(widthOf(e))}
        style={{ flexDirection: oneLine ? 'row' : 'column', gap: oneLine ? Space.s : Space.xs, alignSelf: 'stretch' }}
      >
        {available !== null && measured
          ? tags.map((tag) => <StatusTag key={tag.text} {...tag} minWidth={widths[tag.text]} />)
          : null}
      </View>
      <View style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        <View
          testID={`${testID}-measure`}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ flexDirection: 'row', alignItems: 'flex-start', width: 10_000, opacity: 0 }}
        >
          {tags.map((tag) => (
            <StatusTag
              key={tag.text}
              {...tag}
              testID={`${testID}-measure-${tag.text}`}
              onLayout={(e) => {
                const width = widthOf(e);
                setWidths((known) => (known[tag.text] === width ? known : { ...known, [tag.text]: width }));
              }}
            />
          ))}
        </View>
      </View>
    </>
  );
}
