import type { AppError } from '../errors';
import { errorDescription, errorId, errorSeverity } from './errorInfo';

const cause = new Error('test');
const SOME: AppError[] = [
  { kind: 'gpsUnavailable' },
  { kind: 'chartExpired', expiredAtMs: Date.now() },
  { kind: 'chartDownloadFailed', region: 'test' },
  { kind: 'chartCorrupted', region: 'test' },
  { kind: 'weatherStale', ageSeconds: 3600 },
  { kind: 'weatherFetchFailed', cause },
  { kind: 'recordingFailed', cause },
  { kind: 'databaseCorrupted' },
  { kind: 'databaseMigrationFailed', cause },
  { kind: 'nasrImportFailed', cause },
  { kind: 'networkUnavailable' },
  { kind: 'airportNotFound', icao: 'KXYZ' },
  { kind: 'audioSessionFailed', cause },
  { kind: 'transcriptionUnavailable' },
  { kind: 'microphonePermissionDenied' },
  { kind: 'tfrFetchFailed', cause },
  { kind: 'debriefFailed', cause },
  { kind: 'debriefUnavailable', reason: 'why' },
  { kind: 'regionDataUnavailable', region: 'israel' },
  { kind: 'remoteConfigRejected', reason: 'bad' },
];

describe('EFBError', () => {
  it('allErrorsHaveDescriptions', () => {
    for (const e of SOME) {
      expect(errorDescription(e).length).toBeGreaterThan(0);
    }
  });
  it('allErrorsHaveUniqueIDs', () => {
    const ids = SOME.map(errorId);
    for (const id of ids) expect(id).not.toBe('');
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('severityLevels', () => {
    const sev = (e: AppError) => errorSeverity(e);
    expect(sev({ kind: 'gpsUnavailable' })).toBe('critical');
    expect(sev({ kind: 'databaseCorrupted' })).toBe('critical');
    expect(sev({ kind: 'databaseMigrationFailed', cause })).toBe('critical');
    expect(sev({ kind: 'chartExpired', expiredAtMs: 0 })).toBe('warning');
    expect(sev({ kind: 'weatherStale', ageSeconds: 3600 })).toBe('warning');
    expect(sev({ kind: 'networkUnavailable' })).toBe('warning');
    expect(sev({ kind: 'chartDownloadFailed', region: 't' })).toBe('error');
    expect(sev({ kind: 'chartCorrupted', region: 't' })).toBe('error');
    expect(sev({ kind: 'weatherFetchFailed', cause })).toBe('error');
    expect(sev({ kind: 'recordingFailed', cause })).toBe('error');
    expect(sev({ kind: 'nasrImportFailed', cause })).toBe('error');
    expect(sev({ kind: 'airportNotFound', icao: 'KXYZ' })).toBe('info');
    expect(sev({ kind: 'audioSessionFailed', cause })).toBe('error');
    expect(sev({ kind: 'microphonePermissionDenied' })).toBe('error');
    expect(sev({ kind: 'debriefFailed', cause })).toBe('error');
    expect(sev({ kind: 'transcriptionUnavailable' })).toBe('warning');
    expect(sev({ kind: 'tfrFetchFailed', cause })).toBe('warning');
    expect(sev({ kind: 'debriefUnavailable', reason: 'r' })).toBe('warning');
    expect(sev({ kind: 'regionDataUnavailable', region: 'r' })).toBe('info');
    expect(sev({ kind: 'remoteConfigRejected', reason: 'r' })).toBe('info');
  });
  it('errorDescriptionsContainContext', () => {
    expect(errorDescription({ kind: 'chartExpired', expiredAtMs: Date.now() })).toContain('expired');
    expect(errorDescription({ kind: 'chartDownloadFailed', region: 'San_Francisco' })).toContain('San_Francisco');
    expect(errorDescription({ kind: 'airportNotFound', icao: 'KPAO' })).toContain('KPAO');
    expect(errorDescription({ kind: 'weatherStale', ageSeconds: 3600 })).toContain('60');
    expect(errorDescription({ kind: 'weatherFetchFailed', cause })).toBe('Weather download failed: test');
  });
  it('errorIDsIncludeAssociatedValues', () => {
    expect(errorId({ kind: 'chartDownloadFailed', region: 'San_Francisco' })).toContain('San_Francisco');
    expect(errorId({ kind: 'airportNotFound', icao: 'KPAO' })).toContain('KPAO');
  });
});
