/**
 * Headless checks for inventory stacking, swapping and capacity.
 * Run with: node tests/inventory.test.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

for (const file of ["js/config.js", "js/inventory.js"]) {
  vm.runInThisContext(readFileSync(join(root, file), "utf8"), { filename: file });
}

const { Inventory, ITEMS, RECIPES, INVENTORY_LAYOUT } = globalThis.Wilds;

const equipmentTestItem = Object.freeze({
  id: "pickaxe",
  name: "铜镐",
  kind: "equipment",
  maxStack: 1,
  maxDurability: 100,
  description: "铜镐，装备，测试用",
});

const definitions = Object.freeze({
  ...ITEMS,
  pickaxe: equipmentTestItem,
});

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("  ok  " + name);
  } catch (error) {
    failed += 1;
    console.error("FAIL  " + name);
    console.error("      " + error.message);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function makeInventory() {
  return new Inventory(definitions);
}

function slot(inventory, area, index) {
  return inventory.getSlot(area, index);
}

console.log("\nWilds — inventory checks\n");

test("equipment has 8 slots and the backpack has 4 × 8 slots", () => {
  assert(INVENTORY_LAYOUT.equipment === 8, "equipment slot count");
  assert(INVENTORY_LAYOUT.backpack === 32, "backpack slot count");
  assert(INVENTORY_LAYOUT.backpackColumns === 8, "backpack columns");
  assert(INVENTORY_LAYOUT.backpackRows === 4, "backpack rows");

  const inventory = makeInventory();
  assert(inventory.equipment.length === 8, "equipment array size");
  assert(inventory.backpack.length === 32, "backpack array size");
  assert(inventory.equipment.every((entry) => entry === null), "equipment starts empty");
  assert(inventory.backpack.every((entry) => entry === null), "backpack starts empty");
});

test("materials fill the equipment bar first", () => {
  const inventory = makeInventory();
  assert(inventory.addItem("wood", 3) === 3, "accepted wood");
  assert(slot(inventory, "equipment", 0).itemId === "wood", "wood in equipment 0");
  assert(slot(inventory, "equipment", 0).count === 3, "wood count");
  assert(slot(inventory, "backpack", 0) === null, "backpack untouched");
});

test("materials merge into an existing stack before opening a new slot", () => {
  const inventory = makeInventory();
  inventory.addItem("wood", 3);
  inventory.addItem("wood", 68);

  assert(slot(inventory, "equipment", 0).count === 64, "first stack reaches 64");
  assert(slot(inventory, "equipment", 1).itemId === "wood", "overflow uses next slot");
  assert(slot(inventory, "equipment", 1).count === 7, "overflow count");
});

test("a matching backpack stack is merged before using an empty equipment slot", () => {
  const inventory = makeInventory();
  inventory.setSlot("backpack", 0, { itemId: "coal", count: 4 });
  inventory.addItem("coal", 2);

  assert(slot(inventory, "backpack", 0).count === 6, "backpack stack merged");
  assert(slot(inventory, "equipment", 0) === null, "no new equipment stack was needed");
});

test("material stacks never exceed 64", () => {
  const inventory = makeInventory();
  inventory.addItem("coal", 25);

  for (const area of ["equipment", "backpack"]) {
    for (const stack of inventory.getSlots(area)) {
      if (!stack) continue;
      assert(stack.count <= 64, "stack over 64 in " + area);
      assert(stack.count > 0, "empty stack should be null");
    }
  }
  assert(inventory.countItem("coal") === 25, "all coal preserved");
});

test("equipment takes one slot each and moves into the backpack when needed", () => {
  const inventory = makeInventory();
  for (let i = 0; i < 8; i += 1) {
    inventory.setSlot("equipment", i, { itemId: "rock", count: 10 });
  }

  assert(inventory.addItem("pickaxe", 2) === 2, "both pickaxes accepted");
  assert(slot(inventory, "backpack", 0).itemId === "pickaxe", "first pickaxe in backpack");
  assert(slot(inventory, "backpack", 0).count === 1, "equipment max stack is one");
  assert(slot(inventory, "backpack", 1).count === 1, "second pickaxe in its own slot");
});

test("empty and non-empty slots can be swapped in either direction", () => {
  const inventory = makeInventory();
  inventory.setSlot("equipment", 2, { itemId: "wood", count: 4 });
  inventory.setSlot("backpack", 5, { itemId: "rock", count: 2 });

  assert(inventory.swap({ area: "equipment", index: 2 }, { area: "backpack", index: 5 }), "equipment to backpack swap");
  assert(slot(inventory, "equipment", 2).itemId === "rock", "rock moved to equipment");
  assert(slot(inventory, "backpack", 5).itemId === "wood", "wood moved to backpack");

  assert(inventory.swap({ area: "equipment", index: 2 }, { area: "backpack", index: 9 }), "item to empty slot swap");
  assert(slot(inventory, "equipment", 2) === null, "equipment slot emptied");
  assert(slot(inventory, "backpack", 9).itemId === "rock", "rock moved to empty backpack slot");
});

test("swapping a slot with itself is a no-op", () => {
  const inventory = makeInventory();
  inventory.setSlot("equipment", 0, { itemId: "dirt", count: 2 });
  assert(inventory.swap({ area: "equipment", index: 0 }, { area: "equipment", index: 0 }) === false);
  assert(slot(inventory, "equipment", 0).count === 2, "stack unchanged");
});

test("adding stops when every slot is full", () => {
  const inventory = makeInventory();
  assert(inventory.addItem("rock", 2560) === 2560, "filled 40 slots with rock");
  assert(inventory.addItem("wood", 1) === 0, "no space left");
  assert(inventory.countItem("wood") === 0, "wood was not added");
});

test("equipment stores per-item durability and never stacks", () => {
  const inventory = makeInventory();
  assert(inventory.addEquipment("wood_axe", 11) === true, "axe accepted");
  const axe = slot(inventory, "equipment", 0);
  assert(axe.itemId === "wood_axe" && axe.count === 1, "one axe in its own slot");
  assert(axe.durability === 11, "custom durability stored");

  assert(inventory.addEquipment("wood_axe", 15) === true, "second axe accepted");
  assert(slot(inventory, "equipment", 1).count === 1, "each equipment takes one slot");
  assert(slot(inventory, "equipment", 0).durability === 11, "first durability untouched");
});

test("crafting an axe consumes exactly five wood and creates a full-durability tool", () => {
  const inventory = makeInventory();
  inventory.addItem("wood", 6);
  const recipe = RECIPES.find((entry) => entry.output === "wood_axe");

  const result = inventory.craft(recipe);
  assert(result.ok === true, "craft succeeded");
  assert(inventory.countItem("wood") === 1, "exactly five wood consumed");
  const axe = inventory.equipment.find((entry) => entry && entry.itemId === "wood_axe");
  assert(axe && axe.durability === 15, "axe starts at max durability");
});

test("crafting a stone sword consumes the requested materials", () => {
  const inventory = makeInventory();
  inventory.addItem("wood", 3);
  inventory.addItem("rock", 5);
  const recipe = RECIPES.find((entry) => entry.output === "stone_sword");

  assert(inventory.craft(recipe).ok === true, "stone sword crafted");
  assert(inventory.countItem("wood") === 0, "wood consumed");
  assert(inventory.countItem("rock") === 0, "rock consumed");
  const sword = slot(inventory, "equipment", 0);
  assert(sword && sword.itemId === "stone_sword" && sword.durability === 60, "sword durability");
});

test("crafting without enough materials changes nothing", () => {
  const inventory = makeInventory();
  inventory.addItem("wood", 4);
  const recipe = RECIPES.find((entry) => entry.output === "wood_shovel");

  const result = inventory.craft(recipe);
  assert(result.ok === false && result.reason === "materials", "craft rejected");
  assert(inventory.countItem("wood") === 4, "wood untouched");
  assert(!inventory.equipment.some((entry) => entry && entry.itemId === "wood_shovel"), "no output added");
});

test("the respawn stele costs eight rock and produces a placeable material", () => {
  const inventory = makeInventory();
  inventory.addItem("rock", 9);
  const recipe = RECIPES.find((entry) => entry.output === "respawn_stele");

  assert(inventory.craft(recipe).ok === true, "respawn stele crafted");
  assert(inventory.countItem("rock") === 1, "eight rock consumed");
  assert(inventory.countItem("respawn_stele") === 1, "respawn stele in inventory");
  assert(ITEMS.respawn_stele.description === "复活吧我的爱人", "respawn description");
});

test("material recipes produce placeable torch and stele items", () => {
  const inventory = makeInventory();
  inventory.addItem("wood", 4);
  inventory.addItem("coal", 4);
  inventory.addItem("rock", 3);
  inventory.addItem("dirt", 3);

  const torchRecipe = RECIPES.find((entry) => entry.output === "torch");
  const steleRecipe = RECIPES.find((entry) => entry.output === "stele");

  assert(inventory.craft(torchRecipe).ok === true, "torch crafted");
  assert(inventory.countItem("torch") === 1, "torch in inventory");
  assert(inventory.countItem("wood") === 2, "torch wood consumed");
  assert(inventory.countItem("coal") === 3, "torch coal consumed");

  assert(inventory.craft(steleRecipe).ok === true, "stele crafted");
  assert(inventory.countItem("stele") === 1, "stele in inventory");
  assert(ITEMS.stele.placeType === "stele" && ITEMS.torch.placeType === "torch", "both are placeable");
});

test("recipe costs match the requested recipes", () => {
  const byOutput = Object.fromEntries(RECIPES.map((recipe) => [recipe.output, recipe.costs]));
  assert(JSON.stringify(byOutput.wood_axe) === JSON.stringify({ wood: 5 }), "wood axe");
  assert(JSON.stringify(byOutput.stone_axe) === JSON.stringify({ wood: 2, rock: 3 }), "stone axe");
  assert(JSON.stringify(byOutput.wood_pickaxe) === JSON.stringify({ wood: 5 }), "wood pickaxe");
  assert(JSON.stringify(byOutput.stone_pickaxe) === JSON.stringify({ wood: 2, rock: 3 }), "stone pickaxe");
  assert(JSON.stringify(byOutput.wood_shovel) === JSON.stringify({ wood: 5 }), "wood shovel");
  assert(JSON.stringify(byOutput.stone_shovel) === JSON.stringify({ wood: 2, rock: 3 }), "stone shovel");
  assert(JSON.stringify(byOutput.torch) === JSON.stringify({ wood: 2, coal: 1 }), "torch");
  assert(JSON.stringify(byOutput.wood_sword) === JSON.stringify({ wood: 7 }), "wood sword");
  assert(JSON.stringify(byOutput.stone_sword) === JSON.stringify({ wood: 3, rock: 5 }), "stone sword");
  assert(
    JSON.stringify(byOutput.stele) === JSON.stringify({ wood: 2, rock: 3, coal: 3, dirt: 3 }),
    "stele"
  );
  assert(JSON.stringify(byOutput.respawn_stele) === JSON.stringify({ rock: 8 }), "respawn stele");
  assert(JSON.stringify(byOutput.comfortable_bed) === JSON.stringify({ wool: 1, wood: 5, rock: 2 }), "bed");
  assert(JSON.stringify(byOutput.wood_bow) === JSON.stringify({ silk: 2, wood: 8 }), "bow");
  assert(JSON.stringify(byOutput.storage_chest) === JSON.stringify({ wood: 8 }), "chest");
  assert(JSON.stringify(byOutput.furnace) === JSON.stringify({ rock: 8 }), "furnace");
});

test("tool durability, speed, attack and placement metadata match the request", () => {
  assert(ITEMS.workbench.placeType === "workbench", "workbench is placeable");
  assert(ITEMS.torch.placeType === "torch" && ITEMS.stele.placeType === "stele", "torch and stele are placeable");
  assert(ITEMS.respawn_stele.placeType === "respawn_stele", "respawn stele is placeable");

  const expected = {
    wood_axe: [15, "axe", 1],
    stone_axe: [30, "axe", 1.5],
    wood_pickaxe: [15, "pickaxe", 1],
    stone_pickaxe: [30, "pickaxe", 1.5],
    wood_shovel: [15, "shovel", 1],
    stone_shovel: [30, "shovel", 1.5],
  };
  for (const [id, [durability, toolType, speed]] of Object.entries(expected)) {
    const item = ITEMS[id];
    assert(item.maxDurability === durability, id + " durability");
    assert(item.toolType === toolType, id + " tool type");
    assert(item.speedMultiplier === speed, id + " speed");
  }

  assert(ITEMS.wood_sword.maxDurability === 30 && ITEMS.wood_sword.attackBonus === 10, "wood sword");
  assert(ITEMS.stone_sword.maxDurability === 60 && ITEMS.stone_sword.attackBonus === 15, "stone sword");
  assert(ITEMS.torch.description === "材料，怕黑不老铁", "torch description");
  assert(ITEMS.stele.description === "斌神的强大震古烁今", "stele description");
  assert(ITEMS.stele.steleText.includes("他是在替这个宇宙维护正确性。"), "stele inscription");
});

test("food and bow metadata match the requested effects", () => {
  assert(ITEMS.raw_mutton.edible.satiety === 30 && ITEMS.raw_mutton.edible.poisonChance === 0.5, "mutton");
  assert(ITEMS.algorithm_chicken_leg.edible.satiety === 20 && ITEMS.algorithm_chicken_leg.edible.poisonDamage === 30, "chicken");
  assert(ITEMS.zombie_elbow.edible.satiety === 20 && ITEMS.zombie_elbow.edible.slowFactor === 0.3, "elbow");
  assert(ITEMS.comfortable_bed.placeType === "bed", "bed placeable");
  assert(ITEMS.wood_bow.maxDurability === 30 && ITEMS.wood_bow.attackDamage === 40, "bow");
  assert(ITEMS.creation_scroll.unbreakable === true, "scroll");
  assert(ITEMS.cooked_mutton.edible.satiety === 60 && ITEMS.cooked_mutton.edible.poisonChance === 0, "cooked mutton");
  assert(ITEMS.cooked_algorithm_chicken_leg.edible.satiety === 40, "cooked chicken");
  assert(ITEMS.strange_waste.edible.kills === true, "waste kills");
  assert(ITEMS.workbench.description === "创造一切吧", "workbench description");
});

test("item metadata matches the requested descriptions", () => {
  assert(ITEMS.coal.description === "小煤块，材料，在岩石地随处可见", "coal description");
  assert(ITEMS.wood.description === "木块，材料，砍伐树木后掉落", "wood description");
  assert(ITEMS.dirt.description === "土块，材料，挖掘脚下的草地获得", "dirt description");
  assert(ITEMS.rock.description === "岩石块，材料，挖掘脚下的岩石获得", "rock description");
  assert(ITEMS.coal.maxStack === 64 && ITEMS.wood.maxStack === 64, "material max stack");
  assert(ITEMS.wood_axe.description === "装备，对树木使用，可以加快砍伐速度", "axe description");
  assert(ITEMS.stone_pickaxe.description === "结实一点的装备，对岩石使用，可以加快挖掘速度", "pickaxe description");
  assert(ITEMS.wood_sword.description === "装备，可以自保的武器", "sword description");
});

test("all requested item names, types and descriptions are present", () => {
  const expected = {
    wood_axe: ["木斧头", "装备", "装备，对树木使用，可以加快砍伐速度"],
    stone_axe: ["石斧头", "装备", "结实一点的装备，对树木使用，可以加快砍伐速度"],
    wood_pickaxe: ["木镐子", "装备", "装备，对岩石使用，可以加快挖掘速度"],
    stone_pickaxe: ["石镐子", "装备", "结实一点的装备，对岩石使用，可以加快挖掘速度"],
    wood_shovel: ["木铲子", "装备", "装备，对草地使用，可以加快挖掘速度"],
    stone_shovel: ["石铲子", "装备", "结实一点的装备，对草地使用，可以加快挖掘速度"],
    torch: ["火把", "材料", "材料，怕黑不老铁"],
    wood_sword: ["木剑", "装备", "装备，可以自保的武器"],
    stone_sword: ["石剑", "装备", "结实一点的装备，你过来呀啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊"],
    stele: ["夸赞斌神的石碑", "材料", "斌神的强大震古烁今"],
    respawn_stele: ["复活石碑", "材料", "复活吧我的爱人"],
    wool: ["羊毛", "材料", "从羊身上获取的毛发"],
    raw_mutton: ["生羊腿", "材料", "吃生肉小心食物中毒，长按鼠标左键食用"],
    algorithm_chicken_leg: ["斌神培育的算法鸡腿", "材料", "吃生肉小心食物中毒，长按鼠标左键食用"],
    zombie_elbow: ["僵尸肘子", "材料", "奇怪的肘子，真的可以吃吗"],
    silk: ["丝线", "材料", "野人猎手身上搜刮到的奇怪物品"],
    comfortable_bed: ["舒服的床", "材料", "帮你熬过晚上，睡觉把"],
    wood_bow: ["木弓", "装备", "装备，远程攻击，单次伤害40"],
    creation_scroll: ["创世卷轴", "装备", "学习部重要成员张嘉颂开发的卷轴，可以助你合成工具台，拿在手上右键点击"],
    storage_chest: ["储物箱", "材料", "可以容纳物品的箱子"],
    furnace: ["熔炼炉", "材料", "没有什么是不可以烧的哈哈哈哈哈哈哈哈哈"],
    cooked_mutton: ["熟羊腿", "材料", "美味可口"],
    cooked_algorithm_chicken_leg: ["熟斌神培育的算法鸡腿", "材料", "美味可口"],
    strange_waste: ["奇怪废料", "材料", "真的可以吃吗"],
  };

  for (const [id, [name, type, description]] of Object.entries(expected)) {
    const item = ITEMS[id];
    assert(item.name === name, id + " name");
    assert((item.kind === "equipment" ? "装备" : "材料") === type, id + " type");
    assert(item.description === description, id + " description");
  }
});

test("non-wearing equipment stacks to 64 while wearing tools remain separate",()=>{
 const inventory=makeInventory();inventory.addItem("creation_scroll",65);
 assert(slot(inventory,"equipment",0).count===64,"scroll stack");assert(slot(inventory,"equipment",1).count===1,"scroll overflow");
 inventory.addItem("wood_axe",2);assert(slot(inventory,"equipment",2).count===1&&slot(inventory,"equipment",3).count===1,"axes separated");
});

console.log("\n  " + passed + " passed, " + failed + " failed\n");
process.exitCode = failed === 0 ? 0 : 1;
