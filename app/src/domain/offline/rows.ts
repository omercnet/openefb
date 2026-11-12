// View model for the Offline Maps list (Views/Settings/OfflineMapsView.swift): one row per pack with its status text.
import { layerDisplayName, formatOfflineSize } from './layers';
import { packFraction, packHasAllResources, packIsExpired, type OfflinePackSummary } from './packModel';

export interface OfflinePackRow {
  id: string;
  title: string;
  subtitle: string;
  /** 0..1 */
  fraction: number;
  /** Which row action applies: pause while downloading, resume while paused, redownload when expired or failed. */
  action: 'pause' | 'resume' | 'redownload' | 'none';
}

export function offlinePackRow(p: OfflinePackSummary, atMs: number): OfflinePackRow {
  const title = `${p.context.name} (${layerDisplayName(p.context.layer)})`;
  const size = formatOfflineSize(p.completedBytes);
  const pct = `${Math.round(packFraction(p) * 100)}%`;
  switch (p.state.kind) {
    case 'failed':
      return {
        id: p.context.id,
        title,
        subtitle: `Failed: ${p.state.reason}`,
        fraction: packFraction(p),
        action: 'redownload',
      };
    case 'downloading':
      return {
        id: p.context.id,
        title,
        subtitle: `Downloading ${pct} (${size})`,
        fraction: packFraction(p),
        action: 'pause',
      };
    case 'paused':
      return {
        id: p.context.id,
        title,
        subtitle: `Paused ${pct} (${size})`,
        fraction: packFraction(p),
        action: 'resume',
      };
    case 'complete':
      if (packIsExpired(p, atMs))
        return {
          id: p.context.id,
          title,
          subtitle: `Expired chart cycle (${size})`,
          fraction: 1,
          action: 'redownload',
        };
      if (!packHasAllResources(p))
        return {
          id: p.context.id,
          title,
          subtitle: `Incomplete ${pct} (${size})`,
          fraction: packFraction(p),
          action: 'redownload',
        };
      return { id: p.context.id, title, subtitle: `Ready (${size})`, fraction: 1, action: 'none' };
  }
}
