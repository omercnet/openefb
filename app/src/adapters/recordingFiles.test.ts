import { Platform } from 'react-native';

import * as fakeFs from '../../tests/support/fakeExpoFileSystem';
import { concat, ftyp, m4aOf, mdat } from '../../tests/support/m4aBuilder';
import { audioFileUri } from '../domain/ports/audioRecorder';
import { relativeToApplicationSupport } from '../domain/recording/flightPersistence';
import { FlightRecoveryService } from '../domain/recording/flightRecovery';
import type { FlightRecordingSummary } from '../domain/recording/recordingCoordinator';
import { applicationSupportDirectory, createRecordingFiles, resolveAudioUri } from './recordingFiles';

jest.mock('expo-file-system', () => jest.requireActual('../../tests/support/fakeExpoFileSystem'));

const SUPPORT = 'file:///var/mobile/Containers/Data/Application/APP/Library/Application%20Support';
const RECORDINGS = `${SUPPORT}/efb-212/recordings`;
const ID = 'A1B2C3D4-0000-4000-8000-000000000001';
const PATH = `${RECORDINGS}/${ID}.m4a`;

beforeEach(() => {
  fakeFs.reset();
  fakeFs.addDirectory(RECORDINGS);
});

afterEach(() => jest.restoreAllMocks());

describe('applicationSupportDirectory', () => {
  test('is Library/Application Support next to Documents on iOS', () => {
    expect(applicationSupportDirectory().uri).toBe(`${SUPPORT}/`);
  });

  test('is the private files directory (Paths.document) on Android', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    expect(applicationSupportDirectory().uri).toBe(`${fakeFs.DOCUMENTS}/`);
  });
});

describe('resolveAudioUri', () => {
  test.each([
    ['a relative path goes under the root', SUPPORT, 'efb-212/recordings/X.m4a', `${SUPPORT}/efb-212/recordings/X.m4a`],
    ['a root with a trailing slash', `${SUPPORT}/`, 'efb-212/recordings/X.m4a', `${SUPPORT}/efb-212/recordings/X.m4a`],
    ['an absolute path is kept', SUPPORT, '/data/user/0/app/files/Audio/X.m4a', '/data/user/0/app/files/Audio/X.m4a'],
    ['a file URI is kept', SUPPORT, 'file:///elsewhere/X.m4a', 'file:///elsewhere/X.m4a'],
  ])('%s', (_name, root, stored, expected) => {
    expect(resolveAudioUri(root, stored)).toBe(expected);
  });
});

