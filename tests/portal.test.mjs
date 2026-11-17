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
    world: { featureAt: () => W.FEATURE.NONE, terrainAt: () => W.TERRAIN.GRASS, findSpawn: () => ({ tx: 0, ty: 0 }), waterDepthAt: () => 0 },
    inventory: new W.Inventory(), placedObjects: new Map(), placedObjectTiles: new Map(), placedObjectSequence: 0,
    mobs: [], mobSequence: 0, drops: [], projectiles: [], explored: new Set(), clock: new W.GameClock(), holyGunTime: 0, portalEffects: [],
    pointerInside: true, selectedSlot: { area: "equipment", index: 0 },
    renderInventory() {}, syncHeldStats() {}, hideItemDetails() {}, showToast() {}, clearFoodPress() {}, updateExplored() {}, updateSpawner() {},
    spawnDrop(...args) { this.drops.push(args); }, getPointerWorldPosition: () => ({ x: 210, y: 10 }),
  });
  g.player = new W.Player(g.world);g.clock.setTimeOfDay(22);
  g.player.isBlockedArea = (...args) => g.groundAreaBlocked(...args);
  g.player.isSupportedTile = (x,y) => g.hasWaterSupport(x,y);
  g.inventory.addEquipment("enderman_portal");
  return g;
}
function place(g, type, tx, ty) {
  const o = { type, tx, ty, tiles: [{tx,ty}] };o.storageKey = W.Buildings.key(o);
  g.placedObjects.set(o.storageKey,o);
  const occupants=g.placedObjectTiles.get(tx+","+ty)||new Set();occupants.add(o);g.placedObjectTiles.set(tx+","+ty,occupants);g.invalidateRooms();return o;
}

