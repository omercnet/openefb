import { offlineStatusFor, offlineStyleFor } from './offlineStatus';

describe('offline status row', () => {
  it('asks for the sectional packs while the sectional layer is on, the street packs otherwise', () => {
    expect(offlineStyleFor(true)).toBe('vfrSectional');
    expect(offlineStyleFor(false)).toBe('street');
  });

  it('is not downloaded before the map has reported its bounds', () => {
    const service = { status: jest.fn(() => 'ready' as const) };
    expect(offlineStatusFor(service, null, true, 1)).toBe('notDownloaded');
    expect(service.status).not.toHaveBeenCalled();
  });

  it('is the service answer for the visible bounds', () => {
    const bounds = { south: 1, west: 2, north: 3, east: 4 };
    const service = { status: jest.fn(() => 'partial' as const) };
    expect(offlineStatusFor(service, bounds, true, 99)).toBe('partial');
    expect(service.status).toHaveBeenCalledWith(bounds, 'vfrSectional', 99);
  });
});
