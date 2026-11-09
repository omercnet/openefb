// R2 key layout shared by the Worker and the publisher CLI. No runtime imports.
export const SEGMENT = /^[A-Za-z0-9._-]{1,128}$/;
export const PLATFORMS = ["ios", "android"];

export const pointerKey = (channel: string, rv: string, platform: string) => `channels/${channel}/${rv}/${platform}.json`;
export const archiveKey = (channel: string, rv: string, platform: string, name: string) => `updates/${channel}/${rv}/${platform}/${name}.json`;
export const assetKey = (sha256hex: string) => `assets/${sha256hex}`;