test("enderman drops one fragment, four fragments craft a 15-use portal",()=>{
  const g=game(),mob=g.spawnMob("enderman",1,0);g.finishMobDeath(mob);
  assert.equal(g.drops[0][0],"enderman_portal_fragment");assert.equal(g.drops[0][1],1);
  g.inventory.addItem("enderman_portal_fragment",4);
  assert(g.inventory.craft(W.RECIPES.find(r=>r.output==="enderman_portal")).ok);
  assert.equal(g.inventory.countItem("enderman_portal_fragment"),0);
  assert.equal(W.ITEMS.enderman_portal.maxDurability,15);
});
test("target permits any passable layers and water but rejects nine blocked cells or out-of-view centres",()=>{
  const g=game();for(const type of ["roof","torch","wood_floor"])place(g,type,10,0);
  assert(g.portalPlan(210,10).valid);assert(!g.portalPlan(510,10).valid);
  for(let y=-1;y<=1;y++)for(let x=9;x<=11;x++)place(g,"wall",x,y);
  assert(!g.portalPlan(210,10).valid);
  const wall=g.objectsAt(11,1).find(o=>o.type==="wall");g.placedObjects.delete(wall.storageKey);
  assert(g.portalPlan(210,10).valid);
});
test("portals illuminate both ends, brighten a wider area after preparation and stop emitting at disappearance",()=>{
  const g=game();assert(g.startPortal());
  assert(g.isPositionLitBySource(70,10));assert(g.isPositionLitBySource(150,10));assert(!g.isPositionLitBySource(110,10));
  assert(!g.monsterSpawnAllowed(3,0));
  g.updatePortalEffects(1.5);assert(g.isPositionLitBySource(110,10));
  g.updatePortalEffects(1.499);assert.equal(g.portalEffects.length,1);assert(g.isPositionLitBySource(70,10));
  g.updatePortalEffects(.001);assert.equal(g.portalEffects.length,0);assert(!g.isPositionLitBySource(70,10));assert(g.monsterSpawnAllowed(3,0));
});
test("R activation consumes one use, starts eight-second per-item cooldown and rejects invalid casts transactionally",()=>{
  const g=game();assert(g.startPortal());assert.equal(g.inventory.equipment[0].durability,14);assert.equal(g.holyGunRemaining(g.inventory.equipment[0]),8);
  assert(!g.startPortal());assert.equal(g.inventory.equipment[0].durability,14);
  g.holyGunTime=8;g.getPointerWorldPosition=()=>({x:510,y:10});assert(!g.startPortal());assert.equal(g.inventory.equipment[0].durability,14);
  g.getPointerWorldPosition=()=>({x:210,y:10});g.paused=true;assert(!g.startPortal());
});
test("1.5 + 0.5 + 0.5 + 0.5 timeline preserves offsets and keeps a final half-second after the arrival outline",()=>{
  const g=game(),a=g.spawnMob("pig",0,0),b=g.spawnMob("zombie",10,0);
  a.x+=8;a.y+=5;b.x+=3;b.y+=6;assert(g.startPortal());
  g.player.x=90;g.player.y=90; // Walking out must exclude the caster.
  g.updatePortalEffects(1.49);assert(!a.portalFrozen);
  g.updatePortalEffects(.01);assert(a.portalFrozen&&b.portalFrozen);assert(!g.player.portalFrozen);
  assert.equal(g.moveMob(a,1,0,.1),false);assert.equal(a.x,18);
  g.updatePortalEffects(.499);assert.equal(a.x,18);
  g.updatePortalEffects(.001);assert.equal(a.x,218);assert.equal(a.y,15);assert.equal(b.x,13);assert.equal(b.y,16);
  assert(a.portalFrozen&&b.portalFrozen);g.enforceGroundObstacleInvariant();assert.equal(a.x,218);assert.equal(b.x,13);
  g.updatePortalEffects(.499);assert(a.portalFrozen&&b.portalFrozen);assert.equal(g.portalEffects.length,1);
  g.updatePortalEffects(.001);assert(!a.portalFrozen&&!b.portalFrozen);assert.equal(g.portalEffects.length,1);
  g.updatePortalEffects(.499);assert.equal(g.portalEffects.length,1);g.updatePortalEffects(.001);assert.equal(g.portalEffects.length,0);
  assert.equal(g.player.cameraOffset,null);
});
test("empty portals are valid and do not pull the escaped player back",()=>{
  const g=game();assert(g.startPortal());g.player.x=90;g.player.y=90;
  g.updatePortalEffects(3);assert.equal(g.player.x,90);assert.equal(g.player.y,90);assert(!g.player.portalFrozen);assert.equal(g.portalEffects.length,0);
});
test("first-outline entrants share the fixed second-second exchange and three-second disappearance",()=>{
  for(const enterAt of [1.7,1.99]) {
    const g=game(),animal=g.spawnMob("pig",3,0),monster=g.spawnMob("zombie",7,0);
    assert(g.startPortal());g.player.x=90;g.player.y=90;g.updatePortalEffects(1.5);
    assert(!animal.portalFrozen&&!monster.portalFrozen&&!g.player.portalFrozen);
    g.updatePortalEffects(enterAt-1.5);
    g.player.x=15;g.player.y=13;animal.x=25;animal.y=10;monster.x=205;monster.y=10;
    // Physics can move units into a hole after the frame's effect timer update.
    g.capturePortalEntrants();const cast=g.portalEffects[0];
    assert(g.player.portalFrozen&&animal.portalFrozen&&monster.portalFrozen);assert.equal(cast.selected.length,3);
    g.capturePortalEntrants();assert.equal(cast.selected.length,3);
    g.updatePortalEffects(2-enterAt-.001);assert.equal(g.player.x,15);assert.equal(animal.x,25);assert.equal(monster.x,205);
    g.updatePortalEffects(.001);assert.equal(g.player.x,215);assert.equal(g.player.y,13);assert.equal(animal.x,225);assert.equal(monster.x,5);
    assert(g.player.portalFrozen&&animal.portalFrozen&&monster.portalFrozen);
    g.updatePortalEffects(.5);assert(!g.player.portalFrozen&&!animal.portalFrozen&&!monster.portalFrozen);
    assert.equal(g.portalEffects.length,1);assert.equal(cast.selected.length,3);
    g.updatePortalEffects(.5);assert.equal(g.portalEffects.length,0);
    assert.equal(g.player.x,215);assert.equal(animal.x,225);assert.equal(monster.x,5);
  }
});
test("second-outline entrants are neither outlined nor teleported",()=>{
  for(const enterAt of [2,2.2,2.49]) {
    const g=game(),animal=g.spawnMob("pig",3,0),monster=g.spawnMob("zombie",7,0);assert(g.startPortal());g.player.x=90;g.player.y=90;
    g.updatePortalEffects(enterAt);g.player.x=15;g.player.y=13;animal.x=25;monster.x=205;
    g.capturePortalEntrants();assert(!g.player.portalFrozen&&!animal.portalFrozen&&!monster.portalFrozen);
    g.updatePortalEffects(3-enterAt);assert.equal(g.player.x,15);assert.equal(animal.x,25);assert.equal(monster.x,205);assert.equal(g.portalEffects.length,0);
  }
});
test("player at A and zombie at B exchange in both directions, with sound exactly at creation and exchange",()=>{
  const g=game(),zombie=g.spawnMob("zombie",10,0);let opened=0,swapped=0;
  g.audio={playPortalOpen(){opened++;},playPortalSwap(){swapped++;}};
  const plan=g.portalPlan(210,10);assert.equal(plan.origin.x,g.player.x);assert.equal(plan.origin.y,g.player.y);
  assert(g.startPortal());assert.equal(opened,1);assert.equal(swapped,0);
  assert(!g.startPortal());assert.equal(opened,1);
  g.updatePortalEffects(1.5);assert(g.player.portalFrozen&&zombie.portalFrozen);assert.equal(g.player.x,10);assert.equal(zombie.x,210);
  assert.equal(swapped,0);g.updatePortalEffects(.5);
  assert.equal(g.player.x,210);assert.equal(zombie.x,10);assert.equal(swapped,1);
  g.updatePortalEffects(.5);assert.equal(g.portalEffects.length,1);g.updatePortalEffects(.5);assert.equal(g.portalEffects.length,0);assert.equal(opened,1);assert.equal(swapped,1);
});
test("nearby units keep their exact offsets even when their original footprints overlap",()=>{
  const g=game(),pig=g.spawnMob("pig",0,0);pig.x=18;
  assert(g.startPortal());g.updatePortalEffects(2);
  assert.equal(g.player.x,210);assert.equal(pig.x,218);assert.equal(pig.y,10);
});
test("camera immediately returns over 0.2 seconds on arrival while the player remains outlined and frozen",()=>{
  const g=game();assert(g.startPortal());g.player.x=15;g.player.y=12;
  g.updatePortalEffects(1.5);g.player.update(1,1,0,false);assert.equal(g.player.x,15);
  g.updatePortalEffects(.5);assert.equal(g.player.x,215);assert.equal(g.player.y,12);assert.equal(g.player.cameraOffset.x,-200);
  assert(g.player.cameraOffset.returning);g.updatePortalCamera(.1);assert.equal(g.player.cameraOffset.x,-100);assert(g.player.portalFrozen);
  g.updatePortalCamera(.099);assert(g.player.cameraOffset);g.updatePortalCamera(.001);assert.equal(g.player.cameraOffset,null);assert(g.player.portalFrozen);
  g.updatePortalEffects(.5);assert(!g.player.portalFrozen);assert.equal(g.player.cameraOffset,null);
});
test("obstructed relative landing uses a nearby legal cell without clipping or damaging buildings",()=>{
  const g=game();const wall=place(g,"wall",10,0);assert(g.startPortal());
  g.updatePortalEffects(2);assert(g.portalGroundClear(g.player,g.player.x,g.player.y));assert.equal(Math.hypot(g.player.x-210,g.player.y-10),20);
  assert(g.placedObjects.has(wall.storageKey));g.enforceGroundObstacleInvariant();assert(g.portalGroundClear(g.player,g.player.x,g.player.y));
});
test("enderman water contact waits for the arrival outline, then leaves one HP before death after 1.5 seconds",()=>{
  for(const depth of [1,2]) {
    const g=game(),mob=g.spawnMob("enderman",0,0);g.world.terrainAt=x=>x>=9?W.TERRAIN.OCEAN:W.TERRAIN.GRASS;g.world.waterDepthAt=x=>x>=9?depth:0;
    assert(g.startPortal());g.player.x=90;g.player.y=90;g.updatePortalEffects(2);
    assert(mob.portalFrozen);assert.equal(mob.health,90);assert(!mob.dying);
    g.updateMobOxygen(mob,1);assert.equal(mob.health,90);
    const landing=mob.x;g.enforceGroundObstacleInvariant();assert.equal(mob.x,landing);
    g.updatePortalEffects(.5);assert(!mob.portalFrozen);assert.equal(mob.health,1);assert.equal(mob.waterDeathRemaining,1.5);
    g.enforceGroundObstacleInvariant();assert.equal(mob.x,landing,"Water arrivals must not be corrected back onto land");
    assert(g.moveMob(mob,1,0,.1));assert(mob.x>landing);
    const moved=mob.x;g.enforceGroundObstacleInvariant();assert.equal(mob.x,moved);
    place(g,"wall",12,0);assert(!g.mobCanOccupy(250,10,mob),"Water exposure must not bypass solid obstacles");
    assert(!g.mobCanOccupy(230,10,{type:"enderman"}),"Unexposed endermen must still fear water");
    g.updateMobOxygen(mob,1.499);assert.equal(mob.health,1);assert(!mob.dying);
    g.updateMobOxygen(mob,.001);assert.equal(mob.health,0);assert(mob.dying);assert.equal(mob.deathSource,"water");
  }
});
test("deep-water arrival grants land mobs escape movement, ten oxygen and player-rate drowning",()=>{
  const g=game(),mob=g.spawnMob("pig",0,0);g.world.terrainAt=x=>x>=9?W.TERRAIN.OCEAN:W.TERRAIN.GRASS;g.world.waterDepthAt=x=>x>=9?2:0;
  assert(g.startPortal());g.player.x=90;g.player.y=90;g.updatePortalEffects(2.5);
  assert(mob.deepWaterEscape);assert(g.mobCanOccupy(230,10,mob));assert(!g.mobCanOccupy(230,10,{type:"pig"}));
  const before=mob.x;assert(g.moveMob(mob,1,0,.1));assert(mob.x>before);
  g.updateMobOxygen(mob,10);assert.equal(mob.oxygen,0);assert.equal(mob.health,100);
  g.updateMobOxygen(mob,1.5);assert.equal(mob.health,85);
  mob.x=10;mob.y=10;g.updateMobOxygen(mob,1);assert.equal(mob.oxygen,1);assert(!mob.deepWaterEscape);assert(!g.mobCanOccupy(230,10,mob));
});
test("aquatic animals keep breathing naturally; water deaths and cancellation cannot leave permanent freezes",()=>{
  const g=game(),fish=g.spawnMob("small_fish",10,0);g.world.terrainAt=()=>W.TERRAIN.OCEAN;g.world.waterDepthAt=()=>2;
  g.updateMobOxygen(fish,100);assert.equal(fish.health,30);
  g.world.terrainAt=()=>W.TERRAIN.GRASS;assert(g.startPortal());g.updatePortalEffects(1.5);assert(g.player.portalFrozen);
  g.clearPortalEffects();assert(!g.player.portalFrozen);assert(!fish.portalFrozen);assert.equal(g.portalEffects.length,0);
});
test("fish and sharks exchanged onto land stay still, lose ten health per real second and die with their normal drops",()=>{
  for(const [type,drop] of [["small_fish","raw_fish"],["shark","deep_sea_gills"]]) {
    const g=game(),fish=g.spawnMob(type,10,0),maximum=fish.maxHealth;
    g.world.terrainAt=x=>x>=9?W.TERRAIN.OCEAN:W.TERRAIN.GRASS;g.world.waterDepthAt=x=>x>=9?2:0;
    assert(g.startPortal());g.updatePortalEffects(2);
    assert.equal(fish.x,10);assert.equal(fish.y,10);assert(fish.beached);assert(fish.portalLandEscape);
    assert.equal(g.moveMob(fish,1,0,1),false);assert.equal(fish.x,10);
    g.updatePortalEffects(.5);g.player.x=30;g.lastPlayerSafe={x:30,y:10};
    g.damageMob(fish,1); // A hit must not make the fish flee or the shark chase/attack.
    g.updateMobs(.25,performance.now());g.enforceGroundObstacleInvariant();
    assert.equal(fish.health,maximum-3.5);assert.equal(fish.x,10);assert.equal(fish.y,10);
    g.updateMobs(.75,performance.now());assert.equal(fish.health,maximum-11);assert.equal(g.player.health,100);
    assert(!fish.aggro);assert.equal(fish.oxygen,10);
    g.updateMobOxygen(fish,(maximum-11)/10+.001);assert.equal(fish.health,0);assert(fish.dying);assert.equal(fish.deathSource,"stranding");
    g.finishMobDeath(fish);assert.equal(g.drops.at(-1)[0],drop);
  }
});
test("aquatic animals in shallow/deep water keep their health and can be rescued from stranding",()=>{
  for(const depth of [1,2]) {
    const g=game(),fish=g.spawnMob("small_fish",0,0);
    fish.portalLandEscape=true;g.updateMobOxygen(fish,1);assert.equal(fish.health,20);assert(fish.beached);
    g.world.terrainAt=()=>W.TERRAIN.OCEAN;g.world.waterDepthAt=()=>depth;
    g.updateMobOxygen(fish,5);assert.equal(fish.health,20);assert(!fish.beached);
    assert(g.moveMob(fish,1,0,.1));
  }
});
test("overlapping ends select each unit once and a last-use cast survives the broken item",()=>{
  const g=game();g.getPointerWorldPosition=()=>({x:30,y:10});g.inventory.equipment[0].durability=1;
  assert(g.startPortal());assert.equal(g.inventory.equipment[0],null);g.updatePortalEffects(1.5);
  assert.equal(g.portalEffects[0].selected.length,1);g.updatePortalEffects(.5);assert.equal(g.player.x,30);
  g.updatePortalEffects(.5);assert(!g.player.portalFrozen);
});
test("both outline phases reject direct and environmental damage and release restores normal damage",()=>{
  const g=game(),mob=g.spawnMob("zombie",0,0);assert(g.startPortal());
  for(const step of [1.5,.5]) {
    g.updatePortalEffects(step);assert(g.player.portalFrozen&&mob.portalFrozen);
    const playerHP=g.player.health,mobHP=mob.health;
    const playerX=g.player.x,mobX=mob.x;
    g.player.update(.1,1,0,false);g.moveMob(mob,1,0,.1);
    assert.equal(g.player.x,playerX);assert.equal(mob.x,mobX);
    g.damagePlayer(999,mob);g.player.takeDamage(999,{type:"food"});g.damageMob(mob,999);
    g.applyDaylightDamage(1);g.beginMobDeath(mob,"water");
    assert.equal(g.player.health,playerHP);assert.equal(mob.health,mobHP);assert(!mob.dying);
    g.world.terrainAt=()=>W.TERRAIN.OCEAN;g.world.waterDepthAt=()=>2;
    mob.oxygen=0;g.player.oxygen=0;g.player.satiety=0;
    g.updateMobOxygen(mob,1);g.player.updateVitals(1);
    assert.equal(g.player.health,playerHP);assert.equal(mob.health,mobHP);
    g.world.terrainAt=()=>W.TERRAIN.GRASS;g.world.waterDepthAt=()=>0;
  }
  g.updatePortalEffects(.5);assert(!g.player.portalFrozen&&!mob.portalFrozen);
  g.damagePlayer(10,mob);g.damageMob(mob,10,"monster");assert.equal(g.player.health,90);assert.equal(mob.health,60);
});

