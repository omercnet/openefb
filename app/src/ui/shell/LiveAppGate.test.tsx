import { act } from 'react';
import { render } from '../../../tests/support/ui';
import { LiveAppGate } from './LiveAppGate';
import type { AppRuntime } from './runtime';

const order: string[] = [];
const runtime = { started: { region: 'israel' } } as unknown as AppRuntime;
let resolveRuntime: (r: AppRuntime) => void = () => undefined;

jest.mock('./runtime', () => ({
  getRuntime: () => new Promise((resolve) => (resolveRuntime = resolve)),
}));
jest.mock('./resetSlices', () => ({
  resetLiveSlices: (region: string) => void order.push(`reset:${region}`),
}));
jest.mock('./LiveApp', () => ({
  LiveApp: () => {
    order.push('mount');
    return null;
  },
}));

describe('LiveAppGate', () => {
  it('shows the launch screen, then resets the slices with the restored region before mounting the live app', async () => {
    order.length = 0;
    const view = await render(<LiveAppGate />);
    expect(view.byTestId('launchScreen')).toBeTruthy();
    expect(order).toEqual([]);
    await act(async () => resolveRuntime(runtime));
    expect(order).toEqual(['reset:israel', 'mount']);
  });
});
