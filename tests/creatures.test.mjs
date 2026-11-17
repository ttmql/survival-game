// Integration checks exercise the real Game methods without starting the DOM UI.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const context = vm.createContext({ console, performance, Math: Object.create(Math), document: { readyState: "loading", addEventListener() {} } });
for (const file of ["config", "buildings", "time", "inventory", "player", "renderer", "game"]) {
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
}
test("pig and spider have 100 health and share animal/monster damage behavior", () => {
  const g = game();
  const pig = g.spawnMob("pig", 3, 0), spider = g.spawnMob("spider", 4, 0);
  let animalSound = 0, monsterSound = 0;
  g.audio = { playAnimalHurt() { animalSound++; }, playMonsterHurt() { monsterSound++; } };
  assert.equal(pig.health, 100); assert.equal(spider.health, 100);
  g.damageMob(pig, 5); g.damageMob(spider, 5);
  assert.equal(animalSound, 1); assert.equal(monsterSound, 1);
  assert.ok(pig.fleeUntil > performance.now()); assert.equal(spider.aggro, true);
});
test("pig produces manure on its game clock and never while dying", () => {
  const g = game(), pig = g.spawnMob("pig", 3, 0);
  assert.ok(pig.manureHoursRemaining >= 12 && pig.manureHoursRemaining <= 24);
  pig.manureHoursRemaining = 0.001;
  g.updateMobs(0.05, performance.now());
  assert.equal(g.drops[0][0], "animal_manure"); assert.equal(g.drops.length, 1);
  pig.dying = true; pig.deathStartedAt = performance.now(); pig.manureHoursRemaining = 0;
  g.updateMobs(0.05, performance.now()); assert.equal(g.drops.length, 1);
});
test("kills drop pork/spider legs but sun deaths do not", () => {
  const g = game();
  for (const [type, expected] of [["pig", "raw_pork"], ["spider", "spider_leg"]]) {
    const mob = g.spawnMob(type, 3, 0); g.finishMobDeath(mob);
    assert.equal(g.drops.at(-1)[0], expected);
  }
  const mob = g.spawnMob("spider", 3, 0); mob.deathSource = "sun";
  g.finishMobDeath(mob); assert.equal(g.drops.length, 2);
});
test("spider lands one tile from the player, animates, and respects cooldown", () => {
  const g = game(), spider = g.spawnMob("spider", 4, 0);
  assert.equal(g.trySpiderJump(spider), true);
  g.updateSpiderJump(spider, 0.2); assert.ok(spider.jump);
  g.updateSpiderJump(spider, 0.2); assert.equal(spider.jump, null);
  assert.equal(Math.hypot(spider.x - g.player.x, spider.y - g.player.y), W.CONFIG.TILE_SIZE);
  spider.x = 90; assert.equal(g.trySpiderJump(spider), false);
});
test("spider cannot jump across blockers or continue through newly placed blockers", () => {
  const g = game(), spider = g.spawnMob("spider", 4, 0);
  g.mobCanOccupy = x => x < 45 || x > 65;
  assert.equal(g.trySpiderJump(spider), false);
  g.mobCanOccupy = () => true; assert.equal(g.trySpiderJump(spider), true);
  g.mobCanOccupy = x => x > 65;
  g.updateSpiderJump(spider, 0.4);
  assert.equal(spider.x, 90); assert.equal(spider.jump, null);
  spider.jumpCooldown = 0; spider.x = 150;
  assert.equal(g.trySpiderJump(spider), false);
});
test("raw pork probability, slow duration, cooked food and two-hour grace", () => {
  for (const [random, slowed] of [[0.69, true], [0.7, false]]) {
    context.Math.random = () => random;
    const g = game(); g.player.satiety = 70; g.inventory.addItem("raw_pork", 1);
    g.eatFood("equipment", 0);
    assert.equal(g.player.satiety, 100); assert.equal(g.satietyGraceRemaining, 2);
    assert.equal(g.player.speedFactor, slowed ? 0.5 : 1);
    if (slowed) { g.player.updateEffects(2); assert.equal(g.player.speedFactor, 1); }
  }
  const g = game(); g.player.satiety = 20; g.inventory.addItem("cooked_pork", 1);
  g.eatFood("equipment", 0); assert.equal(g.player.satiety, 80);
});
test("spider leg removes 30 health and triggers death at zero", () => {
  const g = game(); let deaths = 0; g.die = () => deaths++;
  g.inventory.addItem("spider_leg", 2); g.eatFood("equipment", 0);
  assert.equal(g.player.health, 70);
  g.player.health = 20; g.eatFood("equipment", 0);
  assert.equal(g.player.health, 0); assert.equal(deaths, 1);
});
test("furnace cooks pork from either inventory area and consumes fuel", () => {
  for (const area of ["equipment", "backpack"]) {
    const g = game(); g.furnaceObject = { fuel: 1 }; g.furnaceFeedback = {};
    g.renderFurnace = () => {};
    g.inventory.setSlot(area, 0, { itemId: "raw_pork", count: 1 });
    g.useFurnaceSlot(area, 0);
    assert.equal(g.inventory.countItem("raw_pork"), 0);
    assert.equal(g.inventory.countItem("cooked_pork"), 1); assert.equal(g.furnaceObject.fuel, 0);
  }
});
test("enderman stays neutral until its real silhouette is hovered, including the head", () => {
  const g = game(), mob = g.spawnMob("enderman", 4, 0);
  g.wanderMob = () => {}; g.canMonsterAggro = () => true;
  assert.equal(mob.health, 90);
  g.updateMobs(0, 0); assert.equal(mob.aggro, false); assert.equal(g.player.health, 100);
  g.pointerInside = true;
  g.getPointerWorldPosition = () => ({ x: mob.x, y: mob.y - 12 });
  g.storageOpen = true; g.updateMobs(0, 0); assert.equal(mob.provoked, false);
  g.storageOpen = false;
  // Empty space between the legs or above the head is not the model.
  g.getPointerWorldPosition = () => ({ x: mob.x, y: mob.y + 3 });
  g.updateMobs(0, 0); assert.equal(mob.provoked, false);
  g.getPointerWorldPosition = () => ({ x: mob.x, y: mob.y - 26 });
  g.updateMobs(0, 0);
  assert(mob.provoked); assert(mob.aggro); assert.equal(g.player.health, 70);
  assert.equal(mob.x, g.player.x); assert.equal(mob.y, g.player.y - 20);
});

