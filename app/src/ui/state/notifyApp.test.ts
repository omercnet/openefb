import { notifyApp } from './notifyApp';

describe('notifyApp', () => {
  it('runs the call and reports nothing when it works', () => {
    const call = jest.fn();
    expect(notifyApp(call)).toBeNull();
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('returns the message of a call that throws instead of letting it escape', () => {
    expect(
      notifyApp(() => {
        throw new Error('app state failed');
      }),
    ).toBe('app state failed');
  });

  it('describes anything that can be thrown', () => {
    expect(
      notifyApp(() => {
        throw 'plain text';
      }),
    ).toBe('plain text');
  });
});
