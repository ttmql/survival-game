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

const g=game();g.world.waterDepthAt=()=>0;g.world.removeFeatureAt=()=>{};g.world.seed=42;g.initFarming();g.withinRange=()=>true;g.isPositionLit=()=>true;g.audio={};
function hold(id){g.inventory.equipment[0]={itemId:id,count:1,durability:15};g.selectedSlot={area:'equipment',index:0};}
hold('wood_hoe');g.useFarmItem(0,0);assert(g.farm.get('0,0').soil);assert.equal(g.inventory.equipment[0].durability,14);
hold('wheat_seed');g.useFarmItem(0,0);assert.equal(g.farm.get('0,0').crop,'wheat');
g.updateFarming(W.CONFIG.REAL_SECONDS_PER_GAME_DAY);assert(!g.farm.has('0,0'));
hold('wood_hoe');g.useFarmItem(0,0);hold('water_bottle');g.useFarmItem(0,0);assert(g.farm.get('0,0').wet);assert.equal(g.inventory.countItem('glass_bottle'),1);
hold('wheat_seed');g.useFarmItem(0,0);g.isPositionLit=()=>false;g.updateFarming(300);assert.equal(g.farm.get('0,0').growth,0);g.isPositionLit=()=>true;g.updateFarming(W.CONFIG.REAL_SECONDS_PER_GAME_DAY*3);assert.equal(g.farm.get('0,0').growth,3);g.harvestCrop(0,0);assert(g.drops.some(d=>d[0]==='wheat'&&d[1]===1));assert(g.drops.some(d=>d[0]==='wheat_seed'&&d[1]===2));
hold('sapling');g.useFarmItem(0,0);g.isPositionLit=()=>false;g.updateFarming(W.CONFIG.REAL_SECONDS_PER_GAME_DAY*3);assert.equal(g.world.featureAt(0,0),W.FEATURE.TREE);
g.farm.set('1,0',{tx:1,ty:0,soil:true,wet:true,crop:'wheat',growth:1.6});
hold('animal_manure');g.useFarmItem(1,0);assert.equal(g.farm.get('1,0').growth,2.6);assert.equal(g.inventory.getSlot('equipment',0),null);
hold('animal_manure');g.useFarmItem(1,0);assert.equal(g.farm.get('1,0').growth,3);
hold('animal_manure');g.useFarmItem(1,0);assert.equal(g.inventory.getSlot('equipment',0).count,1);
g.useFarmItem(2,0);assert.equal(g.inventory.getSlot('equipment',0).count,1);
g.farm.set('2,0',{tx:2,ty:0,soil:true,wet:true,crop:'sapling',growth:2});g.useFarmItem(2,0);assert.equal(g.world.featureAt(2,0),W.FEATURE.TREE);assert(!g.farm.has('2,0'));
const ids=['sapling','wheat_seed','rice_seed','wheat','rice','wood_bowl','bread','raw_rice','cooked_rice'];
assert.equal(new Set(ids.map(id=>W.ITEMS[id].icon)).size,ids.length);
assert.notEqual(W.ITEMS.wood_hoe.icon,W.ITEMS.wood_pickaxe.icon);
assert.notEqual(W.ITEMS.stone_hoe.icon,W.ITEMS.stone_pickaxe.icon);
console.log('Farming checks passed, including fertilizer progress, instant tree maturity, no consumption on invalid targets and distinct item art.');
