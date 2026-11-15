import type { RemoteNotice } from '../../services/remoteConfig';
import { UPDATE_BANNER_ID } from '../../services/remoteConfigStore';
import { bannerItems, type BannerSource } from './banners';

const notice = (id: string, severity: 'info' | 'caution'): RemoteNotice => ({
  id,
  severity,
  regions: new Set(),
  untilMs: null,
  text: { english: `text ${id}`, hebrew: null },
});

const source = (over: Partial<BannerSource> = {}): BannerSource => ({
  updateRequest: null,
  notices: () => [],
  isBannerDismissed: () => false,
  ...over,
});

describe('bannerItems', () => {
  it('is empty with nothing to say', () => {
    expect(bannerItems(source(), 'us')).toEqual([]);
  });

  it('puts a required update first, as a caution that offers the App Store', () => {
    const items = bannerItems(
      source({ updateRequest: { kind: 'required', message: 'Update now' }, notices: () => [notice('n1', 'info')] }),
      'us',
    );
    expect(items.map((i) => i.id)).toEqual([UPDATE_BANNER_ID, 'n1']);
    expect(items[0]).toMatchObject({ text: 'Update now', isCaution: true, offersUpdate: true });
    expect(items[1]).toMatchObject({ text: 'text n1', isCaution: false, offersUpdate: false });
  });

  it('a recommended update is not a banner', () => {
    expect(bannerItems(source({ updateRequest: { kind: 'recommended', message: 'x' } }), 'us')).toEqual([]);
  });

  it('a dismissed required update stays hidden', () => {
    const s = source({
      updateRequest: { kind: 'required', message: 'x' },
      isBannerDismissed: (id) => id === UPDATE_BANNER_ID,
    });
    expect(bannerItems(s, 'us')).toEqual([]);
  });

  it('asks the store for the notices of the region', () => {
    const asked: string[] = [];
    bannerItems(source({ notices: (r) => (asked.push(r), []) }), 'israel');
    expect(asked).toEqual(['israel']);
  });
});