test("only player damage provokes enderman, with immediate blink and no retaliation after lethal damage", () => {
  const g = game(), mob = g.spawnMob("enderman", 4, 0);
  g.canMonsterAggro = () => true;
  g.damageMob(mob, 10, "monster"); assert.equal(mob.provoked, false); assert.equal(g.player.health, 100);
  g.damageMob(mob, 10); assert(mob.provoked); assert.equal(g.player.health, 70); assert.equal(mob.health, 70);
  const dying = g.spawnMob("enderman", 5, 0);
  g.damageMob(dying, 90); assert(dying.dying); assert.equal(g.player.health, 70);
});

test("enderman blinks behind all four facings and updates collision safe position", () => {
  for (const [facing, x, y] of [["down", 10, -10], ["up", 10, 30], ["left", 30, 10], ["right", -10, 10]]) {
    const g = game(), mob = g.spawnMob("enderman", 4, 0);
    g.canMonsterAggro = () => true; g.player.facing = facing; g.provokeEnderman(mob, 0);
    assert.equal(mob.x, x); assert.equal(mob.y, y);
    assert.equal(mob.lastSafeX, x); assert.equal(mob.lastSafeY, y);
    assert.equal(mob.blinkCooldown, 8); assert.equal(mob.attackAt, 1000);
  }
});

test("enderman repeats its skill at eight simulation seconds and keeps normal melee between blinks", () => {
  const g = game(), mob = g.spawnMob("enderman", 4, 0);
  g.canMonsterAggro = () => true; g.moveMob = () => {}; g.player.health = 1000;
  g.provokeEnderman(mob, 0); assert.equal(g.player.health, 970);
  g.player.facing = "right";
  g.updateMobs(1, 1000); assert.equal(g.player.health, 940); assert.equal(mob.blinkCooldown, 7);
  mob.attackAt = Infinity;
  g.updateMobs(6.99, 7990); assert.equal(mob.x, 10); assert.equal(g.player.health, 940);
  g.updateMobs(0.02, 8010); assert.equal(mob.x, -10); assert.equal(mob.y, 10);
  assert.equal(g.player.health, 910); assert.equal(mob.blinkCooldown, 8);
});