test("player and monster bullets pass through outlined units and still hit living targets behind them",()=>{
  for(const owner of ["player","monster"]) for(const phase of [1.5,2]) {
    const g=game(),outlined=g.spawnMob("pig",0,0);assert(g.startPortal());g.updatePortalEffects(phase);
    const x=g.player.x,playerHP=g.player.health;
    const target=g.spawnMob("pig",Math.floor(x/20)+2,0);
    g.spawnProjectile("culling_bullet",owner,x-30,10,x+100,10,10,100,240);
    g.updateProjectiles(.35);assert.equal(g.projectiles.length,1);assert.equal(g.player.health,playerHP);assert.equal(outlined.health,100);
    g.updateProjectiles(.5);assert.equal(g.projectiles.length,0);assert.equal(target.health,90);
  }
});

test("enderman water death remains scheduled after leaving water and pauses while outlined",()=>{
  const g=game(),mob=g.spawnMob("enderman",0,0);g.world.terrainAt=()=>W.TERRAIN.OCEAN;
  g.updateMobOxygen(mob,0);assert.equal(mob.health,1);assert.equal(mob.waterDeathRemaining,1.5);
  g.world.terrainAt=()=>W.TERRAIN.GRASS;g.updateMobOxygen(mob,.5);
  mob.portalFrozen=true;g.updateMobOxygen(mob,2);assert.equal(mob.waterDeathRemaining,1);assert(!mob.dying);
  mob.portalFrozen=false;g.updateMobOxygen(mob,1);assert(mob.dying);assert.equal(mob.deathSource,"water");
});

