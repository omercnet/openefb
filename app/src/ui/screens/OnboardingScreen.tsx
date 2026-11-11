// Port of Views/Onboarding/OnboardingView.swift. The app shell shows it until the flag is set (hasSeenOnboarding).
import { useRef } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { acknowledgeOnboarding, type OnboardingAcknowledgement } from '../../domain/onboarding';
import type { Preferences } from '../../domain/ports/preferences';
import { CloudSlash, LocationFill, MapFill, ShieldExclamation } from '../form/FormIcons';
import { accentText, FormType, toneColor } from '../form/formStyle';
import { Pressy, useTheme } from '../Primitives';
import { Radius } from '../tokens';
import { ONBOARDING_ACTION, ONBOARDING_ROWS, ONBOARDING_TITLE, type OnboardingRowContent } from './onboardingContent';

function RowIcon({ icon, color, bang }: { icon: OnboardingRowContent['icon']; color: string; bang: string }) {
  switch (icon) {
    case 'map':
      return <MapFill color={color} />;
    case 'cloudSlash':
      return <CloudSlash color={color} />;
    case 'shield':
      return <ShieldExclamation color={color} bang={bang} />;
  }
}

export function OnboardingScreen({
  prefs,
  onDone,
}: {
  prefs: Preferences;
  /** Called once when the user taps "I understand", saved or not. */
  onDone: (result: OnboardingAcknowledgement) => void;
}) {
  const t = useTheme();
  const tapped = useRef(false);
  const acknowledge = async () => {
    if (tapped.current) return; // a second tap while the flag is being written must not report twice
    tapped.current = true;
    onDone(await acknowledgeOnboarding(prefs));
  };
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.activeCell }}
      contentContainerStyle={{
        flexGrow: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 20,
        gap: 28,
      }}
      testID="onboarding-screen"
    >
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <LocationFill color={accentText(t)} />
      </View>
      <Text accessibilityRole="header" style={[FormType.largeTitle, { color: t.primaryText }]}>
        {ONBOARDING_TITLE}
      </Text>
      <View style={{ width: '100%', maxWidth: 560, paddingHorizontal: 32, gap: 20 }}>
        {ONBOARDING_ROWS.map((row) => (
          <View key={row.title} accessible style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 16 }}>
            <View style={{ width: 36, alignItems: 'center' }} accessibilityElementsHidden>
              <RowIcon icon={row.icon} color={row.tone === 'caution' ? t.caution : accentText(t)} bang={t.activeCell} />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[FormType.headline, { color: t.primaryText }]}>{row.title}</Text>
              <Text style={[FormType.body, { color: toneColor(t, 'secondary') }]}>{row.text}</Text>
            </View>
          </View>
        ))}
      </View>
      <Pressy
        accessibilityLabel={ONBOARDING_ACTION}
        onPress={() => void acknowledge()}
        testID="onboarding-continue"
        style={{
          width: '100%',
          maxWidth: 280,
          minHeight: 44,
          paddingVertical: 14,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: t.accent,
          borderRadius: Radius.l,
          marginBottom: 40,
        }}
      >
        <Text style={[FormType.headline, { color: t.onAccent }]}>{ONBOARDING_ACTION}</Text>
      </Pressy>
    </ScrollView>
  );
}
