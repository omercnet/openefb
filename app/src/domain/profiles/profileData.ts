// The stored side of ViewModels/AircraftProfileViewModel.swift and PilotProfileViewModel.swift over UserData: the lists,
// create, update, delete, set active, and the night landings of a pilot. Where Swift saved a ModelContext once, a change that
// touches more than one record goes through `atomically`.
import { newAircraftProfile, newPilotProfile, type Factory } from '../../data/defaults';
import type { AircraftProfile, PilotProfile } from '../../data/models';
import type { Repository } from '../../data/repositories/table';
import type { UserData } from '../userData';
import type { AircraftFields } from './aircraft';
import { addNightLanding, type PilotFields } from './pilot';

/** The profile was deleted (or never existed) by the time the change reached the data. */
export class ProfileNotFoundError extends Error {
  constructor(kind: 'aircraft' | 'pilot') {
    super(`This ${kind} profile no longer exists.`);
    this.name = 'ProfileNotFoundError';
  }
}

/** Both view models list profiles newest first (the repositories list oldest first). */
const newestFirst = <T extends { createdAt: number }>(rows: readonly T[]): T[] =>
  [...rows].sort((a, b) => b.createdAt - a.createdAt);

export const loadAircraftProfiles = async (data: UserData): Promise<AircraftProfile[]> =>
  newestFirst(await data.aircraft.list());

export const loadPilotProfiles = async (data: UserData): Promise<PilotProfile[]> =>
  newestFirst(await data.pilots.list());

/** addProfile(nNumber:) plus the form's other fields: an inactive profile (nothing activates a new profile in Swift). */
export async function createAircraftProfile(
  data: UserData,
  fields: AircraftFields,
  factory: Factory = {},
): Promise<AircraftProfile> {
  const profile = newAircraftProfile(fields.nNumber, { ...factory, ...fields });
  await data.aircraft.insert(profile);
  return profile;
}

export async function updateAircraftProfile(
  data: UserData,
  id: string,
  fields: AircraftFields,
): Promise<AircraftProfile> {
  const updated = await data.aircraft.update(id, fields);
  if (updated === null) throw new ProfileNotFoundError('aircraft');
  return updated;
}

/** True when a profile was deleted. */
export const deleteAircraftProfile = (data: UserData, id: string): Promise<boolean> => data.aircraft.remove(id);

/** addProfile(): a blank, inactive pilot profile, inserted at once; the editor then fills it in. */
export async function createPilotProfile(data: UserData, factory: Factory = {}): Promise<PilotProfile> {
  const profile = newPilotProfile(factory);
  await data.pilots.insert(profile);
  return profile;
}

export async function updatePilotProfile(data: UserData, id: string, fields: PilotFields): Promise<PilotProfile> {
  const updated = await data.pilots.update(id, fields);
  if (updated === null) throw new ProfileNotFoundError('pilot');
  return updated;
}

export const deletePilotProfile = (data: UserData, id: string): Promise<boolean> => data.pilots.remove(id);

type Activatable = { id: string; isActive: boolean };

/** setActive: deactivate every other profile, then activate this one. A missing profile throws, which rolls the change back. */
async function activate<T extends Activatable>(
  repo: Repository<T>,
  id: string,
  kind: 'aircraft' | 'pilot',
): Promise<void> {
  for (const other of await repo.list()) {
    if (other.isActive && other.id !== id) await repo.update(other.id, { isActive: false } as Partial<Omit<T, 'id'>>);
  }
  if ((await repo.update(id, { isActive: true } as Partial<Omit<T, 'id'>>)) === null)
    throw new ProfileNotFoundError(kind);
}

export const setActiveAircraft = (data: UserData, id: string): Promise<void> =>
  data.atomically((tx) => activate(tx.aircraft, id, 'aircraft'));

export const setActivePilot = (data: UserData, id: string): Promise<void> =>
  data.atomically((tx) => activate(tx.pilots, id, 'pilot'));

/** addNightLandings: appends one entry to the pilot's list, reading and writing it in one transaction. */
export function addNightLandings(data: UserData, pilotId: string, date: number, count: number): Promise<void> {
  return data.atomically(async (tx) => {
    const pilot = await tx.pilots.get(pilotId);
    if (pilot === null) throw new ProfileNotFoundError('pilot');
    await tx.pilots.update(pilotId, { nightLandingEntries: addNightLanding(pilot.nightLandingEntries, date, count) });
  });
}
