// The dimensions a count is filed under, from what the platform reports. Pure, so they are tested without the platform.

/** "1.2.0" for the version of the app; a pre-release or build suffix ("1.2.0-beta.3", "1.2.0+45") is dropped. Null when it is not x.y.z. */
export function appVersionDimension(version: unknown): string | null {
  if (typeof version !== 'string') return null;
  const match = /^([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})(?:[-+].*)?$/.exec(version);
  return match?.[1] ?? null;
}

/**
 * "embedded" for the app as it was built (or when updates are off, as in development), otherwise the id of the OTA update it is
 * running, lower-cased. `isEmbeddedLaunch` and `updateId` are what expo-updates reports. The schema rejects an id that is not a UUID.
 */
export function updateDimension(isEmbeddedLaunch: boolean | undefined, updateId: string | null | undefined): string {
  if (isEmbeddedLaunch === true || !updateId) return 'embedded';
  return updateId.toLowerCase();
}
