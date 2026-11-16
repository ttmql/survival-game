/**
 * Headless checks for the terrain generator.
 * Run with: node tests/world.test.mjs
 *
 * These load the same classic scripts the browser uses, so the checks
 * cover the real configuration and noise field.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

for (const file of ["js/config.js", "js/world.js"]) {
  vm.runInThisContext(readFileSync(join(root, file), "utf8"), { filename: file });
}

const { World, TERRAIN, FEATURE } = globalThis.Wilds;
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
    throw new Error(
      label + ": expected " + expected + " ± " + tolerance + ", got " + actual.toFixed(3)
    );
  }
}

function fixedRandom(seedValue) {
  let state = seedValue | 0;
  return function random() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

console.log("\nWilds — terrain generator checks\n");

const seeds = [0x1a2b3c4d, 0xdeadbeef, 0x7f4a0c11, 0x42ca9cbd];
const ratioResults = [];

for (const worldSeed of seeds) {
  const world = World.createWorld(worldSeed);
  const started = performance.now();
  const ratios = world.sampleRatios(120000, 20000);
  const elapsed = performance.now() - started;
  ratioResults.push({ worldSeed, ratios, elapsed });
}

test("terrain proportions stay close to rock 30 / grass 50 / ocean 20", () => {
  for (const { worldSeed, ratios } of ratioResults) {
    const [ocean, grass, rock] = ratios.percentages;
    assertNear(ocean, 20, 1.2, "seed " + worldSeed.toString(16) + " ocean");
    assertNear(grass, 50, 1.2, "seed " + worldSeed.toString(16) + " grass");
    assertNear(rock, 30, 1.2, "seed " + worldSeed.toString(16) + " rock");

    const total = ocean + grass + rock;
    assertNear(total, 100, 0.0001, "share total");
  }
});

test("calibration thresholds are ordered and finite", () => {
  for (const worldSeed of seeds) {
    const world = World.createWorld(worldSeed);
    assert(Number.isFinite(world.thresholds.ocean), "ocean threshold must be finite");
    assert(Number.isFinite(world.thresholds.rock), "rock threshold must be finite");
    assert(world.thresholds.ocean > 0 && world.thresholds.ocean < 1, "ocean threshold must be in range");
    assert(world.thresholds.rock > 0 && world.thresholds.rock < 1, "rock threshold must be in range");
  }
});

test("the same seed reproduces the same world", () => {
  const a = World.createWorld(0x12345678);
  const b = World.createWorld(0x12345678);
  const random = fixedRandom(0xabc123);

  for (let i = 0; i < 4000; i += 1) {
    const x = Math.floor((random() * 2 - 1) * 4000);
    const y = Math.floor((random() * 2 - 1) * 4000);
    assert(a.terrainAt(x, y) === b.terrainAt(x, y), "tile mismatch at " + x + ", " + y);
  }
});

test("different seeds produce meaningfully different terrain", () => {
  const a = World.createWorld(0x11111111);
  const b = World.createWorld(0x22222222);
  const random = fixedRandom(0x505050);
  let differences = 0;

  for (let i = 0; i < 4000; i += 1) {
    const x = Math.floor((random() * 2 - 1) * 4000);
    const y = Math.floor((random() * 2 - 1) * 4000);
    if (a.terrainAt(x, y) !== b.terrainAt(x, y)) differences += 1;
  }

  assert(differences > 2200, "worlds look too similar: " + differences + "/4000");
});

test("terrain is stable across chunk boundaries and negative coordinates", () => {
  const world = World.createWorld(0x33445566);
  const points = [
    [0, 0], [15, 15], [16, 16], [-1, -1], [-16, -16], [-17, 31],
    [31, -32], [63, 64], [-64, 65], [999, -999],
  ];

  for (const [x, y] of points) {
    const first = world.terrainAt(x, y);
    const second = world.terrainAt(x, y);
    assert(first === second, "unstable tile at " + x + ", " + y);
    assert([TERRAIN.OCEAN, TERRAIN.GRASS, TERRAIN.ROCK].includes(first), "invalid terrain id");
  }
});

test("spawn is on a clear grass patch", () => {
  for (const worldSeed of seeds) {
    const world = World.createWorld(worldSeed);
    const spawn = world.findSpawn();
    assert(world.terrainAt(spawn.tx, spawn.ty) === TERRAIN.GRASS, "spawn must be grass");

    if (spawn.clearing) {
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          assert(
            world.terrainAt(spawn.tx + ox, spawn.ty + oy) === TERRAIN.GRASS,
            "spawn clearing has a non-grass neighbour"
          );
          assert(
            world.featureAt(spawn.tx + ox, spawn.ty + oy) !== FEATURE.TREE,
            "spawn clearing is blocked by a tree"
          );
        }
      }
    }
  }
});

test("the opening view introduces ocean, grass and rock", () => {
  for (const worldSeed of seeds) {
    const world = World.createWorld(worldSeed);
    const spawn = world.findSpawn();
    const counts = [0, 0, 0];

    for (let oy = -7; oy <= 7; oy += 1) {
      for (let ox = -12; ox <= 12; ox += 1) {
        counts[world.terrainAt(spawn.tx + ox, spawn.ty + oy)] += 1;
      }
    }

    assert(counts[TERRAIN.OCEAN] >= 20, "opening view needs visible ocean: " + counts.join("/"));
    assert(counts[TERRAIN.GRASS] >= 20, "opening view needs visible grass: " + counts.join("/"));
    assert(counts[TERRAIN.ROCK] >= 20, "opening view needs visible rock: " + counts.join("/"));
  }
});

test("trees grow only on grass and coal only on rock", () => {
  for (const worldSeed of seeds) {
    const world = World.createWorld(worldSeed);
    const spawn = world.findSpawn();
    const counts = { tree: 0, coal: 0, grass: 0, rock: 0, ocean: 0 };
    const invalid = [];

    for (let oy = -80; oy <= 80; oy += 1) {
      for (let ox = -80; ox <= 80; ox += 1) {
        const tx = spawn.tx + ox;
        const ty = spawn.ty + oy;
        const terrain = world.terrainAt(tx, ty);
        const feature = world.featureAt(tx, ty);

        if (terrain === TERRAIN.GRASS) counts.grass += 1;
        else if (terrain === TERRAIN.ROCK) counts.rock += 1;
        else counts.ocean += 1;

        if (feature === FEATURE.TREE) {
          counts.tree += 1;
          if (terrain !== TERRAIN.GRASS) invalid.push("tree@" + tx + "," + ty);
        } else if (feature === FEATURE.COAL) {
          counts.coal += 1;
          if (terrain !== TERRAIN.ROCK) invalid.push("coal@" + tx + "," + ty);
        } else if (feature === FEATURE.SILICA) {
          if (terrain !== TERRAIN.OCEAN || world.waterDepthAt(tx,ty) !== 2) invalid.push("silica@"+tx+","+ty);
        } else if (feature !== FEATURE.NONE) {
          invalid.push("unknown@" + tx + "," + ty);
        }
      }
    }

    assert(invalid.length === 0, "features on wrong terrain: " + invalid.slice(0, 3).join(", "));
    assert(counts.tree > 0, "sample area has no trees");
    assert(counts.coal > 0, "sample area has no coal");
    assert(counts.ocean > 0, "sample area has no ocean");

    const treeDensity = counts.tree / counts.grass;
    const coalDensity = counts.coal / counts.rock;
    assert(treeDensity > 0.02 && treeDensity < 0.16, "tree density out of range: " + treeDensity.toFixed(3));
    assert(coalDensity > 0.03 && coalDensity < 0.18, "coal density out of range: " + coalDensity.toFixed(3));
  }
});

test("surface features are deterministic for a seed", () => {
  const a = World.createWorld(0x13572468);
  const b = World.createWorld(0x13572468);
  const random = fixedRandom(0x99887766);

  for (let i = 0; i < 4000; i += 1) {
    const x = Math.floor((random() * 2 - 1) * 3000);
    const y = Math.floor((random() * 2 - 1) * 3000);
    assert(a.featureAt(x, y) === b.featureAt(x, y), "feature mismatch at " + x + ", " + y);
  }
});

test("features can be removed without changing the terrain underneath", () => {
  const world = World.createWorld(0x1a2b3c4d);
  const spawn = world.findSpawn();
  let tree = null;
  let coal = null;

  for (let oy = -30; oy <= 30 && (!tree || !coal); oy += 1) {
    for (let ox = -30; ox <= 30 && (!tree || !coal); ox += 1) {
      const tx = spawn.tx + ox;
      const ty = spawn.ty + oy;
      const feature = world.featureAt(tx, ty);
      if (feature === FEATURE.TREE && !tree) tree = { tx, ty };
      if (feature === FEATURE.COAL && !coal) coal = { tx, ty };
    }
  }

  assert(tree, "sample tree not found");
  assert(coal, "sample coal not found");

  const treeTerrain = world.terrainAt(tree.tx, tree.ty);
  const coalTerrain = world.terrainAt(coal.tx, coal.ty);

  world.removeFeatureAt(tree.tx, tree.ty);
  world.removeFeatureAt(coal.tx, coal.ty);

  assert(world.featureAt(tree.tx, tree.ty) === FEATURE.NONE, "tree should be removed");
  assert(world.featureAt(coal.tx, coal.ty) === FEATURE.NONE, "coal should be removed");
  assert(world.terrainAt(tree.tx, tree.ty) === treeTerrain, "tree terrain changed");
  assert(world.terrainAt(coal.tx, coal.ty) === coalTerrain, "coal terrain changed");
});

test("dug ground is tracked independently of terrain", () => {
  const world = World.createWorld(0x1a2b3c4d);
  const spawn = world.findSpawn();
  const tx = spawn.tx;
  const ty = spawn.ty;

  assert(world.isDug(tx, ty) === false, "spawn starts undug");
  const terrain = world.terrainAt(tx, ty);
  world.markDug(tx, ty);

  assert(world.isDug(tx, ty) === true, "tile should become dug");
  assert(world.terrainAt(tx, ty) === terrain, "digging must not change the terrain type");
});

test("chunk cache stays bounded while exploring a long line", () => {
  const world = World.createWorld(0x66778899);

  for (let cx = 0; cx < 230; cx += 1) {
    world.terrainAt(cx * 16 + 3, 3);
  }

  const stats = world.getCacheStats();
  assert(stats.cachedChunks <= stats.limit, "cache exceeded its limit");
  assert(stats.evictedChunks > 0, "cache never evicted an old chunk");
  assert(stats.generatedChunks >= 230, "not all requested chunks were generated");
});

test("sampling 120k points is not prohibitively slow", () => {
  const slowest = Math.max(...ratioResults.map((entry) => entry.elapsed));
  assert(slowest < 1500, "sampling took " + slowest.toFixed(0) + "ms");
});

console.log("\n  ratio samples");
for (const { worldSeed, ratios, elapsed } of ratioResults) {
  const [ocean, grass, rock] = ratios.percentages;
  console.log(
    "  seed " + worldSeed.toString(16).padStart(8, "0") +
    "  ocean " + ocean.toFixed(2) + "%" +
    "  grass " + grass.toFixed(2) + "%" +
    "  rock " + rock.toFixed(2) + "%" +
    "  (" + elapsed.toFixed(0) + "ms)"
  );
}

console.log("\n  " + passed + " passed, " + failed + " failed\n");
process.exitCode = failed === 0 ? 0 : 1;
