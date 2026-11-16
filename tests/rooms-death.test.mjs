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
test("the exact covered closed-door example is enclosed", () => {
  const g = game(); house(g);
  assert.equal(g.getRoomIndex().closedRooms.length, 1);
  assert.equal(g.closedRoomAtPosition(30, 30).cells.length, 2);
});
test("missing wall, open door and missing ceiling each make the whole room open", () => {
  for (const change of ["wall", "door", "roof"]) {
    const g = game(); house(g);
    assert.ok(g.closedRoomAtPosition(30, 30));
    if (change === "wall") g.finishObjectMining({ tx: 3, ty: 1 });
    if (change === "roof") g.finishObjectMining({ tx: 2, ty: 1 });
    if (change === "door") { g.player.x = 50; g.player.y = 70; g.openPlacedObject(2, 2); }
    assert.equal(g.closedRoomAtPosition(30, 30), null, change);
    assert.equal(g.closedRoomAtPosition(50, 30), null, change);
  }
});
test("repair and door re-closing update the cached room immediately", () => {
  const g = game(); house(g); g.player.x = 50; g.player.y = 70;
  g.openPlacedObject(2, 2); assert.equal(g.closedRoomAtPosition(30, 30), null);
  g.openPlacedObject(2, 2); assert.ok(g.closedRoomAtPosition(30, 30));
  g.finishObjectMining({ tx: 2, ty: 1 }); assert.equal(g.closedRoomAtPosition(30, 30), null);
  add(g, "roof", 2, 1); assert.ok(g.closedRoomAtPosition(30, 30));
});
test("mixed open/enclosed sides suppress aggro, matching sides retain it", () => {
  const g = game(); house(g); house(g, 6);
  const mob = g.spawnMob("zombie", 1, 1);
  g.player.x = 30; g.player.y = 90; assert.equal(g.canMonsterAggro(mob), false);
  g.player.y = 30; assert.equal(g.canMonsterAggro(mob), true);
  g.player.x = 150; assert.equal(g.canMonsterAggro(mob), true, "different closed rooms still match");
  mob.x = 110; assert.equal(g.canMonsterAggro(mob), false);
  g.player.y = 90; assert.equal(g.canMonsterAggro(mob), true);
});
test("actual AI clears cross-region aggro, including damage-triggered aggro", () => {
  const g = game(); house(g); g.clock.setTimeOfDay(22); g.player.x = 30; g.player.y = 90;
  const mob = g.spawnMob("zombie", 1, 1); mob.aggro = true;
  g.updateMobs(0.01, performance.now()); assert.equal(mob.aggro, false);
  g.damageMob(mob, 1); assert.equal(mob.aggro, false);
  g.player.y = 30; g.updateMobs(0.01, performance.now()); assert.equal(mob.aggro, true);
});
test("sunlight damages only open-area monsters from 06:00 to 18:00", () => {
  const g = game(); house(g);
  const indoor = g.spawnMob("zombie", 1, 1), outside = g.spawnMob("zombie", 5, 1);
  g.clock.setTimeOfDay(17.5); g.updateMobs(0.1, performance.now());
  assert.equal(indoor.health, 70); assert.equal(outside.health, 69);
  g.clock.setTimeOfDay(18); g.updateMobs(0.1, performance.now()); assert.equal(outside.health, 69);
  g.finishObjectMining({ tx: 2, ty: 1 }); g.clock.setTimeOfDay(12);
  g.updateMobs(0.1, performance.now()); assert.equal(indoor.health, 69);
});
test("enclosed rooms have no ambient daylight; wall-mounted torches light interiors", () => {
  const g = game(); house(g); g.clock.setTimeOfDay(12);
  assert.equal(g.isPositionLit(30, 30), false);
  add(g, "torch", 0, 3); assert.equal(g.isPositionLit(30, 30), false, "outside light cannot cross the sealed boundary");
  add(g, "torch", 0, 1); assert.equal(g.isPositionLit(30, 30), true);
});
test("unseen dark enclosed rooms permit daytime spawning, visible or lit ones do not", () => {
  const g = game(); house(g, 20); g.clock.setTimeOfDay(12);
  assert.equal(g.monsterSpawnAllowed(21, 1), true);
  const spot = g.findMobSpawnTile(true); assert.ok(spot); assert.ok(g.getRoomIndex().at(spot.tx, spot.ty));
  g.player.x = 410; assert.equal(g.monsterSpawnAllowed(21, 1), false, "any visible part suppresses the whole room");
  g.player.x = 10; add(g, "torch", 20, 1); assert.equal(g.monsterSpawnAllowed(21, 1), false);
});
test("outdoor spawning uses 20:00–06:00 even for a house with one missing roof", () => {
  const g = game(); house(g, 20); g.finishObjectMining({ tx: 22, ty: 1 });
  for (const [hour, allowed] of [[12, false], [19.99, false], [20, true], [5.99, true], [6, false]]) {
    g.clock.setTimeOfDay(hour); assert.equal(g.monsterSpawnAllowed(21, 1), allowed);
  }
});
test("daytime aggro switches to combat music without needing night", () => {
  const g = game(); g.started = true; g.clock.setTimeOfDay(12);
  let scene; g.audio = { update(input) { scene = input; } };
  const mob = g.spawnMob("zombie", 3, 1); mob.aggro = true;
  g.updateAudio(1000); assert.equal(scene.combat, true); assert.equal(scene.phase, "day");
  mob.aggro = false; g.updateAudio(6000); assert.equal(scene.combat, false);
});
test("drowning and starvation keep distinct lethal causes", () => {
  const g = game(); g.player.health = 0.5; g.player.satiety = 0; g.player.updateVitals(1);
  assert.equal(g.deathReasonText(), "你饿死了");
  g.player.reset(g.world); g.world.terrainAt = () => W.TERRAIN.OCEAN;
  g.player.health = 1; g.player.oxygen = 0; g.player.updateVitals(1);
  assert.equal(g.deathReasonText(), "你淹死了");
  g.player.takeDamage(100, { type: "monster", name: "后续伤害" }); assert.equal(g.deathReasonText(), "你淹死了");
});
test("new monster names and arrows retain automatic lethal attribution after the source disappears", () => {
  const g = game(); g.player.health = 1;
  g.damagePlayer(2, { name: "未来怪物", type: "future" }); assert.equal(g.deathReasonText(), "你被【未来怪物】击败了");
  g.player.reset(g.world); g.player.health = 1;
  const archer = g.spawnMob("savage_archer", 3, 0); archer.name = "未来射手";
  g.spawnProjectile("future_arrow", "monster", -10, 10, 30, 10, 2, 200, 200, archer.id);
  g.mobs = []; g.updateProjectiles(0.2);
  assert.equal(g.deathReasonText(), "你被【未来射手】击败了");
});
test("future poisonous food and instant damaging food record their catalogue names", () => {
  const g = game();
  const item = { id: "future_food", name: "未来毒蘑菇", kind: "material", maxStack: 10, edible: { satiety: 0, poisonChance: 1, poisonDamage: 50, poisonHours: 2 } };
  g.inventory = new W.Inventory({ future_food: item }); g.inventory.addItem(item.id, 1);
  g.player.health = 1; g.eatFood("equipment", 0); g.player.updateEffects(0.1);
  assert.equal(g.deathReasonText(), "你吃【未来毒蘑菇】食物中毒死了");
  g.player.reset(g.world); g.inventory = new W.Inventory(); g.inventory.addItem("spider_leg", 1);
  g.player.health = 1; g.die = () => {}; g.eatFood("equipment", 0);
  assert.equal(g.deathReasonText(), "你吃【蜘蛛腿】食物中毒死了");
});
test("multiple poisonous foods retain separate sources and reset clears attribution", () => {
  const g = game(); g.player.health = 1;
  g.player.applyPoison(10, 1, { name: "食物甲" }); g.player.applyPoison(30, 1, { name: "食物乙" });
  assert.equal(g.player.poisonSources.length, 2);
  g.player.updateEffects(0.5); assert.equal(g.deathReasonText(), "你吃【食物甲】食物中毒死了");
  g.player.reset(g.world); assert.equal(g.player.deathCause, null); assert.equal(g.player.poisonSources.length, 0);
});
test("perimeter walls and corners belong to the room and their lamps do not light outdoors", () => {
  const g=game(); house(g);
  const room=g.getRoomIndex().at(1,1);
  assert.equal(g.getRoomIndex().at(0,0),room);
  assert.equal(g.getRoomIndex().at(3,1),room);
  add(g,"torch",0,1);
  assert.equal(g.isPositionLitBySource(-10,30),false);
  assert.equal(g.isPositionLitBySource(30,30),true);
});
test("shark aggro does not trigger battle music but monster aggro still does",()=>{
 const g=game();g.started=true;g.combatMusicUntil=0;let input;g.audio={update(value){input=value;}};
 const shark=g.spawnMob("shark",4,0);shark.aggro=true;g.updateAudio(1000);assert.equal(input.combat,false);
 const zombie=g.spawnMob("zombie",4,0);zombie.aggro=true;g.updateAudio(1001);assert.equal(input.combat,true);
});
console.log(`\n${passed} room and death checks passed`);
