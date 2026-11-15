// Render tests for FlightPlanSummaryCard: the route header, the metric values with their units, the fuel cell only with a
// fuel estimate, and what VoiceOver reads (the Swift accessibility labels and values).
import { render } from '../../../../tests/support/ui';
import { FlightPlanSummaryCard } from './FlightPlanSummaryCard';

describe('FlightPlanSummaryCard', () => {
  test('the preview values: route, distance, ETE and fuel', async () => {
    const view = await render(
      <FlightPlanSummaryCard distanceNM={125.4} ete="1:15" fuelGallons={12.3} departure="KPAO" destination="KMOD" />,
    );
    expect(view.text()).toBe('KPAO KMOD 125.4 nm 1:15 ETE 12.3 gal');
    expect(view.byTestId('fp-summary-route').props.accessibilityLabel).toBe('Route KPAO to KMOD');
    expect(view.byTestId('fp-summary-nm').props).toMatchObject({
      accessibilityLabel: 'Distance',
      accessibilityValue: { text: '125.4 nautical miles' },
    });
    expect(view.byTestId('fp-summary-ete').props).toMatchObject({
      accessibilityLabel: 'Estimated time en route',
      accessibilityValue: { text: '1:15' },
    });
    expect(view.byTestId('fp-summary-gal').props).toMatchObject({
      accessibilityLabel: 'Fuel',
      accessibilityValue: { text: '12.3 gallons' },
    });
  });

  test('without a fuel estimate there is no fuel cell', async () => {
    const view = await render(
      <FlightPlanSummaryCard distanceNM={7.09} ete="0:03" fuelGallons={null} departure="KPAO" destination="KSQL" />,
    );
    expect(view.text()).toBe('KPAO KSQL 7.1 nm 0:03 ETE');
    expect(view.all((n) => n.props?.testID === 'fp-summary-gal')).toHaveLength(0);
  });

  test('distances and fuel are rounded to one decimal; a zero plan reads 0.0 and 0:00', async () => {
    const view = await render(
      <FlightPlanSummaryCard distanceNM={0} ete="0:00" fuelGallons={0.04} departure="KPAO" destination="KPAO" />,
    );
    expect(view.text()).toBe('KPAO KPAO 0.0 nm 0:00 ETE 0.0 gal');
  });

  test('the route header is one element; the arrow is not read', async () => {
    const view = await render(
      <FlightPlanSummaryCard distanceNM={1} ete="0:01" fuelGallons={null} departure="KSQL" destination="KOAK" />,
    );
    expect(view.byTestId('fp-summary-route').props.accessible).toBe(true);
  });
});
