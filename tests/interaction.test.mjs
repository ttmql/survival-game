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

for(const type of ['torch','wood_floor','roof','driftwood']) {
 g.placedObjectAt=()=>({type,tx:1,ty:0,itemId:type});g.findMobAtPointer=()=>target;
 for(const id of [null,...Object.keys(W.ITEMS)]) {
  g.inventory.equipment[0]=id?{itemId:id,count:1,durability:15}:null;g.nextAttackAt=0;target.health=100;
  const arrows=g.projectiles.length;g.handlePointerDown(event);
  assert(target.health<100 || g.projectiles.length>arrows,`${id} attacks the creature above ${type}`);
  assert.equal(g.mining,null);assert.equal(g.objectClickCandidate,null);g.cancelMining();
 }
 // Attack cooldown must not accidentally start mining the layer underneath.
 g.inventory.equipment[0]=null;g.nextAttackAt=Infinity;target.health=100;g.handlePointerDown(event);
 assert.equal(target.health,100);assert.equal(g.mining,null);
 g.findMobAtPointer=()=>null;g.nextAttackAt=0;g.handlePointerDown(event);
 assert.equal(g.mining?.kind,'placed',`Empty ${type} tiles still support mining`);g.cancelMining();
}
g.placedObjectAt=()=>({type:'wall',tx:1,ty:0,itemId:'wall'});g.findMobAtPointer=()=>target;target.health=100;
g.handlePointerDown(event);assert.equal(g.mining?.kind,'placed');assert.equal(target.health,100);g.cancelMining();

test('enderman can blink onto passable indoor layers through an open house but respects a closed room',()=>{
 const h=game();h.clock.setTimeOfDay(22);
 function place(type,tx,ty,open=false) {
  const object={type,tx,ty,open,tiles:[{tx,ty}]};object.storageKey=W.Buildings.key(object);
  h.placedObjects.set(object.storageKey,object);
  const occupants=h.placedObjectTiles.get(tx+','+ty)||new Set();occupants.add(object);h.placedObjectTiles.set(tx+','+ty,occupants);
  return object;
 }
 let door;
 for(let y=-2;y<=2;y++)for(let x=-2;x<=2;x++) {
  if(Math.max(Math.abs(x),Math.abs(y))===2) {
   const o=place(x===2&&y===0?'wood_door':'wall',x,y,x===2&&y===0);if(o.type==='wood_door')door=o;
  } else place('roof',x,y);
 }
 place('wood_floor',0,-1);place('torch',0,-1);
 const mob=h.spawnMob('enderman',6,0);
 assert(h.canMonsterAggro(mob));h.provokeEnderman(mob,0);
 assert.equal(mob.x,10);assert.equal(mob.y,-10);assert.equal(h.player.health,70);
 h.enforceGroundObstacleInvariant();assert.equal(mob.x,10);assert.equal(mob.y,-10);
 mob.x=mob.lastSafeX=130;mob.y=mob.lastSafeY=10;mob.blinkCooldown=0;door.open=false;h.invalidateRooms();
 assert(!h.canMonsterAggro(mob));h.updateMobs(0,1000);assert.equal(mob.aggro,false);assert.equal(mob.x,130);
 door.open=true;h.invalidateRooms();h.updateMobs(0,1001);assert(mob.aggro);assert.equal(mob.x,10);assert.equal(mob.y,-10);
});
test('short clicks place fixtures on coal and floating supports on silica without removing the embedded minerals',()=>{
 for(const feature of [W.FEATURE.COAL,W.FEATURE.SILICA]) {
  const h=game();h.world.featureAt=(x,y)=>x===1&&y===0?feature:W.FEATURE.NONE;
  h.world.terrainAt=x=>feature===W.FEATURE.SILICA&&x===1?W.TERRAIN.OCEAN:W.TERRAIN.GRASS;
  h.world.waterDepthAt=x=>feature===W.FEATURE.SILICA&&x===1?2:0;
  Object.assign(h,{getPointerTileAt:()=>({tx:1,ty:0}),getPointerWorldPosition:()=>({x:30,y:10}),
   canvas:{setPointerCapture(){}},releaseMiningPointer(){},refreshPointerTile(){},updatePointerTarget(){}});
  function clickItem(id){h.inventory.setSlot('equipment',0,{itemId:id,count:1});h.selectedSlot={area:'equipment',index:0};h.handlePointerDown(event);h.handlePointerUp();}
  if(feature===W.FEATURE.SILICA){assert(!h.placementPlan(W.ITEMS.wall,1,0).valid);clickItem('driftwood');assert(h.hasWaterSupport(1,0));}
  clickItem('wall');assert.equal(h.placedObjectAt(1,0).type,'wall');assert.equal(h.world.featureAt(1,0),feature);
 }
});
console.log('All items can mine fixtures/terrain and attack creatures; short-use and hold-to-dig remain distinct.');
