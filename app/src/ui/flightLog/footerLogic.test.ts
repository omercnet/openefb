// Port of efb-212Tests/ViewModelTests/ZoomStepperTests.swift (3 cases, same names) plus the footer's static helpers
// (FlightLogFooter.gpsText / gpsTint) and the NRST cell text, which have no Swift tests.
import type { GpsStatus } from '../../domain/location/gpsStatus';
import { Day } from '../tokens';
import {
  ZoomStepper,
  monoFitScale,
  runMapAction,
  gpsText,
  gpsTint,
  nearestAccessibilityText,
  nearestIdent,
  nrstBearing,
  nrstDistance,
} from './footerLogic';

describe('Zoom stepper', () => {
  it('quickTapsAddUpBeforeTheCameraReports', () => {
    const stepper = new ZoomStepper();
    expect(stepper.step(1, 10)).toBe(11);
    expect(stepper.step(1, 10)).toBe(12); // mapZoom still reads 10
  });

  it('aReportedZoomStartsTheNextTapFromThere', () => {
    const stepper = new ZoomStepper();
    stepper.step(1, 10);
    stepper.reset(); // the pilot pinched to 7
    expect(stepper.step(-1, 7)).toBe(6);
  });

  it('tapsStopAtTheLimits', () => {
    const stepper = new ZoomStepper();
    expect(stepper.step(1, 18)).toBe(18);
    stepper.reset();
    expect(stepper.step(-1, 2)).toBe(2);
  });
});

describe('gpsText / gpsTint', () => {
  const cases: [string, GpsStatus, string, string][] = [
    ['ok', { kind: 'ok' }, 'GPS 3D', Day.ok],
    ['degraded', { kind: 'degraded', reason: { kind: 'noAltitude' } }, 'GPS DEGR', Day.caution],
    ['lost, never fixed', { kind: 'lost', ageSeconds: null }, 'GPS LOST', Day.warning],
    ['lost 14 s ago', { kind: 'lost', ageSeconds: 14 }, 'GPS LOST 14 S', Day.warning],
  ];
  it.each(cases)('%s', (_name, status, text, tint) => {
    expect(gpsText(status)).toBe(text);
    expect(gpsTint(status, Day)).toBe(tint);
  });
});

describe('NRST cell', () => {
  const airport = { icao: 'KPAO' } as never;
  const entry = { airport, distance: 2.04, bearing: 116.4 };

  it('formats distance with one decimal and bearing as three digits', () => {
    expect(nrstDistance(2.04)).toBe('2.0 NM');
    expect(nrstBearing(116.4)).toBe('116\u00B0');
    expect(nrstBearing(7.2)).toBe('007\u00B0');
  });

  it('rounds exact ties to even like String(format:), as the strip does', () => {
    expect(nrstBearing(116.5)).toBe('116\u00B0');
    expect(nrstBearing(117.5)).toBe('118\u00B0');
    expect(nrstDistance(0.25)).toBe('0.2 NM');
    expect(nearestAccessibilityText(true, { airport, distance: 0.25, bearing: 116.5 })).toBe(
      'Nearest airport KPAO, 0.2 nautical miles, bearing 116 degrees',
    );
  });

  it('names the airport, NONE without one, NO GPS without a fix, NO DATA outside airport coverage', () => {
    expect(nearestIdent(true, entry, true)).toBe('KPAO');
    expect(nearestIdent(true, null, true)).toBe('NONE');
    expect(nearestIdent(true, null, false)).toBe('NO GPS');
    expect(nearestIdent(false, entry, true)).toBe('NO DATA');
  });

  it('speaks range and bearing, then the optional cautions in the Swift order', () => {
    expect(nearestAccessibilityText(true, entry)).toBe('Nearest airport KPAO, 2.0 nautical miles, bearing 116 degrees');
    expect(
      nearestAccessibilityText(true, {
        ...entry,
        runwaySummary: '13/31 2443 ft',
        isPrivateUse: true,
        isMilitary: true,
        requiresPPR: true,
        isClosedByNotam: true,
      }),
    ).toBe(
      'Nearest airport KPAO, 2.0 nautical miles, bearing 116 degrees, runway 13/31 2443 ft, private use, ' +
        'military, emergency use only, prior permission required, a NOTAM names this field closed',
    );
    expect(nearestAccessibilityText(true, null)).toBe('Nearest airports. No landable airport yet.');
    expect(nearestAccessibilityText(false, entry)).toBe('Nearest airports. No airport data for this region yet.');
  });
});

describe('monoFitScale', () => {
  it('keeps text that fits, shrinks what does not, stops at the minimum', () => {
    expect(monoFitScale(6, 15, 78, 0.7)).toBe(1); // "GPS 3D": 54pt
    expect(monoFitScale(12, 15, 78, 0.7)).toBeCloseTo(78 / 108);
    expect(monoFitScale(13, 15, 78, 0.7)).toBe(0.7);
    expect(monoFitScale(0, 15, 78, 0.7)).toBe(1);
  });
});

describe('runMapAction', () => {
  it('swallows a throw and a rejection, calling onFail for each', async () => {
    const onFail = jest.fn();
    runMapAction(() => {
      throw new Error('x');
    }, onFail);
    runMapAction(() => Promise.reject(new Error('y')), onFail);
    await Promise.resolve();
    await Promise.resolve();
    expect(onFail).toHaveBeenCalledTimes(2);
    runMapAction(() => {}, onFail);
    runMapAction(() => Promise.resolve(), onFail);
    await Promise.resolve();
    expect(onFail).toHaveBeenCalledTimes(2);
  });
});
