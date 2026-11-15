// IsraelAlertBanner (Views/Map/IsraelAlertBanner.swift): the highest priority alert in full, then at most two one-line
// rows, then "+N more"; red warning (white text) or amber caution (black text); a caution under a red top alert keeps its
// own amber. Nothing for an empty list.
import { render } from '../../../tests/support/ui';
import type { IsraelAlert } from '../../domain/israel/alertEvaluator';
import { ThemeContext } from '../Primitives';
import { Day } from '../tokens';
import { IsraelAlertBanner } from './IsraelAlertBanner';

const alert = (
  id: string,
  severity: IsraelAlert['severity'],
  title: string,
  detail: string | null = null,
): IsraelAlert => ({
  id,
  severity,
  kind: 'prohibited',
  title,
  detail,
});

const show = (alerts: IsraelAlert[]) =>
  render(
    <ThemeContext.Provider value={Day}>
      <IsraelAlertBanner alerts={alerts} />
    </ThemeContext.Provider>,
  );

const bg = (view: Awaited<ReturnType<typeof show>>, testID: string) => {
  const style = view.byTestId(testID).props.style as unknown;
  return Object.assign({}, ...(Array.isArray(style) ? style.flat(2) : [style])).backgroundColor as string | undefined;
};

describe('IsraelAlertBanner', () => {
  it('renders nothing for no alerts', async () => {
    const view = await show([]);
    expect(view.all((n) => n.props?.testID === 'israel-alert-banner')).toHaveLength(0);
  });

  it('shows the top alert in full with its detail and a spoken label', async () => {
    const view = await show([alert('gaza', 'warning', 'Inside Gaza border buffer', 'Turn away now')]);
    expect(view.byTestId('israel-alert-banner')).toBeTruthy();
    expect(view.text()).toContain('Inside Gaza border buffer');
    expect(view.text()).toContain('Turn away now');
    expect(view.byLabel('Warning: Inside Gaza border buffer. Turn away now').length).toBeGreaterThan(0);
    expect(bg(view, 'israel-alert-banner')).toBe(Day.warning);
  });

  it('shows at most two more alerts as one line each and counts the rest', async () => {
    const view = await show([
      alert('a', 'warning', 'Alert A', 'detail A'),
      alert('b', 'warning', 'Alert B', 'detail B'),
      alert('c', 'caution', 'Alert C', 'detail C'),
      alert('d', 'caution', 'Alert D'),
      alert('e', 'caution', 'Alert E'),
    ]);
    const text = view.text();
    expect(text).toContain('Alert A');
    expect(text).toContain('detail A'); // only the top alert shows its detail
    expect(text).toContain('Alert B');
    expect(text).not.toContain('detail B');
    expect(text).toContain('Alert C');
    expect(text).not.toContain('Alert D');
    expect(text).toContain('+2 more');
  });

  it('no "+N more" at exactly three alerts', async () => {
    const view = await show([alert('a', 'warning', 'A'), alert('b', 'caution', 'B'), alert('c', 'caution', 'C')]);
    expect(view.text()).not.toContain('more');
  });

  it('a caution under a red top alert keeps its own amber; a row of the top severity has no fill of its own', async () => {
    const view = await show([alert('a', 'warning', 'A'), alert('b', 'warning', 'B'), alert('c', 'caution', 'C')]);
    expect(bg(view, 'israel-alert-c')).toBe(Day.cautionFill);
    expect(bg(view, 'israel-alert-b')).toBeUndefined();
  });

  it('an amber top alert is black on amber', async () => {
    const view = await show([alert('a', 'caution', 'Check NOTAM')]);
    expect(bg(view, 'israel-alert-banner')).toBe(Day.cautionFill);
    expect(view.byLabel('Caution: Check NOTAM. ').length).toBeGreaterThan(0);
  });
});