test("natural land and aquatic searches include distant candidates up to fifty tiles",()=>{
  const original=context.Math.random;
  try {
    for(const monster of [false,true]) {
      const g=game();context.Math.random=()=>0;
      let calls=0;context.Math.random=()=>++calls%2===1?0:.9;
      const tile=g.findMobSpawnTile(monster);
      assert(tile);assert.equal(tile.tx,46);assert(g.isWithinMobRange((tile.tx+.5)*20,(tile.ty+.5)*20));
    }
    const g=game();g.world.terrainAt=()=>W.TERRAIN.OCEAN;g.world.waterDepthAt=()=>2;
    let calls=0;context.Math.random=()=>[0,0,.9,0,0][calls++%5];g.spawnAquaticPopulation();
    assert.equal(g.mobs.length,2);for(const m of g.mobs){assert.equal(m.x,930);assert(g.isWithinMobRange(m.x,m.y));}
  } finally {context.Math.random=original;}
});

test("fifty-tile boundary is inclusive and all living creature categories beyond it are deleted without drops",()=>{
  const g=game();assert(g.isWithinMobRange(g.player.x+1000,g.player.y));assert(!g.isWithinMobRange(g.player.x+1000.01,g.player.y));
  for(const type of ["pig","zombie","small_fish","shark"])g.spawnMob(type,51,0);
  const corpse=g.spawnMob("zombie",52,0);g.beginMobDeath(corpse);
  const boundary=g.spawnMob("pig",50,0);boundary.speed=0;
  g.updateMobs(0,performance.now());assert.equal(g.mobs.length,1);assert.equal(g.mobs[0],boundary);assert.equal(g.drops.length,0);
});

