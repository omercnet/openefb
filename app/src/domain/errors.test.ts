import { AppFailure, err, ok, unwrap, type AppError } from './errors';

describe('Result', () => {
  it('unwrap returns the value of an ok result', () => {
    expect(unwrap(ok(42))).toBe(42);
  });

  it('unwrap throws an AppFailure carrying the original error', () => {
    const error: AppError = { kind: 'airportNotFound', icao: 'LLXX' };
    let thrown: unknown;
    try {
      unwrap(err(error));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(AppFailure);
    expect((thrown as AppFailure).error).toEqual(error);
  });

  it('keeps the underlying cause of a wrapped failure', () => {
    const cause = new Error('disk full');
    const failure = new AppFailure({ kind: 'databaseMigrationFailed', cause });
    expect(failure.cause).toBe(cause);
  });

  it('names the kind and the payload in the message, not the cause', () => {
    const failure = new AppFailure({ kind: 'airportNotFound', icao: 'LLXX' });
    expect(failure.message).toContain('airportNotFound');
    expect(failure.message).toContain('LLXX');
    const wrapped = new AppFailure({ kind: 'databaseMigrationFailed', cause: new Error('disk full') });
    expect(wrapped.message).not.toContain('disk full');
  });
});
