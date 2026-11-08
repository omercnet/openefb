// Native bottom sheet demo (kanaf-rn://sheet): @expo/ui's universal BottomSheet presents a real SwiftUI sheet on
// iOS (presentationDetents medium/large; Liquid Glass chrome on iOS 26) and a Material 3 ModalBottomSheet on
// Android. The content is native too (SwiftUI / Compose Text in Column/Row), showing the KSQL airport summary.
import { BottomSheet, Column, Row, Spacer, Text } from '@expo/ui';
import { useState } from 'react';
import { Platform, Pressable, Text as RNText, View } from 'react-native';
import { scenario } from '../fixtures/scenario';

const apt = scenario.airport;
// iOS resolves embedded fonts by PostScript name; Android (ReactFontManager) by assets/fonts file name.
const font = (ios: string, android: string) => (Platform.OS === 'ios' ? ios : android);
const TITLE = font('ArchivoRoman-CondensedSemiBold', 'Archivo-Condensed-SemiBold');
const LABEL = font('ArchivoRoman-Medium', 'Archivo-Medium');
const MONO = font('IBMPlexMono-Medium', 'IBMPlexMono-Medium');
const INK = '#14191F';
const MUTED = '#6B6B6B';

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <Row spacing={8}>
      <Text textStyle={{ fontFamily: LABEL, fontSize: 13, color: MUTED }}>{label}</Text>
      <Spacer />
      <Text textStyle={{ fontFamily: MONO, fontSize: 16, color: INK }}>{value}</Text>
    </Row>
  );
}

export function SheetScreen() {
  const [presented, setPresented] = useState(true);
  return (
    <View style={{ flex: 1, backgroundColor: '#B9C7A8', alignItems: 'center', justifyContent: 'center' }}>
      <Pressable onPress={() => setPresented(true)} style={{ padding: 16, backgroundColor: '#FFFFFF', borderRadius: 10 }}>
        <RNText style={{ fontSize: 18 }}>Show {apt.ident}</RNText>
      </Pressable>
      <BottomSheet isPresented={presented} onDismiss={() => setPresented(false)} snapPoints={['half', 'full']}>
        <Column spacing={10}>
          <Row spacing={8}>
            <Text textStyle={{ fontFamily: TITLE, fontSize: 34, color: INK }}>{apt.ident}</Text>
            <Text textStyle={{ fontFamily: LABEL, fontSize: 15, color: '#1565C0' }}>{apt.flightCategory}</Text>
          </Row>
          <Text textStyle={{ fontFamily: LABEL, fontSize: 17, color: INK }}>{apt.name}</Text>
          {/* Elevation and traffic pattern altitude in feet MSL */}
          <Text textStyle={{ fontFamily: MONO, fontSize: 14, color: MUTED }}>{`ELEV ${apt.elevationFt} ft  -  TPA ${apt.tpaFt} ft  -  WX ${apt.weatherAgeMin} min`}</Text>
          <Pair label="WIND" value={apt.wx.wind} />
          <Pair label="VIS" value={apt.wx.vis} />
          <Pair label="CEILING" value={apt.wx.ceiling} />
          <Pair label="TEMP / DEWPT" value={`${apt.wx.temp} / ${apt.wx.dewpt}`} />
          <Pair label="ALTIM" value={apt.wx.altim} />
          {apt.runways.map((r) => (
            <Pair key={r.ident} label={`RWY ${r.ident}`} value={`${r.lengthFt} x ${r.widthFt} ft ${r.surface}`} />
          ))}
          {apt.frequencies.map(([name, mhz], i) => (
            <Pair key={`${name}-${i}`} label={name} value={mhz} />
          ))}
        </Column>
      </BottomSheet>
    </View>
  );
}
