// Port of NotamCredentials (efb-212/Services/NotamService.swift) as Settings > NOTAM API uses it: the FAA client id and
// secret kept in the SecretStore. The NOTAM service (S1) reads the same two keys.
import { NOTAM_CLIENT_ID_KEY, NOTAM_CLIENT_SECRET_KEY, type SecretStore } from '../ports/secretStore';

export interface NotamCredentials {
  clientID: string;
  clientSecret: string;
}

/** FAA developer portal where the free NOTAM API key is requested. */
export const NOTAM_REGISTRATION_URL = 'https://api.faa.gov/s/';

/** Stored credentials, or null when either value is missing or blank. Values come back trimmed. */
export async function loadNotamCredentials(store: SecretStore): Promise<NotamCredentials | null> {
  const clientID = ((await store.get(NOTAM_CLIENT_ID_KEY)) ?? '').trim();
  if (clientID === '') return null;
  const clientSecret = ((await store.get(NOTAM_CLIENT_SECRET_KEY)) ?? '').trim();
  if (clientSecret === '') return null;
  return { clientID, clientSecret };
}

/**
 * Writes the id, then the secret. JS-only guard: if the secret write fails, the previous id is put back (best effort,
 * the original error is the one thrown), because an old secret read next to a new id would authenticate as nobody.
 */
export async function saveNotamCredentials(store: SecretStore, credentials: NotamCredentials): Promise<void> {
  const previousID = await store.get(NOTAM_CLIENT_ID_KEY);
  await store.set(NOTAM_CLIENT_ID_KEY, credentials.clientID);
  try {
    await store.set(NOTAM_CLIENT_SECRET_KEY, credentials.clientSecret);
  } catch (error) {
    try {
      if (previousID === null) await store.remove(NOTAM_CLIENT_ID_KEY);
      else await store.set(NOTAM_CLIENT_ID_KEY, previousID);
    } catch {
      // The write error below is the one the user needs; load() still treats a lone id as "not configured".
    }
    throw error;
  }
}

/** Removes both values. JS-only guard: both removals are attempted even when the first fails; the first error is thrown. */
export async function removeNotamCredentials(store: SecretStore): Promise<void> {
  const failures: unknown[] = [];
  for (const key of [NOTAM_CLIENT_ID_KEY, NOTAM_CLIENT_SECRET_KEY]) {
    try {
      await store.remove(key);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw failures[0];
}
