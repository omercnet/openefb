// Local identifiers and clock. Platform-free: no crypto, so ids come from Math.random (fine for local row ids).
export type Clock = () => number;
export type IdGenerator = () => string;

/** Random RFC 4122 version 4 UUID, lower case. */
export function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const systemClock: Clock = () => Date.now();
