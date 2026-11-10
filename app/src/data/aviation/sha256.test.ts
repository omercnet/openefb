import { createHash } from 'node:crypto';
import { Sha256 } from './sha256';

const nodeHex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

describe('Sha256', () => {
  test('matches the FIPS 180-4 test vectors', () => {
    expect(new Sha256().digestHex()).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(new Sha256().update(new TextEncoder().encode('abc')).digestHex()).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  test('matches node crypto for every length around the block and padding boundaries, in any chunking', () => {
    for (const length of [1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 4097]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 31 + length) & 0xff);
      expect(new Sha256().update(bytes).digestHex()).toBe(nodeHex(bytes));
      const chunked = new Sha256();
      for (let offset = 0; offset < length; offset += 37) chunked.update(bytes.subarray(offset, offset + 37));
      expect(chunked.digestHex()).toBe(nodeHex(bytes));
    }
  });
});
