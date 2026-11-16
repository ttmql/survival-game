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

const g=game();g.world.removeFeatureAt=()=>{};g.initFarming();g.withinRange=()=>true;
Object.assign(g,{getPointerTileAt:()=>({tx:1,ty:0}),getPointerWorldPosition:()=>({x:30,y:10}),canvas:{setPointerCapture(){}},releaseMiningPointer(){},refreshPointerTile(){},updatePointerTarget(){},hideItemDetails(){},findMobAtPointer:()=>null});
const event={button:0,clientX:0,clientY:0,pointerId:1,preventDefault(){}};
let opened=0;g.openPlacedObject=()=>{opened++;};
for(const type of ['workbench','storage_chest','furnace','wall','torch','wood_floor']) {
 const object={type,tx:1,ty:0,itemId:type};g.placedObjectAt=()=>object;
 for(const id of [null,...Object.keys(W.ITEMS)]) {
   g.inventory.equipment[0]=id?{itemId:id,count:1,durability:15}:null;g.selectedSlot={area:'equipment',index:0};
   g.handlePointerDown(event);assert.equal(g.mining?.kind,'placed',`${id} must mine ${type}`);
   if(['workbench','storage_chest','furnace'].includes(type)) {const before=opened;g.handlePointerUp();assert.equal(opened,before+1,`${id} must open ${type}`);}
   g.cancelMining();
 }
}
g.placedObjectAt=()=>null;g.world.featureAt=()=>W.FEATURE.TREE;
for(const id of Object.keys(W.ITEMS)) {
 g.inventory.equipment[0]={itemId:id,count:1,durability:15};g.handlePointerDown(event);
 assert.equal(g.mining?.kind,'tree',`${id} must be able to chop a tree`);g.cancelMining();
}
g.world.featureAt=()=>W.FEATURE.NONE;g.world.markDug=()=>{};
for(const [terrain,kind] of [[W.TERRAIN.GRASS,'dirt'],[W.TERRAIN.ROCK,'rock'],[W.TERRAIN.OCEAN,'sand']]) {
 g.world.terrainAt=()=>terrain;
 for(const id of Object.keys(W.ITEMS)) {
  g.inventory.equipment[0]={itemId:id,count:1,durability:15};g.selectedSlot={area:'equipment',index:0};
  g.handlePointerDown(event);assert.equal(g.mining?.kind,kind,`${id} must dig ${kind}`);
  const before=g.drops.length;g.updateMining(g.mining.start+g.mining.duration+1);
  assert(g.drops.length>before,`${id} must complete digging ${kind}`);assert.equal(g.groundClickCandidate,null);
 }
}
g.world.terrainAt=()=>W.TERRAIN.GRASS;
const target={health:100};g.findMobAtPointer=()=>target;g.damageMob=(mob,amount)=>{mob.health-=amount;};
for(const id of Object.keys(W.ITEMS)) {
 g.inventory.equipment[0]={itemId:id,count:1,durability:15};g.selectedSlot={area:'equipment',index:0};g.nextAttackAt=0;target.health=100;
 const arrows=g.projectiles.length;g.handlePointerDown(event);
 assert(target.health<100 || g.projectiles.length>arrows,`${id} must attack a creature`);assert.equal(g.inventory.equipment[0]?.count,1);
 g.cancelMining();
}
g.findMobAtPointer=()=>null;g.inventory.equipment[0]={itemId:'water_bottle',count:1};let uses=0;g.useFarmItem=()=>{uses++;return true;};
g.handlePointerDown(event);assert.equal(uses,0);g.handlePointerUp();assert.equal(uses,1);
g.handlePointerDown(event);g.groundClickCandidate.startedAt-=500;g.handlePointerUp();assert.equal(uses,1,'Long holds must not pour water on release');
console.log('All items can mine fixtures/terrain and attack creatures; short-use and hold-to-dig remain distinct.');
