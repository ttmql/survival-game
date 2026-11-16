/* Shared configuration. Kept dependency-free so the game runs from file://. */
(function () {
  "use strict";

  const TERRAIN = Object.freeze({
    OCEAN: 0,
    GRASS: 1,
    ROCK: 2,
  });

  // Features are solid ground fixtures by default. Embedded resources such
  // as coal are explicitly marked passable so future surface objects block
  // movement without needing another per-creature hard-coded check.
  const FEATURE = Object.freeze({
    NONE: 0,
    TREE: 1,
    COAL: 2,
    SILICA: 3,
  });
  const PASSABLE_FEATURES = Object.freeze([FEATURE.COAL, FEATURE.SILICA]);
  const featureBlocksMovement = (feature) =>
    feature !== FEATURE.NONE && !PASSABLE_FEATURES.includes(feature);

  const CONFIG = Object.freeze({
    // Canvas / world units. The internal canvas is 480×300 pixels at 20px
    // per tile, which is exactly 24×15 tiles, upscaled with nearest-neighbour.
    TILE_SIZE: 20,
    VIEW_WIDTH: 480,
    VIEW_HEIGHT: 300,
    // Terrain is lazily generated in 16×16 chunks and cached up to this
    // many entries (oldest evicted first).
    CHUNK_SIZE: 16,
    CACHE_LIMIT: 192,
    // Per-seed calibration: sample this many points to pin the ocean/rock
    // cut-offs so the target terrain ratios hold regardless of the seed.
    CALIBRATION_SAMPLES: 32768,
    CALIBRATION_EXTENT: 24000,
    // Player speed in pixels per second (walk / sprint).
    PLAYER_SPEED: 76,
    PLAYER_SPRINT_SPEED: 122,
    // Vital caps and rates.
    OXYGEN_MAX: 10,
    OXYGEN_DRAIN_PER_SECOND: 1,
    OXYGEN_REGEN_PER_SECOND: 1,
    HEALTH_MAX: 100,
    SATIETY_MAX: 100,
    SATIETY_GRACE_HOURS: 2,
    STARVATION_DAMAGE_PER_SECOND: 1,
    SATIETY_DRAIN_PER_GAME_DAY: 50,
    SATIETY_REGEN_HEALTH_PER_GAME_HOUR: 30,
    DROWN_DAMAGE_PER_SECOND: 10,
    // Ground drops disappear after one in-game day (~5 real minutes).
    DROP_LIFETIME_MS: 300000,
    // Time scale: 24 in-game hours pass in 300 real seconds.
    SECONDS_PER_GAME_DAY: 86400,
    REAL_SECONDS_PER_GAME_DAY: 300,
    GAME_START_HOUR: 6,
    SAMPLE_COUNT: 50000,
  });

  // Human-readable metadata for the HUD, minimap and world map.
  // `percent` is the target share used during seed calibration.
  const TERRAIN_META = Object.freeze({
    [TERRAIN.OCEAN]: Object.freeze({
      id: TERRAIN.OCEAN,
      key: "ocean",
      name: "海洋",
      percent: 20,
      uiColor: "#68b1b6",
    }),
    [TERRAIN.GRASS]: Object.freeze({
      id: TERRAIN.GRASS,
      key: "grass",
      name: "草地",
      percent: 50,
      uiColor: "#95b873",
    }),
    [TERRAIN.ROCK]: Object.freeze({
      id: TERRAIN.ROCK,
      key: "rock",
      name: "岩石",
      percent: 30,
      uiColor: "#b2aa9b",
    }),
  });

  // The order the player asked for: rock, grass, ocean.
  const TERRAIN_ORDER = Object.freeze([TERRAIN.ROCK, TERRAIN.GRASS, TERRAIN.OCEAN]);

  globalThis.Wilds = Object.assign(globalThis.Wilds || {}, {
    CONFIG,
    TERRAIN,
    FEATURE,
    PASSABLE_FEATURES,
    featureBlocksMovement,
    TERRAIN_META,
    TERRAIN_ORDER,
  });
})();
