// The running build number (Swift: CFBundleVersion). expo-constants' `nativeBuildVersion` is gone in current SDKs, so it is
// read from expo-application. A build that cannot be read is null, never 0: the remote-config update banner must not nag for it.
import * as Application from 'expo-application';

/** The numeric build, or null when the platform gives none (web, a preview) or it is not a number. */
export function parseBuildNumber(raw: string | null | undefined): number | null {
  if (raw == null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export const appBuildNumber = (): number | null => parseBuildNumber(Application.nativeBuildVersion);

/** The build as text for Settings' About row; '1' when unknown, as before. */
export const appBuildLabel = (): string => Application.nativeBuildVersion ?? '1';
