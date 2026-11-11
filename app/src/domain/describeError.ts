/** `error.localizedDescription` for anything that can be thrown: the message of an Error, else its string form. */
export function describeError(error: unknown): string {
  return error instanceof Error && error.message !== '' ? error.message : String(error);
}
