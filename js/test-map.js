/* 固定的村落与农田，供两种模式在相同场景下体验。 */
(function () {
  "use strict";

  const { TERRAIN } = Wilds;
  const BLOCK_WIDTH = 26;
  const BLOCK_HEIGHT = 22;
  const FIRST_BLOCK = -1;
  const LAST_BLOCK = 1;
  const PADDY_ROWS = [12, 13, 15, 16, 18, 19];
  const CROP_STAGES = [0.25, 1.25, 2.25, 3, 3];

  function contains(x, y) {
    return x >= FIRST_BLOCK * BLOCK_WIDTH && x < (LAST_BLOCK + 1) * BLOCK_WIDTH &&
      y >= FIRST_BLOCK * BLOCK_HEIGHT && y < (LAST_BLOCK + 1) * BLOCK_HEIGHT;
  }

  function terrainAt(x, y) {
    if (!contains(x, y)) return undefined;
    const column = x - Math.floor(x / BLOCK_WIDTH) * BLOCK_WIDTH;
    const row = y - Math.floor(y / BLOCK_HEIGHT) * BLOCK_HEIGHT;
    if (column === 0 || row === 0) return TERRAIN.ROCK;
    if (column >= 14 && column <= 23 && PADDY_ROWS.includes(row)) return TERRAIN.OCEAN;
    return TERRAIN.GRASS;
  }

  function buildHouse(place, top, entrance, furnished) {
    const bottom = top + 6;
    for (let y = top; y <= bottom; y++) {
      for (let x = 3; x <= 10; x++) {
        place("wood_floor", x, y);
        if (x === 3 || x === 10 || y === top || y === bottom) {
          place(y === entrance && x === 6 ? "wood_door" : "wall", x, y);
        } else {
          place("roof", x, y);
        }
      }
    }
    place("storage_chest", 8, top + 2);
    place("storage_chest", 9, top + 2);
    if (furnished) {
      place("workbench", 4, top + 2);
      place("furnace", 4, top + 3);
      place("torch", 4, top + 3);
    } else {
      place("comfortable_bed", 4, top + 2);
    }
  }

  function populate(farm, addFixture) {
    for (let blockY = FIRST_BLOCK; blockY <= LAST_BLOCK; blockY++) {
      for (let blockX = FIRST_BLOCK; blockX <= LAST_BLOCK; blockX++) {
        const originX = blockX * BLOCK_WIDTH;
        const originY = blockY * BLOCK_HEIGHT;
        const place = (itemId, x, y) => addFixture(itemId, originX + x, originY + y);
        const plant = (x, y, crop, growth) => {
          const tx = originX + x, ty = originY + y;
          const plot = { tx, ty, crop, growth };
          if (crop !== "rice") Object.assign(plot, { soil: true, wet: true, dryAge: 0 });
          farm.set(`${tx},${ty}`, plot);
        };

        buildHouse(place, 3, 3, true);
        buildHouse(place, 12, 18, false);
        place("stele", 2, 5);
        place("respawn_stele", 2, 16);
        place("torch", 4, 2);
        place("torch", 8, 19);

        for (let y = 2; y <= 10; y++) {
          for (let x = 12; x <= 24; x++) {
            if (x === 12 || x === 24 || y === 2 || y === 10) {
              place(x === 20 && (y === 2 || y === 10) ? "fence_gate" : "wood_fence", x, y);
            }
          }
        }
        place("torch", 12, 2);
        place("torch", 24, 10);

        for (let x = 14; x <= 23; x++) {
          const growth = CROP_STAGES[Math.floor((x - 14) / 2)];
          for (let y = 4; y <= 9; y++) plant(x, y, "wheat", growth);
          for (const y of PADDY_ROWS) {
            if (x === 14) place("driftwood", x, y);
            else plant(x, y, "rice", growth);
          }
        }
        for (let x = 4; x <= 10; x += 2) plant(x, 20, "sapling", (x - 4) / 3);
      }
    }
  }

  Wilds.TestMap = {
    seedText: "12345678",
    startHour: 12,
    layout: { contains, terrainAt, spawn: { tx: 1, ty: 1, clearing: true } },
    populate,
  };
})();
