import { Text } from 'react-native';
import { press, render } from '../../../tests/support/ui';
import { appStore } from '../state/appStore';
import { ColumnHeader } from './ColumnHeader';

const header = () => (
  <ColumnHeader>
    <Text>Nearest</Text>
  </ColumnHeader>
);

describe('ColumnHeader', () => {
  beforeEach(() => appStore.setState({ stripColumn: 'nearest' }));
  afterAll(() => appStore.setState({ stripColumn: 'log' }));

  it('shows the column title next to a labelled Log back button', async () => {
    const view = await render(header());
    expect(view.text()).toContain('Nearest');
    const back = view.byTestId('column-back-to-log');
    expect(back.props.accessibilityLabel).toBe('Back to flight log');
    expect(back.props.accessibilityRole).toBe('button');
  });

  it('the back button returns the strip to the flight log', async () => {
    const view = await render(header());
    await press(view.byTestId('column-back-to-log'));
    expect(appStore.getState().stripColumn).toBe('log');
  });
});
