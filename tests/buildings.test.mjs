import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const context = vm.createContext({ console, performance, document: { readyState: "loading", addEventListener() {} } });
for (const name of ["config", "buildings", "world", "inventory", "player", "renderer", "game"]) {
  let source = readFileSync(new URL(`../js/${name}.js`, import.meta.url), "utf8");
  if (name === "game") source = source.replace("  function boot() {", "  globalThis.TestGame = Game;\n  function boot() {");
  vm.runInContext(source, context);
}
const { Wilds: W, TestGame: Game } = context;
const B = W.Buildings;
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`  ok  ${name}`); }
function game() {
  const g = Object.create(Game.prototype);
  Object.assign(g, {
    world: { featureAt: () => W.FEATURE.NONE, terrainAt: () => W.TERRAIN.GRASS, findSpawn: () => ({ tx: 0, ty: 0 }), isDug: () => false },
    inventory: new W.Inventory(), placedObjects: new Map(), placedObjectTiles: new Map(), placedObjectSequence: 0,
    mobs: [], mobSequence: 0, drops: [], selectedSlot: null, respawn: null,
    renderInventory() {}, syncHeldStats() {}, hideItemDetails() {}, showToast() {}, drawMinimap() {},
    spawnDrop(...args) { this.drops.push(args); },
  });
  g.player = new W.Player(g.world);
  g.player.isBlockedArea = (...args) => g.groundAreaBlocked(...args);
  return g;
}
function place(g, type, x = 1, y = 0) {
  g.inventory.setSlot("equipment", 0, { itemId: type, count: 1 });
  g.selectedSlot = { area: "equipment", index: 0 };
  return g.placeSelectedObject(x, y);
}
test("all six recipes consume the requested materials", () => {
  for (const [id, costs] of Object.entries({ wall: { dirt: 1, rock: 1 }, wood_floor: { wood: 1 }, roof: { wood: 1, rock: 1 }, wood_door: { wood: 4 }, wood_fence: { wood: 1 }, fence_gate: { wood: 6 } })) {
    const inv = new W.Inventory(), recipe = W.RECIPES.find(r => r.output === id);
    assert.equal(JSON.stringify(recipe.costs), JSON.stringify(costs));
    for (const [item, n] of Object.entries(costs)) inv.addItem(item, n);
    assert.equal(inv.craft(recipe).ok, true); assert.equal(inv.countItem(id), 1);
    for (const item of Object.keys(costs)) assert.equal(inv.countItem(item), 0);
  }
});
function permutations(values) {
  if (!values.length) return [[]];
  return values.flatMap((v, i) => permutations(values.filter((_, j) => i !== j)).map(rest => [v, ...rest]));
}
test("all 24 placement orders stack identically and mine in the required order", () => {
  for (const order of permutations(["wall", "roof", "torch", "wood_floor"])) {
    const g = game(); g.world.featureAt = () => W.FEATURE.COAL;
    for (const type of order) assert.equal(place(g, type), true, order.join(","));
    assert.equal(g.objectsAt(1, 0).length, 4);
    assert.equal(place(g, "wood_door"), false);
    for (const type of ["roof", "torch", "wood_floor"]) assert.equal(place(g, type), false);
    for (const type of ["wall", "roof", "wood_floor"]) {
      assert.equal(g.placedObjectAt(1, 0).type, type);
      assert.equal(g.miningTargetAt(1, 0), null);
      g.finishObjectMining({ tx: 1, ty: 0 });
      assert.equal(g.drops.at(-1)[0], type);
      if (type === "wall") { assert.equal(g.objectsAt(1,0).some(o => o.type === "torch"),false); assert.equal(g.drops.filter(d=>d[0]==="torch").length,1); }
    }
    assert.equal(g.miningTargetAt(1, 0).kind, "coal");
    g.world.featureAt = () => W.FEATURE.NONE;
    assert.equal(g.miningTargetAt(1, 0).kind, "dirt");
    assert.equal(g.placedObjectTiles.size, 0);
  }
});
test("torch, floor and roof pass players, animals, spiders and arrows", () => {
  const g = game();
  for (const type of ["torch", "wood_floor", "roof"]) assert.equal(place(g, type), true);
  assert.equal(g.isGroundBlockedForCreature(1, 0), false);
  assert.equal(g.player.canOccupy(30, 10), true);
  assert.equal(g.mobCanOccupy(30, 10), true);
  assert.equal(g.projectilePathBlocked(10, 10, 50, 10), false);
  const spider = g.spawnMob("spider", 4, 0);
  assert.equal(g.trySpiderJump(spider), true);
});
test("walls block full creature and bullet paths, including spider leaps", () => {
  const g = game(); place(g, "wall");
  assert.equal(g.player.canOccupy(30, 10), false);
  assert.equal(g.mobCanOccupy(30, 10), false);
  assert.equal(g.projectilePathBlocked(10, 10, 80, 10), true);
  assert.equal(g.trySpiderJump(g.spawnMob("spider", 4, 0)), false);
});
test("doors and fence gates open a passage but retain the blocking slot", () => {
  for (const type of ["wood_door", "fence_gate"]) {
    const g = game(); place(g, type);
    assert.equal(g.projectilePathBlocked(30, -10, 30, 40), true);
    g.openPlacedObject(1, 0); assert.equal(g.placedObjectAt(1, 0).open, true);
    assert.equal(g.player.canOccupy(30, 10), true); assert.equal(g.mobCanOccupy(30, 10), true);
    assert.equal(g.projectilePathBlocked(30, -10, 30, 40), false);
    assert.equal(g.projectilePathBlocked(21, -10, 21, 40), true);
    assert.equal(place(g, "wall"), false);
    g.player.x = 30; g.openPlacedObject(1, 0);
    assert.equal(g.placedObjectAt(1, 0).open, true, "must not close on player");
    g.player.x = 10; g.openPlacedObject(1, 0);
    assert.equal(g.placedObjectAt(1, 0).open, false);
  }
});
test("all four single-neighbour door hinges attach to that neighbour", () => {
  for (const [dx, dy, horizontal, near] of [[-1, 0, true, true], [1, 0, true, false], [0, -1, false, true], [0, 1, false, false]]) {
    for (const [door, neighbour] of [["wood_door", "wall"], ["fence_gate", "wood_fence"]]) {
      const at = (x, y) => x === dx && y === dy ? [{ type: neighbour }] : [];
      const pose = B.doorPose({ type: door, tx: 0, ty: 0 }, at);
      assert.equal(pose.horizontal, horizontal); assert.equal(pose.near, near);
    }
  }
});
test("vertical doors leave a horizontal passage and retain their side panel", () => {
  const g = game(); place(g, "wood_door", 1, 1); place(g, "wall", 1, 0);
  g.placedObjectAt(1, 1).open = true;
  assert.equal(g.projectilePathBlocked(0, 30, 60, 30), false);
  assert.equal(g.projectilePathBlocked(0, 21, 60, 21), true);
});
test("thin fences connect in every direction and disconnect on removal", () => {
  const g = game(); place(g, "wood_fence", 1, 1);
  assert.equal(g.groundAreaBlocked(20, 20, 23, 23), false);
  assert.equal(g.groundAreaBlocked(28, 28, 32, 32), true);
  for (const [x, y] of [[0, 1], [2, 1], [1, 0], [1, 2]]) place(g, "wood_fence", x, y);
  const center = g.placedObjectAt(1, 1);
  assert.equal(Object.values(B.connections(center, (x, y) => g.objectsAt(x, y))).every(Boolean), true);
  g.finishObjectMining({ tx: 2, ty: 1 });
  assert.equal(B.connections(center, (x, y) => g.objectsAt(x, y)).right, false);
});
test("roof transparency visits an entire four-neighbour component only", () => {
  const roofs = [[0, 0], [1, 0], [1, 1], [2, 2], [8, 8]].map(([tx, ty]) => ({ type: "roof", tx, ty }));
  const visible = B.transparentRoofs(roofs, 0, 0);
  assert.equal(visible.size, 3); assert.equal(visible.has("1,1"), true);
  assert.equal(visible.has("2,2"), false); assert.equal(B.transparentRoofs(roofs, -1, 0).size, 0);
});
test("placement on player's tile is allowed only for passable layers", () => {
  const g = game();
  for (const type of ["torch", "roof", "wood_floor"]) assert.equal(place(g, type, 0, 0), true);
  assert.equal(place(g, "wall", 0, 0), false);
});
test("renderer fixes layer order independent of placement order and fades roofs", () => {
  const r = Object.create(W.Renderer.prototype), calls = [];
  const ctx = new Proxy({ globalAlpha: 1 }, { get(target, prop) { return prop in target ? target[prop] : (...args) => calls.push([prop, target.globalAlpha, ...args]); } });
  r.ctx = ctx; r.buildingTiles = new Map(); r.transparentRoofTiles = new Set(["1,0"]);
  r.drawPlacedTorch = (x, y) => calls.push(["torch", x, y]);
  r.drawBuilding = o => calls.push(["solid", o.type]);
  const objects = ["roof", "torch", "wood_floor", "wall"].map(type => ({ type, tx: 1, ty: 0, id: 1 }));
  r.buildingTiles.set("1,0", objects);
  r.drawPlacedObjects(objects, 0, 0, 0);
  assert.ok(calls.findIndex(c => c[0] === "solid") < calls.findIndex(c => c[0] === "torch"));
  assert.equal(calls.find(c => c[0] === "torch")[2], -B.WALL_HEIGHT);
  calls.length = 0; r.drawRoofs(objects, 0, 0);
  assert.ok(calls.some(c => c[0] === "fillRect" && c[1] === B.ROOF_INTERIOR_ALPHA));
  assert.ok(B.ROOF_INTERIOR_ALPHA <= 0.05);
  const roofRects = calls.filter(c => c[0] === "fillRect");
  assert.ok(roofRects.every(c => c[3] >= -B.WALL_HEIGHT && c[3] + c[5] <= 20 - B.WALL_HEIGHT), "roof stays in one elevated tile");
});
test("every fixed object requires the matching tool for normal mining speed", () => {
  const g = game();
  for (const [type, tool] of [["wall", "pickaxe"], ["stele", "pickaxe"], ["respawn_stele", "pickaxe"], ["furnace", "pickaxe"], ["roof", "pickaxe"], ["workbench", "axe"], ["torch", "axe"], ["bed", "axe"], ["storage_chest", "axe"], ["wood_floor", "axe"], ["wood_door", "axe"], ["wood_fence", "axe"], ["fence_gate", "axe"]]) {
    g.selectedSlot = null;
    assert.equal(g.miningProfile("placed", type).duration, 2600);
    for (const held of ["wood_axe", "wood_pickaxe", "wood_shovel"]) {
      g.inventory.setSlot("equipment", 0, { itemId: held, count: 1, durability: 10 });
      g.selectedSlot = { area: "equipment", index: 0 };
      const profile = g.miningProfile("placed", type);
      assert.equal(profile.duration, W.ITEMS[held].toolType === tool ? 650 : 2600, type + ": " + held);
    }
  }
});
test("finished fixture mining consumes tool durability once and preserves other layers", () => {
  const g = game(); place(g, "wall"); place(g, "roof");
  g.inventory.setSlot("equipment", 0, { itemId: "stone_pickaxe", count: 1, durability: 10 });
  g.selectedSlot = { area: "equipment", index: 0 };
  const profile = g.miningProfile("placed", "wall");
  assert.equal(profile.duration, 650 / 1.5);
  g.mining = { tx: 1, ty: 0, kind: "placed", itemId: "wall", start: 0, ...profile };
  g.updateMining(1000);
  assert.equal(g.inventory.getSlot("equipment", 0).durability, 9);
  assert.equal(g.placedObjectAt(1, 0).type, "roof");
  assert.equal(g.mining, null);
});
test("hover placement shares validation, preserves inventory and supports elevated roofs", () => {
  const g = game();
  g.inventory.setSlot("equipment", 0, { itemId: "roof", count: 2 });
  g.selectedSlot = { area: "equipment", index: 0 };
  g.pointerInside = true; g.pointerTile = { tx: 1, ty: 0 };
  const target = g.renderTarget();
  assert.equal(target.kind, "placement"); assert.equal(target.valid, true);
  assert.equal(target.object.type, "roof"); assert.equal(target.object.ty, 0);
  assert.equal(g.inventory.getSlot("equipment", 0).count, 2);
  assert.equal(g.placedObjects.size, 0);
  assert.equal(g.placeSelectedObject(1, 0), true);
  assert.equal(g.renderTarget().valid, false);
  g.pointerTile = { tx: 20, ty: 0 }; assert.equal(g.renderTarget().valid, false);
  g.pointerInside = false; assert.equal(g.renderTarget(), null);
});
test("occlusion detects objects hidden by taller fixtures below, never same-cell layers", () => {
  const r = Object.create(W.Renderer.prototype); r.buildingTiles = new Map();
  const bench = { type: "workbench", tx: 1, ty: 0 };
  const wall = { type: "wall", tx: 1, ty: 1 };
  assert.equal(r.occludingFixtures(bench, [wall]).length, 1);
  assert.equal(r.occludingFixtures(wall, [bench]).length, 0);
  assert.equal(r.occludingFixtures(bench, [{ ...wall, tx: 2 }]).length, 0);
  assert.equal(r.occludingFixtures(bench, [{ ...wall, ty: 0 }]).length, 0);
  assert.equal(r.occludingFixtures(bench, [{ ...wall, type: "roof" }]).length, 0);
});
test("outdoor viewers cannot see occlusion ghosts inside closed rooms", () => {
  const r=Object.create(W.Renderer.prototype); r.buildingTiles=new Map();
  const back={type:"workbench",tx:1,ty:0}, front={type:"wall",tx:1,ty:1}, room={id:1};
  r.roomIndex={at:()=>room}; r.viewerRoom=null;
  assert.equal(r.occludingFixtures(back,[front]).length,0);
  r.viewerRoom=room; assert.equal(r.occludingFixtures(back,[front]).length,1);
});
test("creature occlusion only uses tall blocking models below the creature", () => {
  const r=Object.create(W.Renderer.prototype); r.buildingTiles=new Map();
  const mob={x:30,y:10}, wall={type:"wall",tx:1,ty:1};
  assert.equal(r.mobOccluders(mob,[wall]).length,1);
  assert.equal(r.mobOccluders(mob,[{...wall,ty:-1}]).length,0);
  assert.equal(r.mobOccluders(mob,[{...wall,type:"torch"}]).length,0);
});