test("room searches reject cells beyond fifty tiles and rounded perimeter candidates cannot exceed the boundary",()=>{
  const original=context.Math.random;
  try {
    const g=game(),room={cells:[{tx:51,ty:0}]};
    g.getRoomIndex=()=>({closedRooms:[room]});g.isRoomInView=()=>false;g.monsterSpawnAllowed=()=>true;g.mobCanOccupy=()=>true;
    g.world.terrainAt=()=>W.TERRAIN.OCEAN;g.world.waterDepthAt=()=>2;
    context.Math.random=()=>0;assert.equal(g.findMobSpawnTile(true),null);
    room.cells=[{tx:49,ty:0}];assert.equal(g.findMobSpawnTile(true).tx,49);
    const h=game();h.player.x=0;h.player.y=0;
    let calls=0;context.Math.random=()=>++calls%2===1?0:.99999;
    // Rounding yields tile 50, whose centre lies outside the real player radius.
    assert.equal(h.findMobSpawnTile(false),null);
  } finally {context.Math.random=original;}
});
test("map targets require an explored centre within sixty tiles and retain the nine-cell obstacle rule",()=>{
  const g=game();for(const tx of [10,50,60,61])g.explored.add(g.tileKey(tx,0));
  assert(g.portalPlan(1010,10,true).valid);assert(!g.portalPlan(1010,10).valid);
  assert(g.portalPlan(1210,10,true).valid);assert(!g.portalPlan(1230,10,true).valid);
  assert(!g.portalPlan(1030,10,true).valid);assert(!g.portalPlan(NaN,10,true).valid);
  for(let y=-1;y<=1;y++)for(let x=49;x<=51;x++)place(g,"wall",x,y);
  assert(!g.portalPlan(1010,10,true).valid);
  const wall=g.objectsAt(50,0).find(o=>o.type==="wall");g.placedObjects.delete(wall.storageKey);
  place(g,"roof",50,0);place(g,"torch",50,0);assert(g.portalPlan(1010,10,true).valid);
});

