/**
 * Headless checks for the oxygen / health rules.
 * Run with: node tests/player.test.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

for (const file of ["js/config.js", "js/player.js"]) {
  vm.runInThisContext(readFileSync(join(root, file), "utf8"), { filename: file });
}

const { CONFIG, FEATURE, TERRAIN, Player, featureBlocksMovement } = globalThis.Wilds;

let currentTerrain = TERRAIN.GRASS;
let treeTile = null;
let passed = 0;
let failed = 0;

const fakeWorld = {
  findSpawn: () => ({ tx: 0, ty: 0, clearing: true }),
  terrainAt: () => currentTerrain,
  featureAt: (tx, ty) => (
    treeTile && tx === treeTile.tx && ty === treeTile.ty ? FEATURE.TREE : FEATURE.NONE
  ),
};

function createPlayer() {
  currentTerrain = TERRAIN.GRASS;
  treeTile = null;
  return new Player(fakeWorld);
}

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

console.log("\nWilds — oxygen & health checks\n");

test("solid ground features block by default while embedded coal stays passable", () => {
  assert(featureBlocksMovement(FEATURE.TREE) === true, "tree blocks");
  assert(featureBlocksMovement(FEATURE.COAL) === false, "coal passable");
  assert(featureBlocksMovement(FEATURE.SILICA) === false, "silica passable");
  assert(featureBlocksMovement(FEATURE.NONE) === false, "empty passable");
  assert(featureBlocksMovement(999) === true, "future feature blocks by default");
});

test("health and oxygen start at their configured maxima", () => {
  const player = createPlayer();
  assert(player.maxHealth === 100, "max health");
  assert(player.health === 100, "initial health");
  assert(player.maxOxygen === 10, "max oxygen");
  assert(player.oxygen === 10, "initial oxygen");
  assert(player.isDiving === false, "spawn is dry land");
  assert(CONFIG.DROWN_DAMAGE_PER_SECOND === 10, "drown damage rate");
});

test("ocean switches the player into the diving state", () => {
  const player = createPlayer();
  currentTerrain = TERRAIN.OCEAN;
  player.updateVitals(0.25);
  assert(player.isDiving === true, "should be diving");
});

test("trees block movement", () => {
  const player = createPlayer();
  treeTile = { tx: 1, ty: 0 };

  for (let i = 0; i < 60; i += 1) {
    player.update(0.05, 1, 0, false);
  }

  assert(player.x > 10, "player should approach the tree");
  assert(player.x < 16, "player should stop before the tree tile: " + player.x);
  assert(player.tileX === 0, "player should remain outside the tree tile");

  treeTile = null;
  for (let i = 0; i < 20; i += 1) {
    player.update(0.05, 1, 0, false);
  }
  assert(player.tileX > 0, "removed tree should no longer block");
});

test("oxygen drains by one point per second underwater", () => {
  const player = createPlayer();
  currentTerrain = TERRAIN.OCEAN;
  player.updateVitals(1);
  assertNear(player.oxygen, 9, 1e-9, "after 1 s");
  player.updateVitals(0.5);
  assertNear(player.oxygen, 8.5, 1e-9, "after 1.5 s");
  assertNear(player.health, 100, 1e-9, "no health loss while oxygen remains");
});

test("oxygen stops at zero rather than turning negative", () => {
  const player = createPlayer();
  currentTerrain = TERRAIN.OCEAN;
  player.updateVitals(30);
  assert(player.oxygen === 0, "oxygen should clamp to zero");
});

test("oxygen recovers by one point per second on land", () => {
  const player = createPlayer();
  player.oxygen = 4;
  player.health = 55;
  player.updateVitals(1.25);
  assertNear(player.oxygen, 5.25, 1e-9, "recovery");
  assertNear(player.health, 55, 1e-9, "health must not regenerate yet");
});

test("oxygen recovery caps at ten and clears the diving state", () => {
  const player = createPlayer();
  player.oxygen = 0;
  player.health = 30;
  player.updateVitals(20);
  assert(player.oxygen === 10, "oxygen cap");
  assert(player.health === 30, "health unchanged");
  assert(player.isDiving === false, "on land after leaving water");
});

test("zero oxygen underwater drains health at ten per second", () => {
  const player = createPlayer();
  player.oxygen = 0;
  player.health = 100;
  currentTerrain = TERRAIN.OCEAN;

  player.updateVitals(1);
  assertNear(player.health, 90, 1e-9, "after 1 s");
  player.updateVitals(2);
  assertNear(player.health, 70, 1e-9, "after 3 s total");
  assert(player.oxygen === 0, "oxygen stays empty");
});

test("health cannot drop below zero", () => {
  const player = createPlayer();
  player.oxygen = 0;
  player.health = 5;
  currentTerrain = TERRAIN.OCEAN;
  player.updateVitals(2);
  assert(player.health === 0, "health clamps at zero");
  player.updateVitals(10);
  assert(player.health === 0, "zero health is stable");
});

test("leaving water stops drowning damage", () => {
  const player = createPlayer();
  player.oxygen = 0;
  player.health = 80;
  currentTerrain = TERRAIN.OCEAN;
  player.updateVitals(1);
  assertNear(player.health, 70, 1e-9, "drowning");

  currentTerrain = TERRAIN.GRASS;
  player.updateVitals(1);
  assertNear(player.health, 70, 1e-9, "no drowning on land");
  assertNear(player.oxygen, 1, 1e-9, "oxygen begins recovering");
  assert(player.isDiving === false, "diving state cleared");
});

test("resetting to a new world restores full health and oxygen", () => {
  const player = createPlayer();
  player.oxygen = 0;
  player.health = 0;
  currentTerrain = TERRAIN.OCEAN;
  player.updateVitals(1);

  currentTerrain = TERRAIN.GRASS;
  player.reset(fakeWorld);

  assert(player.oxygen === 10, "oxygen reset");
  assert(player.health === 100, "health reset");
  assert(player.isDiving === false, "not diving after respawn");
});

test("zero satiety drains one health per real second and stops after eating", () => {
  currentTerrain = TERRAIN.GRASS;
  const player = createPlayer();
  player.satiety = 0;
  for (let i = 0; i < 20; i++) player.updateVitals(0.05);
  assert(Math.abs(player.health - 99) < 0.000001, "one real second costs one health");
  player.satiety = 1;
  player.updateVitals(2);
  assert(Math.abs(player.health - 99) < 0.000001, "eating stops starvation damage");
  player.satiety = 0; player.health = 0.5;
  player.updateVitals(1);
  assert(player.health === 0, "starvation cannot reduce health below zero");
});

console.log("\n  " + passed + " passed, " + failed + " failed\n");
process.exitCode = failed === 0 ? 0 : 1;
