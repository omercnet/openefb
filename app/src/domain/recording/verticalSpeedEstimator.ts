// Port of efb-212/Services/Recording/VerticalSpeedEstimator.swift.
// Vertical speed (feet per minute) from successive GPS altitude fixes, EMA smoothed.
// Uses fix timestamps (epoch ms), never the wall clock.

export class VerticalSpeedEstimator {
  /** EMA time constant in seconds. alpha = 1 - exp(-dt / timeConstant). */
  readonly timeConstantSeconds: number;
  /** Current smoothed estimate in feet per minute. 0 until two valid fixes have been seen. */
  verticalSpeedFPM = 0;

  private lastAltitudeFeet: number | null = null;
  private lastTimestamp: number | null = null;
  private hasEstimate = false;

  constructor(timeConstantSeconds = 5) {
    this.timeConstantSeconds = timeConstantSeconds;
  }

  /**
   * Feed one fix and return the updated estimate in feet per minute.
   * A negative verticalAccuracyMeters means the altitude is invalid: the fix is ignored.
   */
  update(altitudeFeet: number, timestampMs: number, verticalAccuracyMeters: number): number {
    if (!(verticalAccuracyMeters >= 0)) return this.verticalSpeedFPM;

    if (this.lastAltitudeFeet === null || this.lastTimestamp === null) {
      this.lastAltitudeFeet = altitudeFeet;
      this.lastTimestamp = timestampMs;
      return this.verticalSpeedFPM;
    }

    const dt = (timestampMs - this.lastTimestamp) / 1000;
    if (!(dt > 0)) return this.verticalSpeedFPM; // duplicate or out-of-order fix

    const instantaneousFPM = ((altitudeFeet - this.lastAltitudeFeet) / dt) * 60;

    if (!this.hasEstimate) {
      this.verticalSpeedFPM = instantaneousFPM;
      this.hasEstimate = true;
    } else {
      const alpha = 1 - Math.exp(-dt / this.timeConstantSeconds);
      this.verticalSpeedFPM += alpha * (instantaneousFPM - this.verticalSpeedFPM);
    }

    this.lastAltitudeFeet = altitudeFeet;
    this.lastTimestamp = timestampMs;
    return this.verticalSpeedFPM;
  }
}
