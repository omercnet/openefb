// Settings > Legal > Disclaimers (the private DisclaimersView in SettingsView.swift): the PRD section 12 text, in full.
import { Text } from 'react-native';
import { DISCLAIMERS } from '../../domain/disclaimers';
import { FormScreen, FormSection, RowFrame } from '../form/Form';
import { FormType } from '../form/formStyle';
import { useTheme } from '../Primitives';

export function DisclaimersScreen({ onBack }: { onBack?: () => void }) {
  const t = useTheme();
  return (
    <FormScreen title="Disclaimers" onBack={onBack} testID="disclaimers-screen">
      <FormSection>
        {DISCLAIMERS.map((item) => (
          <RowFrame
            key={item.id}
            accessible
            style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4, paddingVertical: 14 }}
          >
            <Text style={[FormType.headline, { color: t.primaryText }]}>{item.title}</Text>
            <Text style={[FormType.subheadline, { color: t.secondaryText }]}>{item.text}</Text>
          </RowFrame>
        ))}
      </FormSection>
    </FormScreen>
  );
}
