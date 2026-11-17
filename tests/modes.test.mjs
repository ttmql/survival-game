import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const context=vm.createContext({console,performance,Math,document:{readyState:'loading',addEventListener(){}}});
for(const name of ['config','buildings','time','inventory','player','game']) {
  let source=readFileSync(new URL(`../js/${name}.js`,import.meta.url),'utf8');
  if(name==='game')source=source.replace('  function boot() {','  globalThis.TestGame=Game;\n  function boot() {');
  vm.runInContext(source,context);
}
const {Wilds:W,TestGame:Game}=context;
function game(){
  const g=Object.create(Game.prototype);
  Object.assign(g,{gameMode:'survival',sessionMode:'creative',inventory:new W.Inventory(),world:{findSpawn:()=>({tx:0,ty:0}),terrainAt:()=>W.TERRAIN.GRASS,featureAt:()=>W.FEATURE.NONE},
    placedObjects:new Map(),placedObjectTiles:new Map(),mobs:[],mobSequence:0,clock:{hours:22,day:1},selectedSlot:{area:'equipment',index:0},
    updateModeUI(){},renderInventory(){},syncHeldStats(){},syncHud(){},cancelMining(){},hideItemDetails(){},showToast(){},updateSpawner(){},wanderMob(){}});
  g.player=new W.Player(g.world);return g;
}
let passed=0;
function test(name,fn){fn();passed++;console.log('  ok  '+name);}
test('creative overflow uses the hidden backpack for tools and materials without corrupting the full hotbar',()=>{
  const i=new W.Inventory();i.creative=true;
  i.setSlot('equipment',0,{itemId:'wood',count:64});
  for(let n=1;n<8;n++)assert(i.addEquipment('stone_sword'));
  assert(i.addEquipment('wood_axe'));assert.equal(i.addItem('rock',64),64);
  assert.equal(i.backpack[0].itemId,'wood_axe');assert.equal(i.backpack[1].itemId,'rock');assert.equal(i.backpack[1].count,64);
  assert.equal(i.equipment[0].count,64);assert(i.equipment.slice(1).every(s=>s.itemId==='stone_sword'));
});
test('creative damage, drowning, starvation and toxic effects cannot hurt or kill the player',()=>{
  const g=game();g.setGameMode('creative');g.player.oxygen=0;g.player.satiety=0;
  g.world.terrainAt=()=>W.TERRAIN.OCEAN;
  g.player.updateVitals(100);g.player.takeDamage(999);g.damagePlayer(999,{name:'test'});g.die();
  g.player.applyPoison(1000,1);g.player.applySlow(10,.5);g.updateSurvival(24);
  assert.equal(g.player.health,100);assert(!g.isDead);assert.equal(g.player.poisonDamageRemaining,0);assert.equal(g.player.speedFactor,1);
});
test('creative cannot provoke any monster or shark, including attacks and enderman hover',()=>{
  const g=game();g.setGameMode('creative');
  for(const type of ['zombie','savage_archer','spider','enderman','dark_lucian','shark','pig']){
    const m=g.spawnMob(type,2,0);g.damageMob(m,1);assert(!m.aggro);assert(!m.provoked);assert.equal(m.fleeUntil,0);assert(!g.canMonsterAggro(m));
    g.provokeEnderman(m);assert(!m.provoked);
  }
  assert(!g.endermanHovered(g.mobs[3],{x:50,y:10}));assert(!g.spawnFirstNightLucian(true));
  assert.equal(g.findMobAtPointer(50,-16),g.mobs[3]);
  g.updateMobs(.1,performance.now());assert(g.mobs.every(m=>!m.aggro));assert.equal(g.player.health,100);
});
test('catalogue partitions every item exactly once by capabilities',()=>{
  const g=game(),counts={tools:0,equipment:0,materials:0,fixtures:0};
  for(const item of Object.values(W.ITEMS))assert(++counts[g.creativeItemCategory(item)]>0);
  assert.equal(g.creativeItemCategory(W.ITEMS.wood_hoe),'tools');assert.equal(g.creativeItemCategory(W.ITEMS.wood_sword),'equipment');
  assert.equal(g.creativeItemCategory(W.ITEMS.wood),'materials');assert.equal(g.creativeItemCategory(W.ITEMS.wall),'fixtures');
  assert(Object.values(counts).every(n=>n>0));
});
test('catalogue clicks fill chosen hotbar with one durable tool or sixty-four materials, never the backpack',()=>{
  const g=game();g.setGameMode('creative');g.creativePick='wood_axe';g.handleSlotClick('equipment',3);
  assert.equal(g.inventory.equipment[3].count,1);assert.equal(g.inventory.equipment[3].durability,W.ITEMS.wood_axe.maxDurability);
  g.creativePick='wood';g.handleSlotClick('equipment',4);assert.equal(g.inventory.equipment[4].count,64);
  g.handleSlotClick('backpack',0);assert(g.inventory.backpack.every(s=>s===null));
});
test('creative tools keep durability and every mining category uses the fastest tool speed',()=>{
  const g=game();g.setGameMode('creative');g.inventory.addEquipment('enderman_portal');
  const tool={area:'equipment',index:0,itemId:'enderman_portal'};
  for(let n=0;n<100;n++)g.consumeToolDurability(tool);assert.equal(g.inventory.equipment[0].durability,15);
  const duration=g.miningProfile('tree').duration;
  for(const kind of ['placed','crop','dirt','rock','sand','coal','silica'])assert.equal(g.miningProfile(kind,'wall').duration,duration);
  g.setGameMode('survival');g.consumeToolDurability(tool);assert.equal(g.inventory.equipment[0].durability,14);
});
test('fivefold travel toggles without affecting normal or simulated survival speed',()=>{
  const g=game(),p=g.player;p.canOccupy=()=>true;p.update(.1,1,0,false);const normal=p.speed;
  p.creative=true;p.fastTravel=true;p.update(.1,1,0,false);assert.equal(p.speed,normal*5);
  p.fastTravel=false;p.update(.1,1,0,false);assert.equal(p.speed,normal);
  p.creative=false;p.fastTravel=true;p.update(.1,1,0,false);assert.equal(p.speed,normal);
});
test('simulation and creative share the same backpack and retain pickups made while it is hidden',()=>{
  const g=game();g.inventory.setSlot('backpack',2,{itemId:'wood',count:7});
  const backpack=g.inventory.backpack;
  g.setGameMode('creative');assert.equal(g.inventory.backpack,backpack);assert.equal(g.inventory.backpack[2].count,7);assert(g.player.creative);
  for(let i=0;i<8;i++)g.inventory.setSlot('equipment',i,{itemId:'wood',count:64});
  assert(g.canAddToBackpack('rock',10));assert.equal(g.inventory.addItem('rock',10),10);
  g.setGameMode('survival');assert(!g.inventory.creative);assert.equal(g.inventory.backpack[2].count,7);
  assert.equal(g.inventory.backpack[0].itemId,'rock');assert.equal(g.inventory.backpack[0].count,10);
  g.player.takeDamage(10);assert.equal(g.player.health,90);assert(g.canMonsterAggro(g.spawnMob('zombie',2,0)));
  g.setGameMode('creative');assert.equal(g.player.health,100);assert.equal(g.inventory.backpack,backpack);assert.equal(g.inventory.backpack[0].count,10);
});
test('actual drop collection fills the hidden backpack when the creative hotbar is full',()=>{
  const g=game();g.setGameMode('creative');g.drops=[];g.dropSequence=0;
  for(let n=0;n<8;n++)g.inventory.setSlot('equipment',n,{itemId:'wood',count:64});
  g.spawnDrop('rock',3,0,0);g.drops[0].armed=true;g.collectNearbyDrops(performance.now());
  assert.equal(g.drops.length,0);assert.equal(g.inventory.backpack[0].itemId,'rock');assert.equal(g.inventory.backpack[0].count,3);
  assert(g.inventory.equipment.every(s=>s.itemId==='wood'&&s.count===64));
  g.setGameMode('survival');assert.equal(g.inventory.backpack[0].count,3);
});
console.log(`${passed} creative/survival mode checks passed`);
