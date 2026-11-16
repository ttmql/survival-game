/* Ground fixtures: category, stacking, neighbour connections and collision shape.
 * Open doors retain their blocking slot, but only their swung panel is solid.
 */
(function () {
  "use strict";
  const T = Wilds.CONFIG.TILE_SIZE;
  const WALL_HEIGHT = 18;
  const FENCE_HEIGHT = 11;
  const ROOF_INTERIOR_ALPHA = 0.04;
  const WOODEN_FIXTURES = new Set(["driftwood", "workbench", "torch", "bed", "storage_chest", "wood_floor", "wood_door", "wood_fence", "fence_gate"]);
  const miningTool = (type) => WOODEN_FIXTURES.has(type) ? "axe" : "pickaxe";
  const height = (object) => ({ wall: WALL_HEIGHT, wood_door: WALL_HEIGHT,
    wood_fence: FENCE_HEIGHT, fence_gate: FENCE_HEIGHT, stele: 15,
    respawn_stele: 7, furnace: 5, workbench: 0, storage_chest: 0, bed: 0 }[object.type] ?? 0);
  const PASSABLE = new Set(["torch", "wood_floor", "driftwood", "roof"]);
  const isBlocking = (object) => !PASSABLE.has(object.type);
  const isDoor = (object) => object.type === "wood_door" || object.type === "fence_gate";
  const priority = (object) => isBlocking(object) ? 0 : ({ roof: 1, torch: 2, wood_floor: 3, driftwood: 3 }[object.type] ?? 4);
  const key = (object) => `${object.tx},${object.ty}` + (isBlocking(object) ? "" : `:${object.type}`);

  function connections(object, at) {
    const family = object.type === "wood_door" ? ["wall", "wood_door"] : ["wood_fence", "fence_gate"];
    const has = (dx, dy) => at(object.tx + dx, object.ty + dy).some(o => family.includes(o.type));
    return { left: has(-1, 0), right: has(1, 0), up: has(0, -1), down: has(0, 1) };
  }

  function doorPose(object, at) {
    const c = connections(object, at);
    // More neighbours wins; ties use horizontal. One neighbour is the hinge.
    const horizontal = Number(c.left) + Number(c.right) >= Number(c.up) + Number(c.down);
    const near = horizontal ? c.left || !c.right : c.up || !c.down;
    return { horizontal, near };
  }

  function rectangles(object, at) {
    if (!isBlocking(object)) return [];
    const x = object.tx * T, y = object.ty * T;
    if (isDoor(object) && object.open) {
      const { horizontal, near } = doorPose(object, at);
      return horizontal
        ? [[x + (near ? 0 : T - 2), y, 2, T]]
        : [[x, y + (near ? 0 : T - 2), T, 2]];
    }
    if (object.type === "wood_fence") {
      const c = connections(object, at);
      const result = [[x + 8, y + 8, 4, 4]];
      if (c.left) result.push([x, y + 9, 10, 2]);
      if (c.right) result.push([x + 10, y + 9, 10, 2]);
      if (c.up) result.push([x + 9, y, 2, 10]);
      if (c.down) result.push([x + 9, y + 10, 2, 10]);
      return result;
    }
    return (object.tiles || [{ tx: object.tx, ty: object.ty }]).map(tile => [tile.tx * T, tile.ty * T, T, T]);
  }

  function transparentRoofs(objects, tx, ty) {
    const roofs = new Set(objects.filter(o => o.type === "roof").map(o => `${o.tx},${o.ty}`));
    const visible = new Set(), pending = [[tx, ty]];
    while (pending.length) {
      const [x, y] = pending.pop(), k = `${x},${y}`;
      if (!roofs.has(k) || visible.has(k)) continue;
      visible.add(k);
      pending.push([x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]);
    }
    return visible;
  }
  // Flood only roofed, unblocked cells: encountering any unroofed opening
  // makes the entire connected interior open. Work is bounded by roof count.
  class RoomIndex {
    constructor(objects, boundary) {
      this.byTile = new Map();
      this.closedRooms = [];
      const roofs = new Set(objects.filter(o => o.type === "roof").map(o => `${o.tx},${o.ty}`));
      const visited = new Set();
      for (const start of roofs) {
        if (visited.has(start)) continue;
        const [sx, sy] = start.split(",").map(Number);
        if (boundary(sx, sy)) { visited.add(start); continue; }
        const pending = [[sx, sy]], cells = [], tiles = new Set();
        let closed = true;
        while (pending.length) {
          const [x, y] = pending.pop(), k = `${x},${y}`;
          if (visited.has(k)) continue;
          visited.add(k); tiles.add(k); cells.push({ tx: x, ty: y });
          for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
            if (boundary(nx, ny)) continue;
            if (!roofs.has(`${nx},${ny}`)) closed = false;
            else if (!visited.has(`${nx},${ny}`)) pending.push([nx, ny]);
          }
        }
        if (closed) {
          const room = { id: this.closedRooms.length + 1, cells, tiles };
          this.closedRooms.push(room);
          for (const k of tiles) this.byTile.set(k, room);
        }
      }
      // Boundary fixtures, including corner walls, belong to the enclosed room.
      // Shared walls have one deterministic owner so their lamps never light both rooms.
      for (const room of this.closedRooms) {
        room.surfaceCells = room.cells.slice();
        for (const cell of room.cells) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const tx = cell.tx + dx, ty = cell.ty + dy, key = `${tx},${ty}`;
          if (boundary(tx, ty) && !this.byTile.has(key)) {
            this.byTile.set(key, room); room.surfaceCells.push({ tx, ty });
          }
        }
      }
      this.torches = objects.filter(o => o.type === "torch");
      this.boundary = boundary;
    }

    at(tx, ty) { return this.byTile.get(`${tx},${ty}`) || null; }

    torchesFor(room) {
      return room.torches || (room.torches = this.torches.filter(torch => this.at(torch.tx, torch.ty) === room));
    }
  }

  Wilds.Buildings = { WALL_HEIGHT, FENCE_HEIGHT, ROOF_INTERIOR_ALPHA, height, miningTool, isBlocking, isDoor, priority, key, connections, doorPose, rectangles, transparentRoofs, RoomIndex };
})();
