import { render } from '../../../tests/support/ui';
import { AltitudeTape } from './AltitudeTape';

const tapeValue = async (el: Parameters<typeof render>[0]) =>
  (await render(el)).byLabel('Altitude tape')[0].props.accessibilityValue.text;

describe('AltitudeTape', () => {
  it('speaks altitude, vertical trend and the floor ahead', async () => {
    expect(await tapeValue(<AltitudeTape altitudeFeet={2448} verticalSpeedFPM={-250.7} />)).toBe(
      '2450 feet, descending 250 feet per minute',
    );
    expect(await tapeValue(<AltitudeTape altitudeFeet={2450} verticalSpeedFPM={50} />)).toBe('2450 feet, level');
    const floor = { feet: 3000, secondsAhead: 110, label: 'B floor 3,000' };
    expect(await tapeValue(<AltitudeTape altitudeFeet={2450} verticalSpeedFPM={300} floor={floor} />)).toBe(
      '2450 feet, climbing 300 feet per minute, Class B floor 3,000 feet in 1 minute 50 seconds',
    );
    expect(await tapeValue(<AltitudeTape altitudeFeet={null} verticalSpeedFPM={300} floor={floor} />)).toBe(
      'No current altitude',
    );
  });

  it('labels the scale ends and the altitude; the floor time under the floor, the floor label above', async () => {
    const floor = { feet: 3000, secondsAhead: 110, label: 'B floor 3,000' };
    const view = await render(<AltitudeTape altitudeFeet={680} verticalSpeedFPM={475} floor={floor} />);
    expect(view.text()).toBe('0 4,000 1:50 680 B floor 3,000');
    const above = await render(<AltitudeTape altitudeFeet={5000} verticalSpeedFPM={0} />);
    expect(above.text()).toBe('0 10,000 5,000');
  });

  it('the altitude label wins: a touching end label is not drawn, a touching floor time moves up', async () => {
    expect((await render(<AltitudeTape altitudeFeet={0} verticalSpeedFPM={0} />)).text()).toBe('4,000 0');
    const floor = { feet: 3000, secondsAhead: 110, label: 'B floor 3,000' };
    const view = await render(<AltitudeTape altitudeFeet={2950} verticalSpeedFPM={0} floor={floor} />);
    expect(view.text()).toBe('0 4,000 2,950 1:50  B floor 3,000');
  });
});

describe('AltitudeTape floor drawing', () => {
  const floor = { feet: 3000, secondsAhead: 110, label: 'B floor 3,000' };

  it('two tapes clip their hatching with distinct ids', async () => {
    const view = await render(
      <>
        <AltitudeTape altitudeFeet={680} verticalSpeedFPM={475} floor={floor} />
        <AltitudeTape altitudeFeet={680} verticalSpeedFPM={475} floor={floor} />
      </>,
    );
    const ids = view.all((n) => typeof n.props.clipPath === 'string').map((n) => n.props.clipPath);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('keeps the floor label on one line', async () => {
    const view = await render(<AltitudeTape altitudeFeet={680} verticalSpeedFPM={475} floor={floor} />);
    const labels = view.all(
      (n) => n.props.numberOfLines === 1 && JSON.stringify(n.props.children ?? '').includes('B floor'),
    );
    expect(labels.length).toBeGreaterThan(0);
  });
});
