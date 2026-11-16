/* =========================================================
   Infinite procedural terrain.

   The world is never materialised as one giant array. Terrain is
   calculated from a seed and integer tile coordinates on demand,
   stored in a small FIFO chunk cache, and can be regenerated forever.

   Ocean coverage comes from a broad continent field. Rock is a
   separate, faster-moving outcrop field; this keeps rocky patches
   scattered through the grass instead of piling up at one global peak.
   ========================================================= */

(function () {
  "use strict";

  const { CONFIG, TERRAIN, FEATURE } = Wilds;
  const CHUNK_SIZE = CONFIG.CHUNK_SIZE;
  const TARGET_OCEAN = 0.2;
  const TARGET_GRASS = 0.5;
  const TARGET_ROCK = 0.3;
  const LAND_SHARE = 1 - TARGET_OCEAN;
  const ROCK_SHARE_OF_LAND = TARGET_ROCK / LAND_SHARE; // 0.375

  const OCEAN_OCTAVES = Object.freeze([
    Object.freeze({ frequency: 1 / 112, amplitude: 0.52, offsetX: 17.3, offsetY: -8.1, salt: 0x1b56c4e9 }),
    Object.freeze({ frequency: 1 / 53, amplitude: 0.27, offsetX: -31.7, offsetY: 22.4, salt: 0x7feb352d }),
    Object.freeze({ frequency: 1 / 24, amplitude: 0.14, offsetX: 8.9, offsetY: 3.6, salt: 0x846ca68b }),
    Object.freeze({ frequency: 1 / 11, amplitude: 0.07, offsetX: -14.2, offsetY: -26.8, salt: 0x9e3779b1 }),
  ]);

  const ROCK_OCTAVES = Object.freeze([
    Object.freeze({ frequency: 1 / 52, amplitude: 0.52, offsetX: 3.1, offsetY: -10.4, salt: 0x1e9f3a71 }),
    Object.freeze({ frequency: 1 / 25, amplitude: 0.30, offsetX: 17.3, offsetY: 8.2, salt: 0x7c3d9b45 }),
    Object.freeze({ frequency: 1 / 12, amplitude: 0.18, offsetX: -9.7, offsetY: 21.6, salt: 0x53a8e21d }),
  ]);

  const OCEAN_WARP = Object.freeze({
    frequency: 1 / 190,
    amplitude: 52,
    saltX: 0x5bf03635,
    saltY: 0x27d4eb2d,
  });

  const ROCK_WARP = Object.freeze({
    frequency: 1 / 160,
    amplitude: 30,
    saltX: 0xabcdef01,
    saltY: 0x13579bdf,
  });

  const VIEW_HALF_W = Math.floor(CONFIG.VIEW_WIDTH / CONFIG.TILE_SIZE / 2);
  const VIEW_HALF_H = Math.floor(CONFIG.VIEW_HEIGHT / CONFIG.TILE_SIZE / 2);
  const SPAWN_CENTER_STEP = 12;
  const SPAWN_CENTER_RADIUS = 216;
  const SPAWN_CLEARING_RADIUS = 24;
  const SPAWN_SAMPLE_X = Object.freeze([-12, -8, -4, 0, 4, 8, 12]);
  const SPAWN_SAMPLE_Y = Object.freeze([-7, -4, 0, 4, 7]);

  // Surface features use a broad density field plus a per-tile roll.
  // The density field makes groves / coal seams; the roll keeps the
  // individual placements irregular instead of forming obvious bands.
  const TREE_FIELD = Object.freeze({
    frequency: 0.045,
    offsetX: 11.7,
    offsetY: -7.3,
    salt: 0x3a5f18d7,
    rollSalt: 0x74c2a91b,
    baseChance: 0.012,
    chanceScale: 0.15,
  });

  const COAL_FIELD = Object.freeze({
    frequency: 0.07,
    offsetX: 4.2,
    offsetY: 9.1,
    salt: 0x7e2a4c91,
    rollSalt: 0x19d4e6af,
    baseChance: 0.018,
    chanceScale: 0.18,
  });

  function imul(a, b) {
    return Math.imul(a | 0, b | 0);
  }

  /** Deterministic 2D integer hash, returned as a number in [0, 1). */
  function hash2(x, y, seed) {
    let h = imul(x, 0x27d4eb2d) ^ imul(y, 0x165667b1) ^ (seed | 0);
    h = imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = imul(h ^ (h >>> 12), 0x297a2d39);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }

  function mulberry32(seed) {
    let state = seed | 0;
    return function random() {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /** Smooth value noise on a seeded integer lattice. */
  function noise2(x, y, seed) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = x - x0;
    const ty = y - y0;

    const u = fade(tx);
    const v = fade(ty);

    const n00 = hash2(x0, y0, seed);
    const n10 = hash2(x0 + 1, y0, seed);
    const n01 = hash2(x0, y0 + 1, seed);
    const n11 = hash2(x0 + 1, y0 + 1, seed);

    return lerp(
      lerp(n00, n10, u),
      lerp(n01, n11, u),
      v
    );
  }

  function warpedFbm(x, y, seed, warp, octaves) {
    const warpX = noise2(
      x * warp.frequency + 9.3,
      y * warp.frequency - 5.1,
      seed ^ warp.saltX
    );
    const warpY = noise2(
      x * warp.frequency - 4.7,
      y * warp.frequency + 12.6,
      seed ^ warp.saltY
    );

    const wx = x + (warpX - 0.5) * warp.amplitude;
    const wy = y + (warpY - 0.5) * warp.amplitude;

    let sum = 0;
    let totalWeight = 0;

    for (let i = 0; i < octaves.length; i += 1) {
      const octave = octaves[i];
      sum += octave.amplitude * noise2(
        wx * octave.frequency + octave.offsetX,
        wy * octave.frequency + octave.offsetY,
        seed ^ octave.salt
      );
      totalWeight += octave.amplitude;
    }

    return sum / totalWeight;
  }

  /** Broad land/sea field. Low values become ocean. */
  function oceanValueAt(x, y, seed) {
    return warpedFbm(x, y, seed, OCEAN_WARP, OCEAN_OCTAVES);
  }

  /** Faster rocky-outcrop field. High values become rock. */
  function rockValueAt(x, y, seed) {
    return warpedFbm(x, y, seed, ROCK_WARP, ROCK_OCTAVES);
  }

  function classify(oceanValue, rockValue, thresholds) {
    if (oceanValue < thresholds.ocean) return TERRAIN.OCEAN;
    if (rockValue > thresholds.rock) return TERRAIN.ROCK;
    return TERRAIN.GRASS;
  }

  /**
   * Calibrate two cut-offs for this seed:
   *   - 20% of all tiles are below the ocean cut-off;
   *   - of the remaining 80% land, the rock cut-off marks the
   *     highest 37.5%, which is 30% of the whole world.
   */
  function calibrate(seed) {
    const count = CONFIG.CALIBRATION_SAMPLES;
    const extent = CONFIG.CALIBRATION_EXTENT;
    const oceanValues = new Float64Array(count);
    const rockValues = new Float64Array(count);
    const random = mulberry32(seed ^ 0x9e3779b9);

    for (let i = 0; i < count; i += 1) {
      const x = (random() * 2 - 1) * extent;
      const y = (random() * 2 - 1) * extent;
      oceanValues[i] = oceanValueAt(x, y, seed);
      rockValues[i] = rockValueAt(x, y, seed);
    }

    oceanValues.sort();
    const oceanThreshold = oceanValues[Math.floor(count * TARGET_OCEAN)];

    // Collect only land samples for the second cut-off.
    const landRockValues = new Float32Array(count);
    let landCount = 0;

    for (let i = 0; i < count; i += 1) {
      if (oceanValues[i] >= oceanThreshold) {
        landRockValues[landCount] = rockValues[i];
        landCount += 1;
      }
    }

    const landSlice = landRockValues.subarray(0, landCount);
    landSlice.sort();
    const rockThreshold = landSlice[Math.floor(landCount * (1 - ROCK_SHARE_OF_LAND))];

    return Object.freeze({
      ocean: oceanThreshold,
      rock: rockThreshold,
    });
  }

  function chunkKey(cx, cy) {
    return cx + ":" + cy;
  }

  function tileKey(tx, ty) {
    return tx + ":" + ty;
  }

  function createWorld(rawSeed) {
    const seed = rawSeed >>> 0;
    const isDebugMap = seed === 0x123456;
    const thresholds = calibrate(seed);
    const cache = new Map();
    const removedFeatures = new Set();
    const depthCache = new Map();
    const dugTiles = new Set();
    const stats = {
      generatedChunks: 0,
      cacheHits: 0,
      cacheMisses: 0,
      evictedChunks: 0,
    };

    function generateChunk(cx, cy) {
      const data = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
      const originX = cx * CHUNK_SIZE;
      const originY = cy * CHUNK_SIZE;

      for (let ly = 0; ly < CHUNK_SIZE; ly += 1) {
        for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
          const x = originX + lx;
          const y = originY + ly;
          const oceanValue = oceanValueAt(x, y, seed);
          const rockValue = rockValueAt(x, y, seed);
          data[ly * CHUNK_SIZE + lx] = classify(oceanValue, rockValue, thresholds);
        }
      }

      stats.generatedChunks += 1;
      return data;
    }

    function getChunk(cx, cy) {
      const key = chunkKey(cx, cy);
      const cached = cache.get(key);

      if (cached !== undefined) {
        stats.cacheHits += 1;
        return cached;
      }

      stats.cacheMisses += 1;
      const chunk = generateChunk(cx, cy);
      cache.set(key, chunk);

      if (cache.size > CONFIG.CACHE_LIMIT) {
        const oldestKey = cache.keys().next().value;
        cache.delete(oldestKey);
        stats.evictedChunks += 1;
      }

      return chunk;
    }

    function terrainAt(tx, ty) {
      if(isDebugMap && tx>=-40 && tx<=60 && ty>=-40 && ty<=40) {
        if((tx>=5) || (tx>=-15 && tx<=-13 && ty>=6 && ty<=8))return TERRAIN.OCEAN;
        return ty>=6?TERRAIN.ROCK:TERRAIN.GRASS;
      }
      const tileX = Math.floor(tx);
      const tileY = Math.floor(ty);
      const cx = Math.floor(tileX / CHUNK_SIZE);
      const cy = Math.floor(tileY / CHUNK_SIZE);
      const lx = tileX - cx * CHUNK_SIZE;
      const ly = tileY - cy * CHUNK_SIZE;
      return getChunk(cx, cy)[ly * CHUNK_SIZE + lx];
    }

    // Water within two tiles of any shore is shallow; small pools can be all shallow.
    function waterDepthAt(tx, ty) {
      tx = Math.floor(tx); ty = Math.floor(ty);
      if (terrainAt(tx, ty) !== TERRAIN.OCEAN) return 0;
      const key = tileKey(tx, ty);
      if (depthCache.has(key)) return depthCache.get(key);
      let depth = 2;
      outer: for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (terrainAt(tx + dx, ty + dy) !== TERRAIN.OCEAN) { depth = 1; break outer; }
      }
      if (depthCache.size > 20000) depthCache.clear();
      depthCache.set(key, depth); return depth;
    }

    /**
     * Surface features sit on top of the ground. Trees only appear on
     * grass, coal only on rock; both are deterministic for a seed and
     * can be removed later without changing the terrain tile underneath.
     */
    function featureAt(tx, ty) {
      const x = Math.floor(tx);
      const y = Math.floor(ty);
      const terrain = terrainAt(x, y);

      if (removedFeatures.has(tileKey(x, y))) return FEATURE.NONE;
      if(isDebugMap && x>=-40 && x<=60 && y>=-40 && y<=40) {
        if(terrain===TERRAIN.OCEAN)return waterDepthAt(x,y)===2 && x%3===0 && y%3===0?FEATURE.SILICA:FEATURE.NONE;
        if(x>=-14 && x<=-10 && y>=-6 && y<=-2 && x%2===0 && y%2===0)return FEATURE.TREE;
        if(terrain===TERRAIN.ROCK && x>=-6 && x<=2 && y>=14 && y<=18 && x%2===0)return FEATURE.COAL;
        return FEATURE.NONE;
      }
      if (terrain === TERRAIN.OCEAN) return waterDepthAt(x, y) === 2 && hash2(x, y, seed ^ 0x6a71c932) < 0.08 ? FEATURE.SILICA : FEATURE.NONE;

      const field = terrain === TERRAIN.GRASS ? TREE_FIELD : COAL_FIELD;
      const density = noise2(
        x * field.frequency + field.offsetX,
        y * field.frequency + field.offsetY,
        seed ^ field.salt
      );
      const chance = field.baseChance + density * density * field.chanceScale;

      if (hash2(x, y, seed ^ field.rollSalt) >= chance) {
        return FEATURE.NONE;
      }

      return terrain === TERRAIN.GRASS ? FEATURE.TREE : FEATURE.COAL;
    }

    function removeFeatureAt(tx, ty) {
      removedFeatures.add(tileKey(Math.floor(tx), Math.floor(ty)));
    }

    function isDug(tx, ty) {
      return dugTiles.has(tileKey(Math.floor(tx), Math.floor(ty)));
    }

    function markDug(tx, ty) {
      dugTiles.add(tileKey(Math.floor(tx), Math.floor(ty)));
    }

    function isGrassPatch(tx, ty) {
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          const x = tx + ox;
          const y = ty + oy;
          if (terrainAt(x, y) !== TERRAIN.GRASS) {
            return false;
          }
          // Do not spawn on top of a blocking tree.
          if (featureAt(x, y) === FEATURE.TREE) {
            return false;
          }
        }
      }
      return true;
    }

    function viewCounts(tx, ty, step) {
      const counts = [0, 0, 0];

      for (let oy = -VIEW_HALF_H; oy <= VIEW_HALF_H; oy += step) {
        for (let ox = -VIEW_HALF_W; ox <= VIEW_HALF_W; ox += step) {
          counts[terrainAt(tx + ox, ty + oy)] += 1;
        }
      }

      return counts;
    }

    function sparseViewCounts(tx, ty) {
      const counts = [0, 0, 0];

      for (let i = 0; i < SPAWN_SAMPLE_Y.length; i += 1) {
        for (let j = 0; j < SPAWN_SAMPLE_X.length; j += 1) {
          counts[terrainAt(tx + SPAWN_SAMPLE_X[j], ty + SPAWN_SAMPLE_Y[i])] += 1;
        }
      }

      return counts;
    }

    function viewMinimumShare(counts) {
      const total = counts[0] + counts[1] + counts[2];
      return total === 0 ? 0 : Math.min(counts[0], counts[1], counts[2]) / total;
    }

    function findGrassPatchNear(centerX, centerY, maxRadius) {
      for (let radius = 0; radius <= maxRadius; radius += 1) {
        if (radius === 0) {
          if (isGrassPatch(centerX, centerY)) {
            return { tx: centerX, ty: centerY };
          }
          continue;
        }

        for (let x = centerX - radius; x <= centerX + radius; x += 1) {
          for (const y of [centerY - radius, centerY + radius]) {
            if (isGrassPatch(x, y)) return { tx: x, ty: y };
          }
        }

        for (let y = centerY - radius + 1; y <= centerY + radius - 1; y += 1) {
          for (const x of [centerX - radius, centerX + radius]) {
            if (isGrassPatch(x, y)) return { tx: x, ty: y };
          }
        }
      }

      return null;
    }

    /**
     * The opening frame should introduce the whole palette. Scan coarse
     * view centres outward from the origin until we find a mixed view,
     * then snap to a nearby 3 × 3 grass clearing and verify the final
     * frame. For most seeds this resolves within a few milliseconds.
     */
    function findSpawn() {
      if(isDebugMap)return {tx:-1,ty:2,clearing:true};
      let best = null;

      const evaluateCenter = (centerX, centerY) => {
        const sparse = sparseViewCounts(centerX, centerY);
        const sparseShare = viewMinimumShare(sparse);

        if (sparse[0] < 2 || sparse[1] < 2 || sparse[2] < 2 || sparseShare < 0.1) {
          return null;
        }

        const patch = findGrassPatchNear(centerX, centerY, SPAWN_CLEARING_RADIUS);
        if (!patch) return null;

        const composition = viewCounts(patch.tx, patch.ty, 1);
        const share = viewMinimumShare(composition);

        if (!best || share > best.share) {
          best = {
            tx: patch.tx,
            ty: patch.ty,
            clearing: true,
            composition: composition.slice(),
            share,
          };
        }

        if (Math.min(composition[0], composition[1], composition[2]) >= 24 && share >= 0.08) {
          return best;
        }

        return null;
      };

      for (let radius = 0; radius <= SPAWN_CENTER_RADIUS; radius += SPAWN_CENTER_STEP) {
        if (radius === 0) {
          const found = evaluateCenter(0, 0);
          if (found) return found;
          continue;
        }

        for (let x = -radius; x <= radius; x += SPAWN_CENTER_STEP) {
          const top = evaluateCenter(x, -radius);
          if (top) return top;
          const bottom = evaluateCenter(x, radius);
          if (bottom) return bottom;
        }

        for (let y = -radius + SPAWN_CENTER_STEP; y <= radius - SPAWN_CENTER_STEP; y += SPAWN_CENTER_STEP) {
          const left = evaluateCenter(-radius, y);
          if (left) return left;
          const right = evaluateCenter(radius, y);
          if (right) return right;
        }
      }

      if (best) return best;

      const clearing = findGrassPatchNear(0, 0, 96);
      if (clearing) {
        return {
          tx: clearing.tx,
          ty: clearing.ty,
          clearing: true,
          composition: viewCounts(clearing.tx, clearing.ty, 1),
          share: 0,
        };
      }

      return fallbackSpawn();
    }

    function fallbackSpawn() {
      // Practically unreachable with an 80%-land world, but keeps the
      // game playable for any future generator tweak.
      for (let radius = 0; radius <= 512; radius += 1) {
        if (radius === 0) {
          if (terrainAt(0, 0) === TERRAIN.GRASS) {
            return { tx: 0, ty: 0, clearing: false, composition: null, share: 0 };
          }
          continue;
        }

        for (let x = -radius; x <= radius; x += 1) {
          for (const y of [-radius, radius]) {
            if (terrainAt(x, y) === TERRAIN.GRASS) {
              return { tx: x, ty: y, clearing: false, composition: null, share: 0 };
            }
          }
        }

        for (let y = -radius + 1; y <= radius - 1; y += 1) {
          for (const x of [-radius, radius]) {
            if (terrainAt(x, y) === TERRAIN.GRASS) {
              return { tx: x, ty: y, clearing: false, composition: null, share: 0 };
            }
          }
        }
      }

      return { tx: 0, ty: 0, clearing: false, composition: null, share: 0 };
    }

    function sampleRatios(count, extent) {
      const total = Number.isFinite(count) ? count : CONFIG.SAMPLE_COUNT;
      const range = Number.isFinite(extent) ? extent : 8000;
      const random = mulberry32(seed ^ 0xb5297a4d);
      const counts = [0, 0, 0];

      for (let i = 0; i < total; i += 1) {
        const x = (random() * 2 - 1) * range;
        const y = (random() * 2 - 1) * range;
        const type = classify(oceanValueAt(x, y, seed), rockValueAt(x, y, seed), thresholds);
        counts[type] += 1;
      }

      return Object.freeze({
        total,
        counts: Object.freeze(counts.slice()),
        fractions: Object.freeze(counts.map((value) => value / total)),
        percentages: Object.freeze(counts.map((value) => (value / total) * 100)),
      });
    }

    function getCacheStats() {
      return {
        cachedChunks: cache.size,
        limit: CONFIG.CACHE_LIMIT,
        generatedChunks: stats.generatedChunks,
        cacheHits: stats.cacheHits,
        cacheMisses: stats.cacheMisses,
        evictedChunks: stats.evictedChunks,
      };
    }

    return Object.freeze({
      seed,
      isDebugMap,
      thresholds,
      terrainAt,
      waterDepthAt,
      featureAt,
      removeFeatureAt,
      isDug,
      markDug,
      oceanValueAt: (x, y) => oceanValueAt(x, y, seed),
      rockValueAt: (x, y) => rockValueAt(x, y, seed),
      findSpawn,
      sampleRatios,
      getCacheStats,
    });
  }

  globalThis.Wilds = Object.assign(globalThis.Wilds || {}, {
    World: Object.freeze({
      createWorld,
      hash2,
      noise2,
      oceanValueAt,
      rockValueAt,
      calibrate,
    }),
  });
})();