test("enderman teleports past intervening walls and searches beyond occupied adjacent cells", () => {
  const g = game(), mob = g.spawnMob("enderman", 4, 0);
  g.canMonsterAggro = () => true; mob.aggro = true;
  g.mobCanOccupy = x => x < 45 || x > 65;
  assert(g.tryEndermanBlink(mob, 0)); assert.equal(mob.x, 10); assert.equal(mob.y, -10);
  mob.x = 90; mob.y = 10; mob.blinkCooldown = 0; g.player.health = 100; g.mobCanOccupy = () => true;
  for (const [tx, ty] of [[0,-1],[-1,0],[1,0],[-1,-1],[1,-1],[0,1],[-1,1],[1,1]]) g.spawnMob("pig", tx, ty);
  assert(g.tryEndermanBlink(mob, 1000)); assert.equal(Math.hypot(mob.x - 10, mob.y - 10), 40);
  assert.equal(g.player.health, 100, "A distant landing must not inflict ranged melee damage");
  mob.blinkCooldown = 0; g.mobs = [mob]; g.canMonsterAggro = () => false;
  assert.equal(g.tryEndermanBlink(mob, 0), false); assert.equal(mob.blinkCooldown, 0);
});

test("enderman searches for the nearest landing beyond multiple blocked rings", () => {
  const g = game(), mob = g.spawnMob("enderman", 8, 0);
  g.canMonsterAggro = () => true; mob.aggro = true;
  g.mobCanOccupy = (x, y) => Math.hypot(x - 10, y - 10) >= 59;
  assert(g.tryEndermanBlink(mob, 0)); assert.equal(Math.hypot(mob.x - 10, mob.y - 10), 60);
  assert.equal(g.player.health, 100); assert.equal(mob.blinkCooldown, 8);
});

test("blocked rear landing falls back to a neighbouring cell and only successful blinks make sound", () => {
  const g = game(), mob = g.spawnMob("enderman", 4, 0);
  let sounds = 0;
  g.audio = { playEndermanBlink() { sounds++; }, playPlayerHurt() {} };
  g.canMonsterAggro = () => true; g.mobCanOccupy = (x, y) => y >= 0;
  g.provokeEnderman(mob, 0);
  assert.equal(Math.abs(mob.x - 10), 20); assert.equal(mob.y, 10); assert.equal(g.player.health, 70); assert.equal(sounds, 1);
  assert.equal(g.tryEndermanBlink(mob, 1), false); assert.equal(sounds, 1);
  mob.blinkCooldown = 0; g.mobCanOccupy = () => false;
  assert.equal(g.tryEndermanBlink(mob, 1000), false); assert.equal(sounds, 1);
});

test("neutral enderman does not switch combat music, while a provoked one does", () => {
  const g = game(), mob = g.spawnMob("enderman", 4, 0), scenes = [];
  g.wanderMob = () => {}; g.canMonsterAggro = () => true;
  g.started = true; g.clock.phase = { key: "night" }; g.audio = { playPlayerHurt() {}, update(scene) { scenes.push(scene); } };
  g.updateMobs(0, 0); g.updateAudio(1000); assert.equal(scenes.at(-1).combat, false);
  g.provokeEnderman(mob, 1000); g.updateAudio(1000); assert.equal(scenes.at(-1).combat, true);
});
test("hidden enderman silhouettes do not provoke and lethal melee names the killer", () => {
  const g = game(), mob = g.spawnMob("enderman", 4, 0);
  const foreground = { type: "wall" };
  g.placedObjects = new Map([["wall", foreground]]);
  g.renderer = {
    mobOccluders: () => [foreground],
    fixtureBounds: () => ({ left: 80, right: 100, top: -30, bottom: 30 }),
  };
  assert.equal(g.endermanHovered(mob, { x: 90, y: -16 }), false);
  g.renderer = null; g.canMonsterAggro = () => true;
  g.player.health = 30; g.provokeEnderman(mob, 0);
  assert.equal(g.player.health, 0); assert.equal(g.deathReasonText(), "你被【末影人】击败了");
});
console.log(`\n${passed} creature integration checks passed`);
