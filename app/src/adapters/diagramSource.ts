// The overlay controller takes one DiagramPackSource; each region has its own pack (Israel: `il-diagrams`, US:
// `us-diagrams`). This routes by region, so a US camera never reads the Israel pack and the other way round.
import type { DiagramPackSource } from '../domain/diagram/overlayController';

export function createDiagramSource(sources: { israel: DiagramPackSource; us: DiagramPackSource }): DiagramPackSource {
  return {
    candidates: (region, center, radiusNM) => sources[region].candidates(region, center, radiusNM),
    diagramFor: (region, icao) => sources[region].diagramFor(region, icao),
  };
}