test("natural trees share foreground depth, fixture ghosts and creature occlusion",()=>{
  const r=Object.create(W.Renderer.prototype);r.buildingTiles=new Map();
  const tree={type:"tree",tx:1,ty:1},back={type:"workbench",tx:1,ty:0},wall={type:"wall",tx:1,ty:0};
  assert.equal(r.occludingFixtures(back,[tree]).length,1);
  assert.equal(r.occludingFixtures(tree,[wall]).length,0);
  assert.equal(r.mobOccluders({x:30,y:10},[tree]).length,1);
  const order=[];r.ctx={beginPath(){},ellipse(){},fill(){}};
  r.drawFixedObject=o=>order.push(o.type);r.drawOccludedFixtures=()=>{};
  r.drawPlacedObjects([tree,wall],0,0,0);assert.equal(order.join(','),'wall,tree');
});
test("backpack sorting merges to 64 and preserves independent tool durability",()=>{
 const g=game(),inv=g.inventory;
 inv.setSlot("backpack",3,{itemId:"wood",count:40});inv.setSlot("backpack",8,{itemId:"wood",count:35});
 inv.setSlot("backpack",10,{itemId:"wood_axe",count:1,durability:9});inv.setSlot("backpack",20,{itemId:"wood_axe",count:1,durability:4});
 inv.sortBackpack();assert.equal(inv.backpack[0].count,64);assert.equal(inv.backpack[1].count,11);
 assert.equal(inv.backpack[2].durability,9);assert.equal(inv.backpack[3].durability,4);assert.equal(inv.backpack[4],null);
 const chest=new Array(32).fill(null);g.addToArray(chest,{itemId:"wood",count:130});assert.equal(chest[0].count,64);assert.equal(chest[1].count,64);assert.equal(chest[2].count,2);
});
test("hotbar clicks switch held slots while backpack interactions still swap",()=>{
 const g=game();g.showItemDetails=()=>{};g.renderInventory=()=>{};g.cancelMining=()=>{};
 g.inventory.setSlot("equipment",0,{itemId:"wood",count:5});g.inventory.setSlot("equipment",1,{itemId:"rock",count:2});g.inventory.setSlot("backpack",0,{itemId:"coal",count:3});
 g.handleSlotClick("equipment",0);g.handleSlotClick("equipment",1);assert.equal(g.selectedSlot.index,1);assert.equal(g.inventory.equipment[0].itemId,"wood");
 g.handleSlotClick("equipment",1);assert.equal(g.selectedSlot.index,1);
 g.handleSlotClick("backpack",0);g.handleSlotClick("equipment",0);assert.equal(g.inventory.equipment[0].itemId,"coal");assert.equal(g.inventory.backpack[0].itemId,"wood");assert.equal(g.selectedSlot.index,0);
 g.handleSlotClick("equipment",7);assert.equal(g.selectedSlot.index,7);assert.equal(g.getSelectedStack(),null);
});
test("equipment and backpack slots store transactionally, keeping durability and cooldown",()=>{
 const g=game();g.storageOpen=true;g.storageObject={storage:new Array(32).fill(null)};g.renderStorage=()=>{};
 g.inventory.equipment[0]={itemId:"wood",count:10};g.storageObject.storage[0]={itemId:"wood",count:60};
 g.selectedSlot={area:"equipment",index:0};g.syncHeldStats=()=>{g.synced=true;};
 assert(g.storeInventorySlot("equipment",0));assert.equal(g.inventory.equipment[0],null);assert.equal(g.selectedSlot.index,0);assert(g.synced);
 assert.equal(g.storageObject.storage[0].count,64);assert.equal(g.storageObject.storage[1].count,6);
 g.inventory.equipment[1]={itemId:"lucian_holy_gun",count:1,durability:3,skillReadyAt:20};
 assert(g.storeInventorySlot("equipment",1));assert.equal(g.storageObject.storage[2].durability,3);assert.equal(g.storageObject.storage[2].skillReadyAt,20);
 g.storageObject.storage.fill({itemId:"rock",count:64});g.inventory.backpack[0]={itemId:"wood",count:2};
 assert.equal(g.storeInventorySlot("backpack",0),false);assert.equal(g.inventory.backpack[0].count,2);
});
console.log(`\n${passed} building integration checks passed`);
