// Shared fixture that reproduces the iOS reference screenshots (reference/*.png):
// KPAO -> KOAK direct, ownship over Redwood City. Units: knots, degrees true, feet MSL, feet per minute, NM.
export const scenario = {
  ownship: { lat: 37.4876, lon: -122.2289, trkDeg: 296, gsKt: 96, altFt: 680, vsFpm: 475 },
  next: { ident: 'KOAK', name: 'Oakland Intl', lat: 37.7213, lon: -122.2208, distNm: 14.9, brgDeg: 349, etaLocal: '18:11', timeToGo: '9:12' },
  nearest: { ident: 'KPAO', distNm: 2.0, brgDeg: 116 },
  recording: { elapsed: '00:00:06' },
  gps: { label: 'GPS 3D', ok: true },
  altitudeTape: { minFt: 0, maxFt: 4000 },
  map: { center: [-122.22, 37.55] as [number, number], zoom: 10.2 },
  // 1, 2, 3, 5 minute ticks on the track ruler, from ownship along trkDeg
  trackRulerMinutes: [1, 2, 3, 5],
  airport: {
    ident: 'KSQL', name: 'San Carlos Airport', flightCategory: 'MVFR',
    elevationFt: 5, tpaFt: 800, weatherAgeMin: 12, fuelTypes: ['100LL', 'A', 'A+', 'UL94'],
    wx: { wind: 'Calm', vis: '9.0 SM', ceiling: "1200' BKN", temp: '15\u00B0C', dewpt: '13\u00B0C', altim: '30.18 inHg' },
    frequencies: [['ATIS', '125.900'], ['CTAF', '119.000'], ['UNICOM', '122.950'], ['APP', '133.950'], ['APP', '135.650'], ['TWR', '119.000'], ['GND', '118.025'], ['DEP', '135.650']],
    runways: [{ ident: '12/30', lengthFt: 2621, widthFt: 75, surface: 'Asphalt' }],
    chartsCycle: '2611', chartsValidTo: '11/26',
    approaches: ['RNAV (GPS) Y RWY 30', 'RNAV (GPS) Z RWY 30'],
  },
} as const;

export type Scenario = typeof scenario;
