import { ascii, box, concat, ftyp, mdat, mvhdV0, mvhdV1, u32 } from '../../tests/support/m4aBuilder';
import { m4aDurationSeconds, type ByteReader } from './m4aDuration';

function readerOf(bytes: Uint8Array): ByteReader & { requested: number } {
  const reader = {
    size: bytes.length,
    requested: 0,
    async read(offset: number, length: number) {
      reader.requested += length;
      return bytes.slice(offset, offset + length);
    },
  };
  return reader;
}

const duration = (bytes: Uint8Array): Promise<number> => m4aDurationSeconds(readerOf(bytes));

describe('m4aDurationSeconds', () => {
  test('reads the duration from a version 0 movie header after the media data (how recorders finish a file)', async () => {
    expect(await duration(concat(ftyp, mdat, box('moov', mvhdV0(1000, 90_500))))).toBe(90.5);
  });

  test('finds the movie header when it comes before the media data', async () => {
    expect(await duration(concat(ftyp, box('moov', mvhdV0(44_100, 441_000)), mdat))).toBe(10);
  });

  test('skips sibling boxes inside the movie box', async () => {
    const moov = box('moov', box('udta', new Uint8Array(40)), mvhdV0(600, 1200));
    expect(await duration(concat(ftyp, mdat, moov))).toBe(2);
  });

  test('reads a version 1 header with a 64 bit duration', async () => {
    // 2^32 + 500 ticks at 1000 per second
    expect(await duration(concat(ftyp, mdat, box('moov', mvhdV1(1000, 1, 500))))).toBe((2 ** 32 + 500) / 1000);
  });

  test('steps over a media box with a 64 bit size', async () => {
    const payload = new Uint8Array(300);
    const bigMdat = concat(u32(1), ascii('mdat'), u32(0), u32(16 + payload.length), payload);
    expect(await duration(concat(ftyp, bigMdat, box('moov', mvhdV0(1000, 3000))))).toBe(3);
  });

  test('accepts a last box whose size field is 0 (it runs to the end of the file)', async () => {
    const moov = box('moov', mvhdV0(1000, 4000));
    moov.set(u32(0), 0);
    expect(await duration(concat(ftyp, mdat, moov))).toBe(4);
  });

  test.each([
    ['a file cut off before the movie box was written (crash)', concat(ftyp, mdat)],
    ['a media box that claims more bytes than the file has', concat(ftyp, mdat.slice(0, 600))],
    ['a movie box without a movie header', concat(ftyp, mdat, box('moov', box('trak', new Uint8Array(32))))],
    ['a movie box cut off inside its header', concat(ftyp, mdat, box('moov', mvhdV0(1000, 5000)).slice(0, 30))],
    ['a movie header too short for its version', concat(ftyp, mdat, box('moov', box('mvhd', u32(0), u32(0))))],
    ['a version 1 header too short for 64 bit fields', concat(ftyp, mdat, box('moov', box('mvhd', u32(0x01000000))))],
    [
      'a movie box cut off after a complete movie header',
      concat(ftyp, mdat, box('moov', mvhdV0(1000, 5000), box('trak', new Uint8Array(200))).slice(0, 8 + 108 + 20)),
    ],
    [
      'a version 0 header box that ends before its fields (the next box must not be read as them)',
      concat(ftyp, mdat, box('moov', box('mvhd', u32(0), u32(0)), box('trak', u32(5000), new Uint8Array(60)))),
    ],
    [
      'a version 1 header box that ends before its fields (the next box must not be read as them)',
      concat(
        ftyp,
        mdat,
        box(
          'moov',
          box('mvhd', u32(0x01000000), u32(0)),
          box('trak', u32(7), u32(1000), u32(0), u32(5000), new Uint8Array(40)),
        ),
      ),
    ],
    ['a header with timescale 0', concat(ftyp, mdat, box('moov', mvhdV0(0, 1000)))],
    ['a version 0 header with the unknown-duration marker', concat(ftyp, mdat, box('moov', mvhdV0(1000, 0xffffffff)))],
    [
      'a version 1 header with the unknown-duration marker',
      concat(ftyp, mdat, box('moov', mvhdV1(1000, 0xffffffff, 0xffffffff))),
    ],
    ['a box whose size is smaller than its own header', concat(ftyp, u32(4), ascii('moov'), mdat)],
    ['a file shorter than one box header', Uint8Array.of(0, 0, 0)],
    ['a 64 bit box cut off inside its size field', concat(ftyp, u32(1), ascii('mdat'), u32(0))],
    ['an empty file', new Uint8Array()],
    ['bytes that are not MPEG-4 at all', ascii('RIFF....WAVEfmt this is not an m4a file')],
  ])('returns 0 for %s', async (_name, bytes) => {
    expect(await duration(bytes)).toBe(0);
  });

  test('returns 0 when a read comes back shorter than a box header (the file shrank while it was read)', async () => {
    const bytes = concat(ftyp, mdat);
    const reader: ByteReader = {
      size: bytes.length + 12,
      read: async (offset, length) => bytes.slice(offset, offset + length),
    };
    expect(await m4aDurationSeconds(reader)).toBe(0);
  });

  test('reads only box headers and the movie header, never the media data', async () => {
    const hour = box('mdat', new Uint8Array(2_000_000));
    const reader = readerOf(concat(ftyp, hour, box('moov', mvhdV0(1000, 3_600_000))));
    expect(await m4aDurationSeconds(reader)).toBe(3600);
    expect(reader.requested).toBeLessThan(200);
  });

  test('rejects when a read rejects (the file adapter turns that into 0)', async () => {
    const reader: ByteReader = {
      size: 100,
      read: () => Promise.reject(new Error('I/O error')),
    };
    await expect(m4aDurationSeconds(reader)).rejects.toThrow('I/O error');
  });
});
