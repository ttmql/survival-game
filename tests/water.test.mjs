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

function waterGame() {
 const g=game(),dug=new Set();
 g.world.terrainAt=(x,y)=>x<=0?W.TERRAIN.GRASS:W.TERRAIN.OCEAN;
 g.world.waterDepthAt=(x,y)=>x<=0?0:x<=2?1:2;
 g.world.markDug=(x,y)=>dug.add(x+","+y);g.world.isDug=(x,y)=>dug.has(x+","+y);
 g.player.isSupportedTile=(x,y)=>g.hasWaterSupport(x,y);
 return g;
}
test("shore depth is deterministic and silica only occurs in deep water",()=>{
 const w=W.World.createWorld(0x1a2b3c4d);let shallow=0,deep=0,silica=0;
 for(let y=-60;y<60;y++)for(let x=-60;x<60;x++){
 const d=w.waterDepthAt(x,y);if(d===1)shallow++;if(d===2)deep++;
 if(w.featureAt(x,y)===W.FEATURE.SILICA){assert.equal(d,2);silica++;}
 if(d===1){let shore=false;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)if(w.terrainAt(x+dx,y+dy)!==W.TERRAIN.OCEAN)shore=true;assert.ok(shore);}
 }
 assert.ok(shallow&&deep&&silica);
});
test("shallow water preserves oxygen, deep water drains it, and floats restore land movement",()=>{
 const g=waterGame();g.player.x=30;g.player.y=10;g.player.updateVitals(1);assert.equal(g.player.oxygen,10);assert.equal(g.player.isWading,true);
 g.player.x=70;g.player.updateVitals(1);assert.equal(g.player.oxygen,9);assert.equal(g.player.isDiving,true);
 add(g,"driftwood",3,0);g.player.updateVitals(1);assert.equal(g.player.oxygen,10);assert.equal(g.player.isDiving,false);assert.equal(g.player.isWading,false);
 assert.equal(g.mobCanOccupy(70,10),true);assert.equal(g.mobCanOccupy(90,10),false);
});
test("water building requires floats and land floors cannot be placed on water",()=>{
 const g=waterGame();assert.equal(g.placementPlan(W.ITEMS.wall,1,0).valid,false);
 assert.equal(g.placementPlan(W.ITEMS.wood_floor,1,0).valid,false);assert.equal(g.placementPlan(W.ITEMS.driftwood,0,0).valid,false);
 add(g,"driftwood",1,0);assert.equal(g.placementPlan(W.ITEMS.wall,1,0).valid,true);
 add(g,"wall",1,0);add(g,"torch",1,0);add(g,"roof",1,0);
 g.world.featureAt=(x,y)=>x===1?W.FEATURE.SILICA:W.FEATURE.NONE;g.world.removeFeatureAt=()=>{g.world.featureAt=()=>W.FEATURE.NONE;};
 for(const type of ["wall","roof","driftwood"]){assert.equal(g.placedObjectAt(1,0).type,type);g.finishObjectMining({tx:1,ty:0});}
 assert.equal(g.drops.filter(d=>d[0]==="torch").length,1);assert.equal(g.miningTargetAt(1,0).kind,"silica");
 g.finishMining({tx:1,ty:0,kind:"silica"});assert.equal(g.miningTargetAt(1,0).kind,"sand");
 g.finishMining({tx:1,ty:0,kind:"sand"});assert.equal(g.miningTargetAt(1,0),null);
 g.finishMining({tx:1,ty:0,kind:"sand"});assert.equal(g.drops.filter(d=>d[0]==="fine_sand").length,1);
});
test("sand smelts into glass with fuel and success sound",()=>{
 const g=waterGame();let sound=0;g.audio={playCraftSuccess(){sound++;}};g.furnaceObject={fuel:1};g.furnaceFeedback={};g.renderFurnace=()=>{};
 g.inventory.addItem("fine_sand",1);g.useFurnaceSlot("equipment",0);assert.equal(g.inventory.countItem("glass"),1);assert.equal(g.furnaceObject.fuel,0);assert.equal(sound,1);
});
test("bottle recipe and water collection are transactional and reusable",()=>{
 const g=waterGame();for(const [id,n]of Object.entries({glass:2,silica:1,wood:1}))g.inventory.addItem(id,n);
 assert.equal(g.inventory.craft(W.RECIPES.find(r=>r.output==="glass_bottle")).ok,true);
 let sound=0;g.audio={playFillWater(){sound++;}};assert.equal(g.fillWaterBottle(1,0),true);assert.equal(g.inventory.countItem("water_bottle"),1);assert.equal(sound,1);
 assert.equal(g.fillWaterBottle(0,0),false);
});
test("manure restricts all other food for one game day without consuming rejected food",()=>{
 const g=waterGame();g.player.satiety=50;g.inventory.addItem("animal_manure",1);g.eatFood("equipment",0);
 assert.equal(g.player.satiety,60);assert.equal(g.player.manureDietHours,24);
 g.inventory.addItem("raw_fish",1);g.eatFood("equipment",0);assert.equal(g.inventory.countItem("raw_fish"),1);assert.equal(g.player.satiety,60);
 g.player.updateEffects(24);g.eatFood("equipment",0);assert.equal(g.inventory.countItem("raw_fish"),0);assert.equal(g.player.satiety,80);
});
test("land creatures wade through shallow water while aquatic creatures stay in deep water",()=>{
 const g=waterGame();assert.equal(g.mobCanOccupy(30,10),true);assert.equal(g.mobCanOccupy(90,10),false);
 const fish=g.spawnMob("small_fish",4,0);assert.equal(fish.health,30);assert.equal(g.mobCanOccupy(90,10,fish),true);assert.equal(g.mobCanOccupy(30,10,fish),false);
 add(g,"driftwood",4,0);assert.equal(g.mobCanOccupy(90,10,fish),false);
});
test("fish flee and sharks only attack after being provoked for 25 damage",()=>{
 const g=waterGame();g.player.x=70;g.player.y=10;g.clock.setTimeOfDay(12);
 const fish=g.spawnMob("small_fish",5,0);g.damageMob(fish,1);assert.ok(fish.fleeUntil>performance.now());
 const shark=g.spawnMob("shark",4,0);assert.equal(shark.health,120);
 g.updateMobs(0.01,performance.now());assert.equal(g.player.health,100);assert.equal(shark.aggro,false);
 g.damageMob(shark,1);g.updateMobs(0.01,performance.now()+1);assert.equal(g.player.health,75);assert.equal(shark.aggro,true);
 g.finishMobDeath(fish);assert.equal(g.drops.at(-1)[0],"raw_fish");g.finishMobDeath(shark);assert.equal(g.drops.at(-1)[0],"deep_sea_gills");
});
test("raw fish smelts into cooked fish and restores the specified satiety",()=>{
 const g=waterGame();g.player.satiety=0;g.inventory.addItem("raw_fish",2);g.eatFood("equipment",0);assert.equal(g.player.satiety,20);
 g.furnaceObject={fuel:1};g.furnaceFeedback={};g.renderFurnace=()=>{};g.useFurnaceSlot("equipment",0);
 assert.equal(g.inventory.countItem("cooked_fish"),1);g.eatFood("equipment",0);assert.equal(g.player.satiety,60);
});
test("enderman fears all water while other land monsters can still wade",()=>{
 const g=waterGame(),mob=g.spawnMob("enderman",0,0);
 assert(g.mobCanOccupy(10,10,mob));assert(!g.mobCanOccupy(30,10,mob));assert(!g.mobCanOccupy(90,10,mob));
 assert(g.mobCanOccupy(30,10,{type:"zombie"}));
 add(g,"driftwood",1,0);assert(!g.mobCanOccupy(30,10,mob));
});
test("enderman keeps aggro at the dry shoreline and resumes blinking when the player leaves water",()=>{
 for(const playerX of [30,70]) {
   const g=waterGame();g.clock.setTimeOfDay(22);g.player.x=playerX;
   const mob=g.spawnMob("enderman",-3,0);let sounds=0;
   g.audio={playEndermanBlink(){sounds++;},playPlayerHurt(){}};g.provokeEnderman(mob,0);
   for(let i=0;i<100;i++)g.updateMobs(.05,i*50);
   assert(mob.provoked&&mob.aggro);assert(mob.x>10&&mob.x<15);assert(g.mobCanOccupy(mob.x,mob.y,mob));
   assert.equal(g.player.health,100);assert.equal(sounds,0);assert.equal(mob.blinkCooldown,0);
   g.player.x=10;g.player.facing="down";g.updateMobs(.05,5100);
   assert.equal(sounds,1);assert.equal(mob.blinkCooldown,8);assert.equal(g.player.health,70);
 }
});
console.log(passed+" water checks passed");
