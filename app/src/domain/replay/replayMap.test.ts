// What the replay map draws, as data (efb-212/Services/MapService.swift: updateReplayTrack, updateReplayMarker, fitMapToTrack).
// MapLibre React Native has no imperative addLayer or setShape: the screen renders these as GeoJSON sources.
import { FIT_PADDING, REPLAY_COLOR, replayMarkerData, replayTrackData, trackBounds } from './replayMap';

const track = [
  { latitude: 32.8, longitude: 35.04 },
  { latitude: 32.78, longitude: 35.2 },
  { latitude: 32.6, longitude: 35.1 },
];

describe('replayTrackData', () => {
  it('is the track as one line, longitude first', () => {
    expect(replayTrackData(track)).toEqual({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [
              [35.04, 32.8],
              [35.2, 32.78],
              [35.1, 32.6],
            ],
          },
        },
      ],
    });
  });

  it('has nothing to draw for an empty track', () => {
    expect(replayTrackData([]).features).toEqual([]);
  });

  it('has nothing to draw for one point: a line of one position is not valid GeoJSON (JS-only guard)', () => {
    expect(replayTrackData([track[0]!]).features).toEqual([]);
  });
});

describe('replayMarkerData', () => {
  it('is one point at the replay position, longitude first, carrying the heading', () => {
    expect(replayMarkerData({ lat: 32.78, lon: 35.2 }, 274)).toEqual({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { heading: 274 }, geometry: { type: 'Point', coordinates: [35.2, 32.78] } },
      ],
    });
  });
});

describe('trackBounds (fitMapToTrack)', () => {
  it('is west, south, east, north of every point', () => {
    expect(trackBounds(track)).toEqual([35.04, 32.6, 35.2, 32.8]);
  });

  it('is nothing for an empty track: the camera stays where it is', () => {
    expect(trackBounds([])).toBeNull();
  });

  it('is a box of no size for one point', () => {
    expect(trackBounds([track[1]!])).toEqual([35.2, 32.78, 35.2, 32.78]);
  });

  it('handles a very long track (a spread of that many arguments overflows the stack)', () => {
    const long = Array.from({ length: 300_000 }, (_, i) => ({ latitude: 32 + i / 1e6, longitude: 35 - i / 1e6 }));
    expect(trackBounds(long)).toEqual([35 - 299_999 / 1e6, 32, 35, 32 + 299_999 / 1e6]);
  });

  it('does not depend on the order of the points', () => {
    expect(trackBounds([track[2]!, track[0]!, track[1]!])).toEqual([35.04, 32.6, 35.2, 32.8]);
  });
});

describe('constants', () => {
  it('pad the fitted track by 50 points on each side', () => {
    expect(FIT_PADDING).toEqual({ top: 50, right: 50, bottom: 50, left: 50 });
  });

  it('draw the replay in system orange', () => {
    expect(REPLAY_COLOR).toEqual({ day: '#FF9500', night: '#FF9F0A' });
  });
});
