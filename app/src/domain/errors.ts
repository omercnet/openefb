// Port of EFBError (Core/EFBError.swift) as a discriminated union. Dates are epoch milliseconds, durations seconds.
// User-facing wording lives in the UI, keyed by `kind`. Repositories and adapters return Result or throw AppFailure;
// stores catch at their boundary. Never swallow an error silently.
export type AppError =
  | { kind: 'gpsUnavailable' }
  | { kind: 'chartExpired'; expiredAtMs: number }
  | { kind: 'chartDownloadFailed'; region: string }
  | { kind: 'chartCorrupted'; region: string }
  | { kind: 'weatherStale'; ageSeconds: number }
  | { kind: 'weatherFetchFailed'; cause: unknown }
  | { kind: 'recordingFailed'; cause: unknown }
  | { kind: 'audioSessionFailed'; cause: unknown }
  | { kind: 'transcriptionUnavailable' }
  | { kind: 'microphonePermissionDenied' }
  | { kind: 'databaseCorrupted' }
  | { kind: 'databaseMigrationFailed'; cause: unknown }
  | { kind: 'nasrImportFailed'; cause: unknown }
  | { kind: 'tfrFetchFailed'; cause: unknown }
  | { kind: 'networkUnavailable' }
  | { kind: 'debriefFailed'; cause: unknown }
  | { kind: 'debriefUnavailable'; reason: string }
  | { kind: 'airportNotFound'; icao: string }
  | { kind: 'regionDataUnavailable'; region: string }
  | { kind: 'remoteConfigRejected'; reason: string };

/** The thrown form of an AppError, for code paths where returning a Result is awkward. */
export class AppFailure extends Error {
  constructor(readonly error: AppError) {
    super(error.kind, 'cause' in error ? { cause: error.cause } : undefined);
    this.name = 'AppFailure';
  }
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = (error: AppError): Result<never> => ({ ok: false, error });

/** The value of an ok Result; throws AppFailure for an error Result. */
export function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.value;
  throw new AppFailure(result.error);
}
