// File access for the recording flow on expo-file-system: what FlightRecoveryService lists and probes after a crash,
// what FlightPersistenceService deletes when a recording is discarded, and the Application Support root that
// FlightRecord.audioFileURL is stored relative to (docs/port-notes/A7.md).
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { RECORDINGS_DIR } from '../domain/ports/audioRecorder';
import type { RecoveryAudioFiles } from '../domain/recording/flightRecovery';
import { m4aDurationSeconds } from './m4aDuration';

export interface RecordingFiles extends RecoveryAudioFiles {
  /** Application Support directory as a file URI. Pass it to FlightPersistenceService as appSupportRoot. */
  readonly appSupportRoot: string;
  /** Deletes a file. A missing file is not an error (Swift try? removeItem); directories are never touched. */
  removeFile(path: string): Promise<void>;
}

/**
 * The directory FlightRecord.audioFileURL is relative to. iOS: `<container>/Library/Application Support`, which
 * expo-file-system has no constant for, so it is the sibling of Documents. Android: the private files directory, which
 * is what Paths.document already is there.
 */
export function applicationSupportDirectory(): Directory {
  if (Platform.OS !== 'ios') return Paths.document;
  return new Directory(Paths.document.parentDirectory, 'Library', 'Application Support');
}

/**
 * A stored FlightRecord.audioFileURL as a file URI: relative paths sit under Application Support, absolute ones (a
 * recording that was outside it when saved) are kept as they are.
 */
export function resolveAudioUri(appSupportRoot: string, stored: string): string {
  if (stored.startsWith('file://') || stored.startsWith('/')) return stored;
  return `${appSupportRoot.replace(/\/+$/, '')}/${stored}`;
}

export interface RecordingFilesOptions {
  /** Application Support directory URI; defaults to applicationSupportDirectory(). */
  appSupportUri?: string;
}

/** Reads the duration from the movie header with one handle, closed on every path. */
async function durationOf(path: string): Promise<number> {
  const handle = new File(path).open(FileMode.ReadOnly);
  try {
    return await m4aDurationSeconds({
      size: handle.size ?? 0,
      read(offset, length) {
        handle.offset = offset;
        return handle.readBytes(length);
      },
    });
  } finally {
    handle.close();
  }
}

export function createRecordingFiles(options: RecordingFilesOptions = {}): RecordingFiles {
  const appSupportRoot = options.appSupportUri ?? applicationSupportDirectory().uri;
  const recordingsUri = `${appSupportRoot.replace(/\/+$/, '')}/${RECORDINGS_DIR}`;

  return {
    appSupportRoot,

    // The id keeps its case: the recovery service passes back the id as spelled in a listed file name, and Android
    // file systems are case sensitive.
    pathFor: (flightID) => `${recordingsUri}/${flightID}.m4a`,

    async listFileNames() {
      const directory = new Directory(recordingsUri);
      if (!directory.exists) return [];
      return directory
        .list()
        .filter((entry): entry is File => entry instanceof File)
        .map((file) => file.name);
    },

    async exists(path) {
      try {
        return new File(path).exists;
      } catch {
        return false; // Swift fileExists never throws
      }
    },

    async durationSeconds(path) {
      try {
        return await durationOf(path);
      } catch {
        return 0; // Swift: a file AVAudioFile cannot open counts as 0 seconds
      }
    },

    async creationDate(path) {
      try {
        const created = new File(path).creationTime;
        return typeof created === 'number' && Number.isFinite(created) ? created : null;
      } catch {
        return null;
      }
    },

    async removeFile(path) {
      let file: File;
      try {
        file = new File(path);
      } catch {
        return; // the SDK constructor throws for a directory: nothing here is a file, so nothing is deleted
      }
      if (file.exists) file.delete();
    },
  };
}
