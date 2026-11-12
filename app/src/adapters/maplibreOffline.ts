// MapLibre RN v11 OfflineManager behind the domain OfflineEngine port (domain/offline/offlineMapService.ts).
// Pack creation, listing, pause/resume and delete map one to one; progress and error listeners are per pack.
import { OfflineManager } from '@maplibre/maplibre-react-native';
import { toEnginePack, type EnginePack, type OfflineEngine } from '../domain/offline/offlineMapService';

export function createMapLibreOfflineEngine(): OfflineEngine {
  return {
    async createPack(options, onProgress, onError) {
      // `mapStyle` takes a style JSON string. The metadata is stored as JSON and read back as an object.
      const pack = await OfflineManager.createPack(
        {
          mapStyle: options.styleJson,
          bounds: options.bounds,
          minZoom: options.minZoom,
          maxZoom: options.maxZoom,
          metadata: JSON.parse(options.metadata) as Record<string, unknown>,
        },
        (p) => onProgress(p.id),
        (p, e) => onError(p.id, e.message),
      );
      return { id: pack.id };
    },

    async listPacks(): Promise<EnginePack[]> {
      const packs = await OfflineManager.getPacks();
      // One pack whose status call fails must not hide the rest.
      return Promise.all(packs.map(async (p) => toEnginePack(p.id, p.metadata, await p.status().catch(() => null))));
    },

    async resume(id) {
      await (await OfflineManager.getPack(id)).resume();
    },
    async pause(id) {
      await (await OfflineManager.getPack(id)).pause();
    },
    async delete(id) {
      await OfflineManager.deletePack(id);
    },
  };
}
