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
console.log(`\n${passed} creature integration checks passed`);
