/**
 * Headless checks for the accelerated game clock and daylight curve.
 * Run with: node tests/time.test.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

for (const file of ["js/config.js", "js/time.js"]) {
  vm.runInThisContext(readFileSync(join(root, file), "utf8"), { filename: file });
}

const { GameClock, TIME_SCALE } = globalThis.Wilds;
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("  ok  " + name);
  } catch (error) {
    failed += 1;
    console.error("FAIL  " + name);
    console.error("      " + error.message);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNear(actual, expected, tolerance, label) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(label + ": expected " + expected + " ± " + tolerance + ", got " + actual);
  }
}

console.log("\nWilds — clock & daylight checks\n");

test("a new clock starts at day 1, 06:00, dawn", () => {
  const clock = new GameClock();
  assert(clock.day === 1, "day 1");
  assertNear(clock.hours, 6, 1e-9, "start hour");
  assert(clock.formatTime() === "06:00", "formatted time");
  assert(clock.phase.key === "dawn", "dawn phase");
  assert(clock.phase.label === "清晨", "dawn label");
});

test("24 game hours take exactly 300 real seconds", () => {
  assertNear(TIME_SCALE, 288, 1e-9, "game seconds per real second");

  const clock = new GameClock();
  clock.update(300);
  assert(clock.day === 2, "one day should have passed");
  assertNear(clock.hours, 6, 1e-6, "time should wrap back to 06:00");
  assert(clock.formatTime() === "06:00", "clock after one full cycle");
});

test("one real second advances four minutes and 48 seconds", () => {
  const clock = new GameClock();
  clock.update(1);
  assertNear(clock.time, 21600 + 288, 1e-9, "game time after 1 real second");
  assert(clock.formatTime() === "06:04", "minute display");
});

test("midnight crossing advances the day counter", () => {
  const clock = new GameClock();
  clock.setTimeOfDay(23);
  clock.update(3600 / TIME_SCALE);
  assert(clock.day === 2, "day increments at midnight");
  assertNear(clock.hours, 0, 1e-6, "clock at midnight");
  assert(clock.formatTime() === "00:00", "midnight format");
});

test("time formatting is zero padded and normalises out-of-range hours", () => {
  const clock = new GameClock();
  clock.setTimeOfDay(6.5);
  assert(clock.formatTime() === "06:30", "half past six");
  clock.setTimeOfDay(25);
  assert(clock.formatTime() === "01:00", "25:00 wraps to 01:00");
  clock.setTimeOfDay(-1);
  assert(clock.formatTime() === "23:00", "-01:00 wraps to 23:00");
});

test("phases follow the day cycle", () => {
  const clock = new GameClock();
  const cases = [
    [5, "dawn", "清晨"],
    [6, "dawn", "清晨"],
    [7, "day", "白天"],
    [12, "day", "白天"],
    [16.99, "day", "白天"],
    [17, "dusk", "黄昏"],
    [19.99, "dusk", "黄昏"],
    [20, "night", "夜晚"],
    [0, "night", "夜晚"],
    [4.99, "night", "夜晚"],
  ];

  for (const [hour, key, label] of cases) {
    clock.setTimeOfDay(hour);
    assert(clock.phase.key === key, "phase at " + hour + ": " + clock.phase.key);
    assert(clock.phase.label === label, "label at " + hour);
  }
});

test("noon has no darkness, midnight is dark", () => {
  const clock = new GameClock();

  clock.setTimeOfDay(12);
  assertNear(clock.lighting.darkness, 0, 1e-9, "noon darkness");
  assert(clock.lighting.warm < 0.01, "noon should be essentially un-tinted");

  clock.setTimeOfDay(0);
  assert(clock.lighting.darkness > 0.7, "midnight darkness");
  assertNear(clock.lighting.warm, 0, 1e-9, "midnight warmth");
});

test("dawn and dusk apply a warm light wash", () => {
  const clock = new GameClock();

  clock.setTimeOfDay(6);
  assert(clock.lighting.warm >= 0.06, "dawn warmth");
  assert(clock.lighting.darkness > 0.02, "dawn still has a little darkness");

  clock.setTimeOfDay(18.5);
  assert(clock.lighting.warm > 0.1, "dusk warmth");
  assert(clock.lighting.darkness > 0.15, "dusk begins to darken");
});

test("lighting changes gradually between adjacent dawn samples", () => {
  const clock = new GameClock();
  const samples = [];

  for (const hour of [5, 5.5, 6, 6.5, 7]) {
    clock.setTimeOfDay(hour);
    samples.push(clock.lighting.darkness);
  }

  for (let i = 1; i < samples.length; i += 1) {
    assert(samples[i] <= samples[i - 1] + 1e-9, "dawn should get brighter: " + samples.join(", "));
  }

  assert(samples[0] > samples[4], "dawn spans a visible range");
});

console.log("\n  " + passed + " passed, " + failed + " failed\n");
process.exitCode = failed === 0 ? 0 : 1;
