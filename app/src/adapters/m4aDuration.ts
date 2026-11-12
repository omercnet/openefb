// Duration of an MPEG-4 audio file (.m4a) from its movie header (moov/mvhd), for crash recovery. Swift read
// AVAudioFile.length / sampleRate and fell back to 0 when the file could not be opened; a recording cut short by a crash
// has no `moov` box (AVAudioRecorder and MediaRecorder write it when they stop), so this returns 0 for it too.

/** Random access to a file's bytes. read() returns fewer bytes than asked at the end of the file. */
export interface ByteReader {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

interface Box {
  type: string;
  start: number;
  headerSize: number;
  size: number;
}

/** The box header at offset, or null when it is missing, truncated or runs past `end`. */
async function readBox(reader: ByteReader, offset: number, end: number): Promise<Box | null> {
  if (offset + 8 > end) return null;
  const head = await reader.read(offset, 16);
  if (head.length < 8) return null;
  const v = new DataView(head.buffer, head.byteOffset, head.byteLength);
  let size = v.getUint32(0);
  const type = String.fromCharCode(head[4]!, head[5]!, head[6]!, head[7]!);
  let headerSize = 8;
  if (size === 1) {
    // 64-bit "largesize" follows the type.
    if (head.length < 16) return null;
    size = v.getUint32(8) * 2 ** 32 + v.getUint32(12);
    headerSize = 16;
  } else if (size === 0) {
    size = end - offset; // the box runs to the end of its container
  }
  if (size < headerSize || offset + size > end) return null;
  return { type, start: offset, headerSize, size };
}

async function findBox(reader: ByteReader, type: string, start: number, end: number): Promise<Box | null> {
  for (let offset = start; offset < end;) {
    const box = await readBox(reader, offset, end);
    if (!box) return null;
    if (box.type === type) return box;
    offset += box.size;
  }
  return null;
}

/** Seconds, or 0 when the file has no complete movie header or reports no duration. Rejects only if a read rejects. */
export async function m4aDurationSeconds(reader: ByteReader): Promise<number> {
  const moov = await findBox(reader, 'moov', 0, reader.size);
  if (!moov) return 0;
  const mvhd = await findBox(reader, 'mvhd', moov.start + moov.headerSize, moov.start + moov.size);
  if (!mvhd) return 0;
  const body = await reader.read(mvhd.start + mvhd.headerSize, 32);
  const v = new DataView(body.buffer, body.byteOffset, body.byteLength);
  let timescale: number;
  let duration: number;
  if (body[0] === 1) {
    if (body.length < 32 || mvhd.size - mvhd.headerSize < 32) return 0;
    timescale = v.getUint32(20);
    const high = v.getUint32(24);
    const low = v.getUint32(28);
    if (high === 0xffffffff && low === 0xffffffff) return 0; // unknown
    duration = high * 2 ** 32 + low;
  } else {
    if (body.length < 20 || mvhd.size - mvhd.headerSize < 20) return 0;
    timescale = v.getUint32(12);
    duration = v.getUint32(16);
    if (duration === 0xffffffff) return 0; // unknown
  }
  return timescale > 0 ? duration / timescale : 0;
}