test("valid map casts close the map before creation; invalid targets, cooldown and wrong equipment consume nothing",()=>{
  const g=game();g.mapOpen=true;g.pointerInside=false;let closed=0;
  g.closeMap=()=>{assert.equal(g.portalEffects.length,0);closed++;g.mapOpen=false;g.mapPortalTarget=null;};
  g.mapPortalTarget={x:1010,y:10};assert(!g.startPortal(true));assert.equal(closed,0);assert.equal(g.inventory.equipment[0].durability,15);
  g.explored.add(g.tileKey(50,0));g.inventory.equipment[0].skillReadyAt=8;
  assert(!g.startPortal(true));assert.equal(closed,0);
  g.holyGunTime=8;assert(g.startPortal(true));assert.equal(closed,1);assert(!g.mapOpen);
  assert.equal(g.portalEffects[0].ends[1].x,1010);assert.equal(g.inventory.equipment[0].durability,14);assert.equal(g.holyGunRemaining(g.inventory.equipment[0]),8);
  const h=game();h.mapOpen=true;h.mapPortalTarget={x:210,y:10};h.explored.add(h.tileKey(10,0));h.inventory.equipment[0]={itemId:"wood_sword",count:1,durability:60};
  assert(!h.startPortal(true));assert.equal(h.portalEffects.length,0);
});

