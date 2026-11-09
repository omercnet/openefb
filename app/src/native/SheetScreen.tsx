// Native bottom sheet demo (kanaf-rn://sheet, iOS: -KanafScreen sheet): @expo/ui's universal BottomSheet presents a
// real SwiftUI sheet on iOS (medium/large detents on iPhone; a page-sized sheet on iPad via presentationSizing, iOS 18+;
// Liquid Glass chrome on iOS 26) and a Material 3 ModalBottomSheet on Android. The content is native SwiftUI / Compose
// (ScrollView, Column, Row, Text), laid out like the SwiftUI airport panel (reference/ipad-airport-KSQL.png).
import { BottomSheet, Column, Row, ScrollView, Text } from '@expo/ui';
import type { ModifierConfig } from '@expo/ui/swift-ui/modifiers';
import { useState } from 'react';
import { Platform, Pressable, Text as RNText, View } from 'react-native';
import { scenario } from '../fixtures/scenario';
import { Day } from '../ui/tokens';

const apt = scenario.airport;
// iOS resolves embedded fonts by PostScript name; Android (ReactFontManager) by assets/fonts file name.
const font = (ios: string, android: string) => (Platform.OS === 'ios' ? ios : android);
const TITLE = font('ArchivoRoman-CondensedSemiBold', 'Archivo-Condensed-SemiBold');
const LABEL = font('ArchivoRoman-Medium', 'Archivo-Medium');
const SECTION = font('ArchivoRoman-SemiBold', 'Archivo-SemiBold');
const MONO = font('IBMPlexMono-Medium', 'IBMPlexMono-Medium');
const LABEL_WIDTH = 92; // pt, the value column starts here as in the SwiftUI panel
// Same object presentationSizing('page') builds; written out because importing '@expo/ui/swift-ui/modifiers' at runtime
// calls requireNativeModule('ExpoUI'), which the web preview does not have.
const PAGE_SHEET: ModifierConfig = { $type: 'presentationSizing', sizing: 'page' };

function Section({ title, note }: { title: string; note?: string }) {
  return (
    <Row spacing={8} style={{ paddingTop: 14 }}>
      <Text textStyle={{ fontFamily: SECTION, fontSize: 12, letterSpacing: 1.2, color: Day.inkSecondary }}>{title}</Text>
      {note ? <Text style={{ backgroundColor: Day.paperSecondary, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }} textStyle={{ fontFamily: MONO, fontSize: 12, color: Day.inkSecondary }}>{note}</Text> : null}
    </Row>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <Row spacing={0}>
      <Text style={{ width: LABEL_WIDTH }} textStyle={{ fontFamily: LABEL, fontSize: 14, color: Day.inkSecondary }}>{label}</Text>
      <Text textStyle={{ fontFamily: MONO, fontSize: 16, color: Day.ink }}>{value}</Text>
    </Row>
  );
}

function Chip({ text }: { text: string }) {
  return (
    <Text style={{ backgroundColor: Day.paperSecondary, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6 }} textStyle={{ fontFamily: MONO, fontSize: 15, color: Day.ink }}>{text}</Text>
  );
}

export function SheetScreen() {
  const [presented, setPresented] = useState(true);
  return (
    <View style={{ flex: 1, backgroundColor: '#B9C7A8', alignItems: 'center', justifyContent: 'center' }}>
      <Pressable onPress={() => setPresented(true)} style={{ padding: 16, backgroundColor: '#FFFFFF', borderRadius: 10 }}>
        <RNText style={{ fontSize: 18 }}>Show {apt.ident}</RNText>
      </Pressable>
      <BottomSheet
        isPresented={presented}
        onDismiss={() => setPresented(false)}
        snapPoints={['half', 'full']}
        containerColor={Day.paper}
        contentPadding={{ top: 20, left: 20, right: 20 }}
        // iPad (regular width) ignores detents and shows a small form sheet; ask for the large page sheet instead.
        modifiers={Platform.OS === 'ios' ? [PAGE_SHEET] : undefined}
      >
        <ScrollView>
          <Column spacing={8} alignment="start">
            <Row spacing={8}>
              <Text textStyle={{ fontFamily: TITLE, fontSize: 30, color: Day.accent }}>{apt.ident}</Text>
              <Text textStyle={{ fontFamily: LABEL, fontSize: 16, color: Day.categoryMVFR }}>{`\u25CF ${apt.flightCategory}`}</Text>
            </Row>
            <Text textStyle={{ fontFamily: LABEL, fontSize: 15, color: Day.inkSecondary }}>{apt.name}</Text>
            {/* Elevation and traffic pattern altitude in feet MSL */}
            <Row spacing={8} style={{ paddingTop: 6 }}>
              <Chip text={`\u2191 ${apt.elevationFt}' MSL`} />
              <Chip text="Airport" />
              <Chip text={`TPA ${apt.tpaFt}'`} />
            </Row>
            <Section title="WEATHER" note={`${apt.weatherAgeMin} min`} />
            <Pair label="Wind" value={apt.wx.wind} />
            <Pair label="Vis" value={apt.wx.vis} />
            <Pair label="Ceiling" value={apt.wx.ceiling} />
            <Pair label="Temp" value={apt.wx.temp} />
            <Pair label="Dewpt" value={apt.wx.dewpt} />
            <Pair label="Altim" value={apt.wx.altim} />
            <Section title="FREQUENCIES" />
            {apt.frequencies.map(([name, mhz], i) => (
              <Pair key={`${name}-${i}`} label={name} value={mhz} />
            ))}
            <Section title="RUNWAYS" />
            {/* Length x width in feet */}
            {apt.runways.map((r) => (
              <Pair key={r.ident} label={r.ident} value={`${r.lengthFt.toLocaleString('en-US')}' x ${r.widthFt}'  ${r.surface}`} />
            ))}
          </Column>
        </ScrollView>
      </BottomSheet>
    </View>
  );
}
