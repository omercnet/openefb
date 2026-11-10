// Port of efb-212/Services/Recording/AutoStartGate.swift.
// After a manual End Recording, holds auto-start off until the aircraft slows to or below the
// threshold (or a new coordinator, which starts with an open gate).

export class AutoStartGate {
  isSuppressed = false;

  /** The pilot ended the recording by hand. */
  manualStop(): void {
    this.isSuppressed = true;
  }

  /** Feed the latest ground speed. Returns true when auto-start may arm. */
  update(speedKts: number, thresholdKts: number): boolean {
    if (this.isSuppressed && speedKts <= thresholdKts) {
      this.isSuppressed = false;
    }
    return !this.isSuppressed;
  }
}
