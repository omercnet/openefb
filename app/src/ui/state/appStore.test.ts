import { createAppStore } from './appStore';

describe('app store', () => {
  it('starts on the flight log with nothing selected', () => {
    const s = createAppStore().getState();
    expect(s.stripColumn).toBe('log');
    expect(s.selectedAirportId).toBeNull();
    expect(s.databaseError).toBeNull();
  });

  it('selecting an airport also shows the airport column', () => {
    const store = createAppStore();
    store.getState().showAirport('LLHZ');
    expect(store.getState().selectedAirportId).toBe('LLHZ');
    expect(store.getState().stripColumn).toBe('airport');
  });

  it('keeps the selected airport when the column changes', () => {
    const store = createAppStore();
    store.getState().showAirport('LLHZ');
    store.getState().setStripColumn('log');
    expect(store.getState().selectedAirportId).toBe('LLHZ');
  });

  it('records and clears a database error', () => {
    const store = createAppStore();
    store.getState().reportDatabaseError({ kind: 'databaseCorrupted' });
    expect(store.getState().databaseError).toEqual({ kind: 'databaseCorrupted' });
    store.getState().clearDatabaseError();
    expect(store.getState().databaseError).toBeNull();
  });

  it('keeps separate state per store instance', () => {
    const a = createAppStore();
    const b = createAppStore();
    a.getState().showAirport('LLBG');
    expect(b.getState().selectedAirportId).toBeNull();
  });
});