describe('createRecordingFiles', () => {
  const files = createRecordingFiles();

  test('takes the Application Support root from the platform and lets a caller override it', () => {
    expect(files.appSupportRoot).toBe(`${SUPPORT}/`);
    expect(createRecordingFiles({ appSupportUri: 'file:///custom/' }).appSupportRoot).toBe('file:///custom/');
  });

  describe('pathFor', () => {
    test('is the path the audio recorder writes for an upper case id', () => {
      expect(files.pathFor(ID)).toBe(audioFileUri(files.appSupportRoot, ID));
    });

    test('keeps the case of the id it is given (Android file names are case sensitive)', () => {
      expect(files.pathFor(ID.toLowerCase())).toBe(`${RECORDINGS}/${ID.toLowerCase()}.m4a`);
    });

    test('is stored relative to the same root by FlightPersistenceService', () => {
      expect(relativeToApplicationSupport(files.pathFor(ID), files.appSupportRoot)).toBe(
        `efb-212/recordings/${ID}.m4a`,
      );
    });
  });

  describe('listFileNames', () => {
    test('lists the files in the recordings directory by name, as written', async () => {
      fakeFs.addFile(PATH);
      fakeFs.addFile(`${RECORDINGS}/notes.txt`);
      expect((await files.listFileNames()).sort()).toStrictEqual([`${ID}.m4a`, 'notes.txt']);
    });

    test('leaves out sub-directories', async () => {
      fakeFs.addFile(PATH);
      fakeFs.addDirectory(`${RECORDINGS}/old`);
      expect(await files.listFileNames()).toStrictEqual([`${ID}.m4a`]);
    });

    test('is empty when the recordings directory does not exist yet (nothing was ever recorded)', async () => {
      fakeFs.reset();
      expect(await files.listFileNames()).toStrictEqual([]);
    });

    test('rejects when the directory cannot be read (the recovery service treats that as no files)', async () => {
      jest.spyOn(fakeFs.Directory.prototype, 'list').mockImplementation(() => {
        throw new Error('permission denied');
      });
      await expect(files.listFileNames()).rejects.toThrow('permission denied');
    });
  });

  describe('exists', () => {
    test('is true for a file and false for a missing file or a directory', async () => {
      fakeFs.addFile(PATH);
      expect(await files.exists(PATH)).toBe(true);
      expect(await files.exists(`${RECORDINGS}/missing.m4a`)).toBe(false);
      expect(await files.exists(RECORDINGS)).toBe(false);
    });

    test('is false, not a rejection, when the platform refuses the path', async () => {
      jest.spyOn(fakeFs.File.prototype, 'exists', 'get').mockImplementation(() => {
        throw new Error('url contains invalid characters');
      });
      expect(await files.exists('::bad::')).toBe(false);
    });
  });

  describe('durationSeconds', () => {
    test('reads the length of a finished recording from its movie header', async () => {
      fakeFs.addFile(PATH, m4aOf(95.5));
      expect(await files.durationSeconds(PATH)).toBe(95.5);
    });

    test('is 0 for a recording cut short by a crash (no movie box)', async () => {
      fakeFs.addFile(PATH, concat(ftyp, mdat));
      expect(await files.durationSeconds(PATH)).toBe(0);
    });

    test('is 0 for a file that is not there', async () => {
      expect(await files.durationSeconds(`${RECORDINGS}/missing.m4a`)).toBe(0);
    });

    test('is 0 when reading fails part way, and the handle is still closed', async () => {
      fakeFs.addFile(PATH, m4aOf(10));
      fakeFs.failures.read = new Error('I/O error');
      expect(await files.durationSeconds(PATH)).toBe(0);
      expect(fakeFs.handles).toEqual({ opened: 1, closed: 1 });
    });

    test('closes the handle after a successful read', async () => {
      fakeFs.addFile(PATH, m4aOf(10));
      await files.durationSeconds(PATH);
      expect(fakeFs.handles).toEqual({ opened: 1, closed: 1 });
    });

    test('is 0 when the file cannot be opened', async () => {
      fakeFs.addFile(PATH, m4aOf(10));
      fakeFs.failures.open = new Error('permission denied');
      expect(await files.durationSeconds(PATH)).toBe(0);
    });

    test('accepts a plain path as well as a file URI', async () => {
      fakeFs.addFile(PATH, m4aOf(7));
      expect(await files.durationSeconds(PATH.replace('file://', ''))).toBe(7);
    });
  });

  describe('creationDate', () => {
    test('is the creation time in epoch milliseconds', async () => {
      fakeFs.addFile(PATH, m4aOf(1), 1_700_000_123_456);
      expect(await files.creationDate(PATH)).toBe(1_700_000_123_456);
    });

    test.each([
      ['the platform has no creation time', null],
      ['the platform reports NaN', Number.NaN],
    ])('is null when %s', async (_name, creationTime) => {
      fakeFs.addFile(PATH, m4aOf(1), creationTime);
      expect(await files.creationDate(PATH)).toBeNull();
    });

    test('is null for a missing file', async () => {
      expect(await files.creationDate(`${RECORDINGS}/missing.m4a`)).toBeNull();
    });
  });

  describe('removeFile', () => {
    test('deletes the file', async () => {
      fakeFs.addFile(PATH);
      await files.removeFile(PATH);
      expect(fakeFs.has(PATH)).toBe(false);
    });

    test('accepts a plain path as well as a file URI', async () => {
      fakeFs.addFile(PATH);
      await files.removeFile(PATH.replace('file://', ''));
      expect(fakeFs.has(PATH)).toBe(false);
    });

    test('is not an error when the file is already gone (the recorder may not have written one)', async () => {
      await expect(files.removeFile(PATH)).resolves.toBeUndefined();
    });

    test('never deletes a directory', async () => {
      fakeFs.addFile(PATH);
      await files.removeFile(RECORDINGS);
      expect(fakeFs.has(RECORDINGS)).toBe(true);
      expect(fakeFs.has(PATH)).toBe(true);
    });

    test('rejects when the platform cannot delete (callers ignore it, as Swift try? did)', async () => {
      fakeFs.addFile(PATH);
      fakeFs.failures.delete = new Error('read-only volume');
      await expect(files.removeFile(PATH)).rejects.toThrow('read-only volume');
    });
  });

  describe('with FlightRecoveryService', () => {
    function recovery(saved: FlightRecordingSummary[]): FlightRecoveryService {
      return new FlightRecoveryService({
        recordingStore: {
          flightIDsWithRecordedData: async () => [],
          trackPoints: async () => [],
          transcriptSegments: async () => [],
          phaseMarkers: async () => [],
        },
        persistence: {
          store: async (summary) => {
            saved.push(summary);
            return 'saved';
          },
        },
        flights: { list: async () => [] },
        audio: files,
      });
    }

    test('recovers a flight that only has an audio file, dated from the file and as long as the recording', async () => {
      fakeFs.addFile(PATH, m4aOf(95), 1_700_000_000_000);
      fakeFs.addFile(`${RECORDINGS}/notes.txt`);
      const saved: FlightRecordingSummary[] = [];

      // The recovery service compares ids in lower case; the file keeps the case it was written with.
      expect(await recovery(saved).recoverOrphans()).toEqual([ID.toLowerCase()]);

      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({
        flightID: ID.toLowerCase(),
        startDate: 1_700_000_000_000,
        endDate: 1_700_000_095_000,
        audioFileURL: PATH,
      });
    });

    test('recovers a flight whose file was cut short, with a zero-length recording', async () => {
      fakeFs.addFile(PATH, concat(ftyp, mdat), 1_700_000_000_000);
      const saved: FlightRecordingSummary[] = [];

      expect(await recovery(saved).recoverOrphans()).toEqual([ID.toLowerCase()]);
      expect(saved[0]).toMatchObject({ startDate: 1_700_000_000_000, endDate: 1_700_000_000_000 });
    });

    test('finds nothing when the recordings directory does not exist', async () => {
      fakeFs.reset();
      expect(await recovery([]).recoverOrphans()).toEqual([]);
    });
  });
});
