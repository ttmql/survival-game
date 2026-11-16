/* =========================================================
   Game clock and daylight curve.

   One in-game day (24 h) passes in five real-world minutes. Lighting is
   expressed as two translucent canvas overlays: a cool darkness for
   night and a warm wash around sunrise/sunset. Both are interpolated
   smoothly so dawn and dusk move gradually rather than switching.
   ========================================================= */

(function () {
  "use strict";

  const { CONFIG } = Wilds;

  const SECONDS_PER_DAY = CONFIG.SECONDS_PER_GAME_DAY;
  const GAME_SECONDS_PER_REAL_SECOND = SECONDS_PER_DAY / CONFIG.REAL_SECONDS_PER_GAME_DAY;

  const PHASES = Object.freeze({
    dawn: Object.freeze({ key: "dawn", label: "清晨" }),
    day: Object.freeze({ key: "day", label: "白天" }),
    dusk: Object.freeze({ key: "dusk", label: "黄昏" }),
    night: Object.freeze({ key: "night", label: "夜晚" }),
  });

  /**
   * hour, darkness (cool overlay alpha), warm (sunset/sunrise alpha).
   * The 24:00 key closes the loop with the same values as 00:00.
   */
  const LIGHT_KEYS = Object.freeze([
    Object.freeze({ hour: 0, darkness: 0.72, warm: 0 }),
    Object.freeze({ hour: 4.5, darkness: 0.66, warm: 0 }),
    Object.freeze({ hour: 5.5, darkness: 0.38, warm: 0.02 }),
    Object.freeze({ hour: 6, darkness: 0.08, warm: 0.07 }),
    Object.freeze({ hour: 6.75, darkness: 0.02, warm: 0.03 }),
    Object.freeze({ hour: 7.5, darkness: 0, warm: 0.01 }),
    Object.freeze({ hour: 8, darkness: 0, warm: 0 }),
    Object.freeze({ hour: 16.5, darkness: 0, warm: 0.015 }),
    Object.freeze({ hour: 17.5, darkness: 0.06, warm: 0.1 }),
    Object.freeze({ hour: 18.5, darkness: 0.25, warm: 0.16 }),
    Object.freeze({ hour: 19.5, darkness: 0.47, warm: 0.07 }),
    Object.freeze({ hour: 20.5, darkness: 0.64, warm: 0.015 }),
    Object.freeze({ hour: 22, darkness: 0.72, warm: 0 }),
    Object.freeze({ hour: 24, darkness: 0.72, warm: 0 }),
  ]);

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function smoothstep(t) {
    const clamped = Math.max(0, Math.min(1, t));
    return clamped * clamped * (3 - 2 * clamped);
  }

  class GameClock {
    constructor() {
      this.reset();
    }

    reset() {
      this.time = CONFIG.GAME_START_HOUR * 3600;
      this.day = 1;
    }

    /** Advance by real-world seconds. */
    update(realDeltaSeconds) {
      if (!Number.isFinite(realDeltaSeconds) || realDeltaSeconds <= 0) return;

      this.time += realDeltaSeconds * GAME_SECONDS_PER_REAL_SECOND;

      while (this.time >= SECONDS_PER_DAY) {
        this.time -= SECONDS_PER_DAY;
        this.day += 1;
      }
    }

    /** Jump to an hour of the current day (mainly useful for tests/debugging). */
    setTimeOfDay(hours) {
      if (!Number.isFinite(hours)) return;
      const normalized = ((hours % 24) + 24) % 24;
      this.time = normalized * 3600;
    }

    get hours() {
      return this.time / 3600;
    }

    get phase() {
      const hour = this.hours;

      if (hour >= 5 && hour < 7) return PHASES.dawn;
      if (hour >= 7 && hour < 17) return PHASES.day;
      if (hour >= 17 && hour < 20) return PHASES.dusk;
      return PHASES.night;
    }

    formatTime() {
      const totalMinutes = Math.floor(this.time / 60) % 1440;
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      return String(hours).padStart(2, "0") + ":" + String(minutes).padStart(2, "0");
    }

    get lighting() {
      const hour = this.hours;
      let from = LIGHT_KEYS[0];
      let to = LIGHT_KEYS[LIGHT_KEYS.length - 1];

      for (let i = 1; i < LIGHT_KEYS.length; i += 1) {
        if (hour <= LIGHT_KEYS[i].hour) {
          from = LIGHT_KEYS[i - 1];
          to = LIGHT_KEYS[i];
          break;
        }
      }

      const span = to.hour - from.hour;
      const t = smoothstep(span === 0 ? 0 : (hour - from.hour) / span);

      return {
        darkness: lerp(from.darkness, to.darkness, t),
        warm: lerp(from.warm, to.warm, t),
        // Dawn light is a pale gold; sunset leans orange-red.
        warmColor: hour < 12 ? "255, 209, 143" : "244, 139, 85",
      };
    }
  }

  globalThis.Wilds = Object.assign(globalThis.Wilds || {}, {
    GameClock,
    TIME_SCALE: GAME_SECONDS_PER_REAL_SECOND,
  });
})();