test("map mouse conversion accounts for canvas scaling and panning",()=>{
  const g=game();g.mapOpen=true;g.mapCamX=50;g.mapCamY=-20;
  g.worldMapCanvas={width:960,height:600,getBoundingClientRect:()=>({left:100,top:50,width:480,height:300})};
  g.updateMapPortalTarget(180,130);assert.equal(g.mapPortalTarget.x,1400);assert.equal(g.mapPortalTarget.y,0);
  const target=g.mapPortalTarget;g.updateMapPortalTarget(99,50);assert.equal(g.mapPortalTarget,target);
});

test("long map exchanges start camera return at the third stage and finish within half a second",()=>{
  const g=game();g.mapOpen=true;g.mapPortalTarget={x:1210,y:10};g.explored.add(g.tileKey(60,0));
  g.closeMap=()=>{g.mapOpen=false;g.mapPortalTarget=null;};assert(g.startPortal(true));
  g.updatePortalEffects(1.999);assert.equal(g.player.x,10);assert.equal(g.player.cameraOffset,null);
  g.updatePortalEffects(.001);assert.equal(g.player.x,1210);assert(g.player.portalFrozen);assert.equal(g.player.cameraOffset.duration,.5);
  g.updatePortalCamera(.25);assert.equal(g.player.cameraOffset.x,-600);
  g.updatePortalCamera(.249);assert(g.player.cameraOffset);g.updatePortalCamera(.001);assert.equal(g.player.cameraOffset,null);
  g.updatePortalEffects(.5);assert(!g.player.portalFrozen);
});
console.log(`${passed} portal integration checks passed`);
