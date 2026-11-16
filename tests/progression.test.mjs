// Integration checks exercise the real Game methods without starting the DOM UI.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const context = vm.createContext({ console, performance, Math: Object.create(Math), document: { readyState: "loading", addEventListener() {} } });
for (const file of ["config", "buildings", "time", "inventory", "player", "audio", "renderer", "game"]) {
  let source = readFileSync(new URL(`../js/${file}.js`, import.meta.url), "utf8");
  if (file === "renderer") continue;
  if (file === "game") source = source.replace("  function boot() {", "  globalThis.TestGame = Game;\n  function boot() {");
  vm.runInContext(source, context);
}
const { Wilds: W, TestGame: Game } = context;
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`  ok  ${name}`); }
function game() {
  const g = Object.create(Game.prototype);
  Object.assign(g, {
    player: new W.Player({ findSpawn: () => ({ tx: 0, ty: 0 }), terrainAt: () => W.TERRAIN.GRASS }),
    inventory: new W.Inventory(), mobs: [], mobSequence: 0, selectedSlot: null,
    clock: { hours: 22, day: 2 }, drops: [], isDead: false, audio: null,
    mobCanOccupy: () => true, updateSpawner() {}, renderInventory() {}, syncHeldStats() {}, hideItemDetails() {},
    showToast() {}, spawnDrop(...drop) { this.drops.push(drop); },
  });
  return g;
}test('sleep advances tree, lit crops and drought but not unlit crops',()=>{
 const g=game();g.clock=new W.GameClock();g.clock.time=22*3600;g.farmTrees=new Set();
 g.farm=new Map([
 ['0,0',{tx:0,ty:0,crop:'sapling',growth:1,soil:true,wet:true}],
 ['1,0',{tx:1,ty:0,crop:'wheat',growth:1,soil:true,wet:true}],
 ['2,0',{tx:2,ty:0,crop:'rice',growth:1}],
 ['3,0',{tx:3,ty:0,crop:'wheat',growth:1,soil:true,wet:false,dryAge:.8}]
 ]);
 g.isPositionLitBySource=(x)=>x>40;g.isPositionLit=()=>true;g.advanceSleepingFarm(8);
 assert(Math.abs(g.farm.get('0,0').growth-4/3)<1e-9);
 assert.equal(g.farm.get('1,0').growth,1);
 assert(Math.abs(g.farm.get('2,0').growth-4/3)<1e-9);
 assert(!g.farm.has('3,0'));assert.equal(g.clock.hours,22);
});
test('broken hotbar equipment pulls the matching backpack tool with its existing durability',()=>{
 const g=game();g.inventory.equipment[3]={itemId:'stone_hoe',count:1,durability:1};
 g.inventory.backpack[5]={itemId:'wood_hoe',count:1,durability:10};
 g.inventory.backpack[6]={itemId:'stone_hoe',count:1,durability:7};
 g.consumeToolDurability({area:'equipment',index:3,itemId:'stone_hoe'});
 assert.equal(g.inventory.equipment[3].durability,7);assert.equal(g.inventory.backpack[6],null);assert(g.inventory.backpack[5]);
});
test('Lucian emits 200 irregular shots over seven seconds and turns toward the player',()=>{
 const g=game();g.projectiles=[];const mob=g.spawnMob('dark_lucian',5,0);mob.cullingCooldown=0;
 assert.equal(mob.health,100);g.updateCulling(mob,0);
 const times=[...mob.culling.times];assert.equal(times.length,200);assert.equal(times[0],0);assert.equal(times[199],7);
 assert(new Set(times.slice(1).map((t,i)=>(t-times[i]).toFixed(6))).size>10);
 assert(g.projectiles[0].vx<0);g.player.x=mob.x;g.player.y=mob.y+100;
 for(let n=0;n<139;n++)g.updateCulling(mob,.05);
 assert(g.projectiles.length<200);g.updateCulling(mob,.05);assert.equal(g.projectiles.length,200);assert.equal(mob.culling,null);
 assert(g.projectiles.slice(1).every(p=>Math.abs(p.vx)<1e-8&&p.vy>0));
 assert(g.projectiles.slice(1).every(p=>Math.abs(p.x-mob.x)<=W.CONFIG.TILE_SIZE*.25));
 assert(g.projectiles.every(p=>p.damage===10&&p.type==='culling_bullet'&&p.skill==='culling'&&p.range===12*W.CONFIG.TILE_SIZE));
 assert(g.projectiles.every(p=>Math.hypot(p.vx,p.vy)>=255-1e-8&&Math.hypot(p.vx,p.vy)<=285+1e-8));
 g.updateCulling(mob,1);assert.equal(g.projectiles.length,200);
 g.projectiles=[];g.projectilePathBlocked=()=>true;g.updateCulling({...mob,cullingCooldown:0},0);g.updateProjectiles(.05);assert.equal(g.projectiles.length,0);
 g.player.health=10;g.damagePlayer(10,{name:mob.name,skill:'culling'});assert.equal(g.deathReasonText(),'你被黑化卢锡安的圣枪洗礼打死了。');
});
test('Lucian does not attack again during cooldown and bullets stop at twelve tiles',()=>{
 const g=game();g.projectiles=[];g.isMobInView=()=>true;g.canMonsterAggro=()=>true;g.moveMob=()=>{};
 const mob=g.spawnMob('dark_lucian',5,0);g.updateMobs(0,0);
 for(let n=0;n<399;n++)g.updateMobs(.05,n*50);
 assert.equal(g.projectiles.length,200);
 g.updateMobs(.06,20010);assert(g.projectiles.length>200);
 g.mobs=[];g.projectiles=[];let endX;
 g.projectilePathBlocked=(x,y,nextX)=>{endX=nextX;return false;};
 g.spawnProjectile('culling_bullet','monster',0,500,100,500,10,180,12*W.CONFIG.TILE_SIZE);
 g.updateProjectiles(10);assert.equal(endX,240);assert.equal(g.projectiles.length,0);
});
test('hotbar equipment can replace a broken tool without changing the held slot',()=>{
 const g=game();g.selectedSlot={area:'equipment',index:3};
 g.inventory.equipment[3]={itemId:'wood_hoe',count:1,durability:1};
 const spare={itemId:'wood_hoe',count:1,durability:9};g.inventory.equipment[7]=spare;
 g.consumeToolDurability({area:'equipment',index:3,itemId:'wood_hoe'});
 assert.equal(g.inventory.equipment[3],spare);assert.equal(g.inventory.equipment[7],null);assert.equal(g.selectedSlot.index,3);
});
test('Lucian pursues only during firing and stops during cooldown',()=>{
 const g=game();g.projectiles=[];g.isMobInView=()=>true;g.canMonsterAggro=()=>true;
 let moves=0;g.moveMob=()=>{moves++;};g.spawnMob('dark_lucian',5,0);
 g.updateMobs(.05,0);assert.equal(moves,1);
 for(let i=0;i<140;i++)g.updateMobs(.05,i*50);
 const after=moves;g.updateMobs(1,8000);assert.equal(moves,after);assert.equal(g.projectiles.length,200);
});
test('Culling bullets damage animals and other monsters, skip their shooter and stop at blockers',()=>{
 for(const type of ['pig','zombie','dark_lucian']) {
   const g=game();g.projectiles=[];g.projectilePathBlocked=()=>false;g.canMonsterAggro=()=>true;
   g.player.x=1000;g.player.y=1000;
   const shooter=g.spawnMob('dark_lucian',0,0),target=g.spawnMob(type,1,0),hp=target.health;
   g.spawnProjectile('culling_bullet','monster',10,10,100,10,10,180,240,shooter.id);
   g.updateProjectiles(.1);assert.equal(target.health,hp-10);assert.equal(shooter.health,100);assert.equal(g.projectiles.length,0);
   g.projectilePathBlocked=()=>true;
   g.spawnProjectile('culling_bullet','monster',10,10,100,10,10,180,240,shooter.id);
   g.updateProjectiles(.1);assert.equal(target.health,hp-10);assert.equal(g.projectiles.length,0);
 }
});
test('player and monster projectiles pass corpses and still hit living creatures behind them',()=>{
 for(const owner of ['player','monster'])for(const type of ['culling_bullet','enemy_arrow'])for(const dying of [true,false]) {
   const g=game();g.projectiles=[];g.projectilePathBlocked=()=>false;g.canMonsterAggro=()=>true;g.player.x=1000;g.player.y=1000;
   const corpse=g.spawnMob('zombie',1,0),living=g.spawnMob('pig',2,0);
   corpse.health=0;corpse.dying=dying;
   g.spawnProjectile(type,owner,10,10,100,10,10,180,240);g.updateProjectiles(.3);
   assert.equal(living.health,90);assert.equal(corpse.health,0);assert.equal(g.projectiles.length,0);
 }
});
test('monster selection uses weights 10:10:5:1',()=>{
 const g=game(),counts={};const original=context.Math.random;
 for(let n=0;n<26;n++){context.Math.random=()=> (n+.5)/26;const type=g.rollMonsterType();counts[type]=(counts[type]||0)+1;}
 context.Math.random=original;assert.deepEqual(counts,{zombie:10,savage_archer:10,spider:5,dark_lucian:1});
});
test('holy gun drops with five uses and fires toward the mouse with its own cooldown',()=>{
 const g=game();g.projectiles=[];g.pointerInside=true;
 g.inventory.equipment[0]={itemId:'lucian_holy_gun',count:1,durability:5};g.selectedSlot={area:'equipment',index:0};
 let aim={x:100,y:10};g.getPointerWorldPosition=()=>aim;
 assert(g.startHolyGun());assert.equal(g.inventory.equipment[0].durability,4);assert.equal(g.holyGunRemaining(g.inventory.equipment[0]),20);
 assert(!g.startHolyGun());assert.equal(g.inventory.equipment[0].durability,4);
 assert(g.projectiles[0].vx>0);aim={x:10,y:100};
 for(let i=0;i<140;i++)g.updateHolyGun(.05);
 assert.equal(g.projectiles.length,200);assert(g.projectiles.slice(1).every(p=>p.vy>0&&Math.abs(p.vx)<1e-8));
 assert(g.projectiles.every(p=>p.owner==='player'&&p.damage===10&&p.range===240));
 assert(g.projectiles.every(p=>Math.hypot(p.vx,p.vy)>=255-1e-8&&Math.hypot(p.vx,p.vy)<=285+1e-8));
 g.updateHolyGun(13.01);assert.equal(g.holyGunRemaining(g.inventory.equipment[0]),0);assert(g.startHolyGun());
 const mob=g.spawnMob('dark_lucian',2,0);mob.deathSource='player';g.finishMobDeath(mob);
 assert(g.drops.some(d=>d[0]==='lucian_holy_gun'&&d[1]===1));assert.equal(W.ITEMS.lucian_holy_gun.maxDurability,5);
});
test('guns cool independently, preserve cooldown on moves and cannot be dropped while cooling',()=>{
 const g=game();g.projectiles=[];g.pointerInside=true;g.getPointerWorldPosition=()=>({x:100,y:10});
 g.inventory.equipment[0]={itemId:'lucian_holy_gun',count:1,durability:5};
 g.inventory.equipment[1]={itemId:'lucian_holy_gun',count:1,durability:5};
 g.selectedSlot={area:'equipment',index:0};assert(g.startHolyGun());g.updateHolyGun(2);
 g.selectedSlot={area:'equipment',index:1};assert(g.startHolyGun());
 assert.equal(g.holyGunRemaining(g.inventory.equipment[0]),18);assert.equal(g.holyGunRemaining(g.inventory.equipment[1]),20);assert.equal(g.holyGunCasts.length,2);
 const gun=g.inventory.equipment[0];g.dropInventoryStack('equipment',0);assert.equal(g.inventory.equipment[0],gun);assert.equal(g.drops.length,0);
 g.inventory.swap({area:'equipment',index:0},{area:'backpack',index:0});g.inventory.sortBackpack();
 assert.equal(g.holyGunRemaining(g.inventory.backpack[0]),18);
 const chest=new Array(32).fill(null);assert(g.addToArray(chest,g.inventory.backpack[0]));assert.equal(g.holyGunRemaining(chest[0]),18);
 const inv=new W.Inventory();inv.addEquipment(chest[0].itemId,chest[0].durability,chest[0].skillReadyAt);assert.equal(g.holyGunRemaining(inv.equipment[0]),18);
 g.updateHolyGun(20.01);g.tileInFront=()=>({tx:1,ty:0});g.dropInventoryStack('equipment',1);assert.equal(g.inventory.equipment[1],null);assert.equal(g.drops.length,1);
});
test('first-night Lucian spawns once outside view in darkness and approaches before attacking',()=>{
 const g=game();g.clock=new W.GameClock();g.clock.time=21*3600;g.firstNightLucianHour=20.5;
 g.world={waterDepthAt:()=>0};g.projectiles=[];g.canMonsterAggro=()=>true;
 g.isPositionLitBySource=()=>false;g.monsterSpawnAllowed=()=>true;
 g.showToast=()=>{throw Error('First-night monster spawning must remain silent');};
 assert(g.spawnFirstNightLucian());assert.equal(g.mobs.length,1);assert.equal(g.mobs[0].type,'dark_lucian');assert(!g.isMobInView(g.mobs[0]));assert(g.mobs[0].firstNightHunter);assert.equal(g.projectiles.length,0);
 assert(!g.spawnFirstNightLucian());assert.equal(g.mobs.length,1);
});
test('natural Lucian spawning is capped per night, including midnight and the first-night encounter',()=>{
 const g=game();g.clock=new W.GameClock();g.clock.day=1;g.clock.time=21*3600;
 g.firstNightLucianHour=20;g.world={waterDepthAt:()=>0};g.projectiles=[];g.canMonsterAggro=()=>true;
 g.isPositionLitBySource=()=>false;g.monsterSpawnAllowed=()=>true;
 const original=context.Math.random;context.Math.random=()=>.99999;
 assert.notEqual(g.rollMonsterType(),'dark_lucian');assert(g.spawnFirstNightLucian());
 assert.equal(g.spawnNaturalMonster('dark_lucian',5,0),null);assert.notEqual(g.rollMonsterType(),'dark_lucian');
 g.mobs=[];g.clock.day=2;g.clock.time=1*3600;
 assert.equal(g.spawnNaturalMonster('dark_lucian',5,0),null);
 g.clock.time=21*3600;assert.equal(g.rollMonsterType(),'dark_lucian');
 assert(g.spawnNaturalMonster('dark_lucian',5,0));assert.equal(g.spawnNaturalMonster('dark_lucian',6,0),null);
 context.Math.random=original;
});
test('first-night encounter waits for an unlit out-of-view location, including after midnight',()=>{
 const g=game();g.clock=new W.GameClock();g.clock.time=21*3600;g.firstNightLucianHour=20;
 g.world={waterDepthAt:()=>0};g.projectiles=[];g.canMonsterAggro=()=>true;g.monsterSpawnAllowed=()=>true;
 g.isPositionLitBySource=()=>true;assert(!g.spawnFirstNightLucian(true));assert(!g.firstNightLucianSpawned);assert.equal(g.mobs.length,0);
 g.isPositionLitBySource=()=>false;const visible=g.isMobInView;g.isMobInView=()=>true;assert(!g.spawnFirstNightLucian(true));assert.equal(g.mobs.length,0);
 g.isMobInView=visible;g.clock.day=2;g.clock.time=1*3600;g.elapsed=1;
 assert(g.spawnFirstNightLucian());assert(!g.isMobInView(g.mobs[0]));assert.equal(g.lucianSpawnNights.size,1);
});
test('wild rice candidates retain old positions and increase density by about half',()=>{
 const g=game();g.world={seed:42};let old=0,now=0;
 for(let x=-300;x<=300;x+=3)for(let y=-300;y<=300;y+=3) {
   const roll=(Math.imul(x,73856093)^Math.imul(y,19349663)^42)>>>0;
   const was=roll%13===0,candidate=g.isWildRiceCandidate(x,y);
   if(was){old++;assert(candidate);}if(candidate)now++;
 }
 assert(now/old>1.45&&now/old<1.55,`density ratio ${now/old}`);
 assert(!g.isWildRiceCandidate(1,1));
});
test('both holy gun owners trigger shooting sounds, with quieter distant shots and bounded overlap',()=>{
 const g=game();g.projectiles=[];const levels=[];g.audio={playHolyGunShot(v){levels.push(v);}};
 g.spawnProjectile('culling_bullet','player',10,10,100,10,10,270,240);
 g.spawnProjectile('culling_bullet','monster',110,10,10,10,10,270,240);
 assert.equal(levels.length,2);assert(levels[0]>levels[1]);
 const a=Object.create(W.AudioDirector.prototype);a.actionSounds={};a.ctx={currentTime:0};a.muted=false;
 let sounds=0;a.noiseBurst=()=>{sounds++;};a.actionTone=()=>{};
 a.playHolyGunShot();a.ctx.currentTime=.01;a.playHolyGunShot();assert.equal(sounds,1);
 a.ctx.currentTime=.04;a.playHolyGunShot();assert.equal(sounds,2);
 a.ctx.currentTime=.1;a.muted=true;a.playHolyGunShot();assert.equal(sounds,2);
});
console.log(`${passed} progression and Lucian checks passed`);
