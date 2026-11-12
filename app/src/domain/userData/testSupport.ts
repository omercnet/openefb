// Test helper for code that writes through UserData.
import type { UserData, UserDataRepos } from './index';

/** Wraps the repositories both when used directly and inside `atomically`, so a failure or a delay reaches transactional writes. */
export const viaTx = (data: UserData, wrap: (repos: UserDataRepos) => UserDataRepos): UserData => ({
  ...data,
  ...wrap(data),
  atomically: (fn) => data.atomically((tx) => fn(wrap(tx))),
});
