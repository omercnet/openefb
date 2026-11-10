// Port of EFBError.id, .errorDescription and .severity (Core/EFBError.swift) over the AppError union in ../errors.
import type { AppError } from '../errors';

export type ErrorSeverity = 'critical' | 'error' | 'warning' | 'info';

const causeText = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

/** Stable identity for de-duplicating banners. Swift prints Doubles as "3600.0"; here "3600". */
export function errorId(e: AppError): string {
  switch (e.kind) {
    case 'chartExpired':
      return `chartExpired-${e.expiredAtMs / 1000}`;
    case 'chartDownloadFailed':
    case 'chartCorrupted':
    case 'regionDataUnavailable':
      return `${e.kind}-${e.region}`;
    case 'weatherStale':
      return `weatherStale-${e.ageSeconds}`;
    case 'debriefUnavailable':
    case 'remoteConfigRejected':
      return `${e.kind}-${e.reason}`;
    case 'airportNotFound':
      return `airportNotFound-${e.icao}`;
    default:
      return e.kind;
  }
}

/** User-facing message, identical to the Swift wording. */
export function errorDescription(e: AppError): string {
  switch (e.kind) {
    case 'gpsUnavailable':
      return 'No GPS position. Turn on Location for Kanaf in Settings \u203a Privacy & Security \u203a Location Services.';
    case 'chartExpired': {
      const date = new Date(e.expiredAtMs).toLocaleDateString('en-US', { dateStyle: 'medium' });
      return `Chart expired ${date}. Download the current chart before using it.`;
    }
    case 'chartDownloadFailed':
      return `Chart download for ${e.region} failed. Check the internet connection and try again.`;
    case 'chartCorrupted':
      return `The ${e.region} chart file is damaged. Delete it and download it again.`;
    case 'weatherStale':
      return `Weather is ${Math.trunc(e.ageSeconds / 60)} min old. Refresh before relying on it.`;
    case 'weatherFetchFailed':
      return `Weather download failed: ${causeText(e.cause)}`;
    case 'recordingFailed':
      return `Recording failed: ${causeText(e.cause)}`;
    case 'audioSessionFailed':
      return `Cockpit audio could not start: ${causeText(e.cause)}`;
    case 'transcriptionUnavailable':
      return 'Speech recognition is not available on this iPad. The flight records without a transcript.';
    case 'microphonePermissionDenied':
      return 'Microphone is off, so no cockpit audio is recorded. Turn it on in Settings \u203a Kanaf \u203a Microphone.';
    case 'databaseCorrupted':
      return 'The airport database could not be opened. Reinstall Kanaf.';
    case 'databaseMigrationFailed':
      return `The flight database could not be updated: ${causeText(e.cause)}. Reinstall Kanaf.`;
    case 'nasrImportFailed':
      return `FAA airport data import failed: ${causeText(e.cause)}. Try again with a fresh NASR download.`;
    case 'tfrFetchFailed':
      return `TFRs could not be loaded: ${causeText(e.cause)}`;
    case 'networkUnavailable':
      return 'No internet. Weather, TFRs and downloads are unavailable; downloaded maps and the airport database still work.';
    case 'debriefFailed':
      return `Debrief failed: ${causeText(e.cause)}`;
    case 'debriefUnavailable':
      return e.reason;
    case 'airportNotFound':
      return `${e.icao} is not in the airport database. Check the identifier.`;
    case 'regionDataUnavailable':
      return `${e.region} aviation data is not installed in this build yet.`;
    case 'remoteConfigRejected':
      return `The app configuration update was not used: ${e.reason}. The app keeps working with its previous settings.`;
  }
}

export function errorSeverity(e: AppError): ErrorSeverity {
  switch (e.kind) {
    case 'gpsUnavailable':
    case 'databaseCorrupted':
    case 'databaseMigrationFailed':
      return 'critical';
    case 'chartExpired':
    case 'weatherStale':
    case 'transcriptionUnavailable':
    case 'tfrFetchFailed':
    case 'networkUnavailable':
    case 'debriefUnavailable':
      return 'warning';
    case 'airportNotFound':
    case 'regionDataUnavailable':
    case 'remoteConfigRejected':
      return 'info';
    default:
      return 'error';
  }
}
