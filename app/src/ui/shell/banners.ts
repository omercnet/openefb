// RemoteConfigBanner.items (Views/Components/RemoteConfigBanner.swift): a required update first, then the notices that
// apply to the region. A recommended update is a Settings line only, as in Swift.
import type { Region } from '../../domain/core';
import { resolveText, type RemoteNotice } from '../../services/remoteConfig';
import { UPDATE_BANNER_ID } from '../../services/remoteConfigStore';
import type { BannerItem } from '../components/Components';

export interface BannerSource {
  updateRequest: { kind: 'required' | 'recommended'; message: string } | null;
  notices(region: Region): RemoteNotice[];
  isBannerDismissed(id: string): boolean;
}

export function bannerItems(source: BannerSource, region: Region): BannerItem[] {
  const items: BannerItem[] = [];
  const update = source.updateRequest;
  if (update?.kind === 'required' && !source.isBannerDismissed(UPDATE_BANNER_ID)) {
    items.push({ id: UPDATE_BANNER_ID, text: update.message, isCaution: true, offersUpdate: true });
  }
  for (const notice of source.notices(region)) {
    items.push({
      id: notice.id,
      text: resolveText(notice.text),
      isCaution: notice.severity === 'caution',
      offersUpdate: false,
    });
  }
  return items;
}
