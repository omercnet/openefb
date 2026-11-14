// The services behind the map data controller's source interfaces (Swift: MapViewModel's tfrService and airSigmetService).
import type { AdvisorySource } from '../../domain/map/mapDataController';
import type { MapAdvisory } from '../../domain/map/features';
import { advisoryColorHex } from '../../services/airSigmet';
import type { AirSigmetServiceLike as Service } from '../../services/airSigmetService';

export function advisorySource(service: Service): AdvisorySource {
  return {
    async currentAdvisories() {
      const snapshot = await service.currentAdvisories();
      const advisories: MapAdvisory[] = snapshot.advisories.map((a) => ({
        id: a.id,
        kind: a.kind,
        hazardCode: a.hazardCode,
        colorHex: advisoryColorHex(a.kind, a.hazard),
        validFrom: a.validFrom,
        validTo: a.validTo,
        boundaries: a.boundaries,
      }));
      return { advisories, fetchedAt: snapshot.fetchedAt };
    },
  };
}
