import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
const context = vm.createContext({ console, performance, Math: Object.create(Math), document: { readyState: "loading", addEventListener() {} } });
for (const name of ["config", "buildings", "world", "time", "inventory", "player", "game"]) {
  let source = readFileSync(new URL(`../js/${name}.js`, import.meta.url), "utf8");
  if (name === "game") source = source.replace("  function boot() {", "  globalThis.TestGame = Game;\n  function boot() {");
  vm.runInContext(source, context);
}
const { Wilds: W, TestGame: Game } = context;
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`  ok  ${name}`); }
function game() {
  const g = Object.create(Game.prototype);
  Object.assign(g, {
    world: { featureAt: () => W.FEATURE.NONE, terrainAt: () => W.TERRAIN.GRASS, findSpawn: () => ({ tx: 0, ty: 0 }), isDug: () => false },
    inventory: new W.Inventory(), placedObjects: new Map(), placedObjectTiles: new Map(), placedObjectSequence: 0,
    mobs: [], mobSequence: 0, projectiles: [], drops: [], selectedSlot: null, respawn: null, clock: new W.GameClock(),
    renderInventory() {}, syncHeldStats() {}, hideItemDetails() {}, showToast() {}, drawMinimap() {},
    spawnDrop(...args) { this.drops.push(args); }, updateSpawner() {},
  });
  g.player = new W.Player(g.world); return g;
}
function add(g, type, tx, ty) {
  const old = [g.player.x, g.player.y];
  g.player.x = (tx - 0.5) * 20; g.player.y = (ty + 0.5) * 20;
  g.inventory.setSlot("equipment", 0, { itemId: type, count: 1 }); g.selectedSlot = { area: "equipment", index: 0 };
  assert.equal(g.placeSelectedObject(tx, ty), true, type);
  [g.player.x, g.player.y] = old;
}
function house(g, x = 0) {
  for (let ty = 0; ty < 3; ty++) for (let tx = 0; tx < 4; tx++) {
    if (ty === 0 || ty === 2 || tx === 0 || tx === 3) add(g, tx === 2 && ty === 2 ? "wood_door" : "wall", tx + x, ty);
    else add(g, "roof", tx + x, ty);
  }
}
test("debug seed has near-spawn grass, rock, shallow water and deep water",()=>{
 const w=W.World.createWorld(0x123456),spawn=w.findSpawn();assert.equal(w.isDebugMap,true);assert.equal(spawn.tx,-1);assert.equal(spawn.ty,2);
 assert.equal(w.terrainAt(0,0),W.TERRAIN.GRASS);assert.equal(w.terrainAt(0,7),W.TERRAIN.ROCK);assert.equal(w.waterDepthAt(5,0),1);assert.equal(w.waterDepthAt(9,0),2);assert.equal(w.waterDepthAt(-14,7),1);
});
test("debug map has every fixture and all catalogue supplies in chests",()=>{
 const g=game();g.world=W.World.createWorld(0x123456);g.buildDebugMap();
 const objects=[...g.placedObjects.values()],chests=objects.filter(o=>o.type==="storage_chest");assert.ok(chests.length>=24);
 for(const item of Object.values(W.ITEMS)){
 if(item.placeType)assert.ok(objects.some(o=>o.type===item.placeType),item.id);
 const stacks=chests.flatMap(c=>c.storage).filter(s=>s?.itemId===item.id);
 if(g.inventory.maxStackFor(item.id)===1){assert.equal(stacks.length,3,item.id);assert.ok(stacks.every(s=>s.count===1&&s.durability===item.maxDurability));}
 else assert.equal(stacks.reduce((n,s)=>n+s.count,0),64,item.id);
 }
 assert.ok(g.closedRoomAtPosition(-90,-50));assert.equal(g.groundAreaBlocked(-14,51,-6,58),false);
});
console.log(passed+" debug map checks passed");
