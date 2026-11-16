import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
const context = vm.createContext({ console, performance, Math: Object.create(Math), document: { readyState: "loading", addEventListener() {} } });
for (const name of ["config", "buildings", "time", "inventory", "player", "game"]) {
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
test("gift recipe is two silica and two wood",()=>{
 const g=game();g.inventory.addItem("silica",2);g.inventory.addItem("wood",2);
 const recipe=W.RECIPES.find(r=>r.output==="blg_gift_box");assert.equal(g.inventory.craft(recipe).ok,true);
 assert.equal(g.inventory.countItem("blg_gift_box"),1);assert.equal(g.inventory.countItem("wood"),0);
});
test("gift range covers all visible targets but rejects fixed objects anywhere in the circle",()=>{
 const g=game();assert.equal(g.giftPlan(180,10).valid,true);assert.equal(g.giftPlan(180,10).radius,60);assert.equal(g.giftPlan(251,10).valid,false);
 add(g,"torch",6,0);assert.equal(g.giftPlan(180,10).valid,false);
 g.finishObjectMining({tx:6,ty:0});assert.equal(g.giftPlan(180,10).valid,true);
 g.world.featureAt=(x,y)=>x===6&&y===0?W.FEATURE.COAL:W.FEATURE.NONE;assert.equal(g.giftPlan(180,10).valid,false);
});
test("a valid throw consumes one gift and lasts five seconds after landing",()=>{
 const g=game();g.inventory.addItem("blg_gift_box",2);g.selectedSlot={area:"equipment",index:0};g.cancelMining=()=>{};
 assert.equal(g.throwGift(180,10),true);assert.equal(g.inventory.countItem("blg_gift_box"),1);
 let sounds=0;g.audio={playGiftLand(){sounds++;}};g.updateGiftEffects(0.64);assert.equal(sounds,0);g.updateGiftEffects(0.01);assert.equal(sounds,1);assert.equal(g.giftEffects.length,1);g.updateGiftEffects(4.99);assert.equal(g.giftEffects.length,1);
 g.updateGiftEffects(0.02);assert.equal(sounds,1);assert.equal(g.giftEffects.length,0);
 g.paused=true;assert.equal(g.throwGift(180,10),false);assert.equal(g.inventory.countItem("blg_gift_box"),1);
});
console.log(passed+" gift checks passed");
