// Real-browser scene and rendering checks. Run using run-browser-test.ps1 -CheckScript buildings-browser.mjs.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

const port = Number(process.argv[2]), url = process.argv[3];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let targets;
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); break; } catch { await delay(200); }
}
const ws = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener("open", resolve, { once: true }));
let seq = 0; const pending = new Map(), errors = [];
ws.addEventListener("message", e => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.text);
  if (pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(m.error) : resolve(m.result); }
});
function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }); }
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function screenshot(name) {
  const result = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(new URL(`../screenshots/${name}.png`, import.meta.url), Buffer.from(result.data, "base64"));
}
try {
  await send("Page.enable"); await send("Runtime.enable"); await send("Page.navigate", { url });
  for (let i = 0; i < 100; i++) { if (await evaluate("!!globalThis.wildsGame")) break; await delay(100); }
  await evaluate(`(() => {
    const g = wildsGame; g.beginGameFromStart(); g.mobs = []; g.updateSpawner = () => {};
    g.world = { ...g.world, terrainAt: () => Wilds.TERRAIN.GRASS, featureAt: () => Wilds.FEATURE.NONE, isDug: () => false };
    g.player.world = g.world; g.renderer.setWorld(g.world); g.placedObjects.clear(); g.placedObjectTiles.clear(); g.invalidateRooms();
    g.testPlace = (type, x, y) => {
      const before = { x: g.player.x, y: g.player.y };
      g.player.x = (x - 0.5) * 20; g.player.y = (y + 0.5) * 20;
      g.inventory.setSlot("equipment", 0, { itemId: type, count: 1 }); g.selectedSlot = { area: "equipment", index: 0 };
      if (!g.placeSelectedObject(x, y)) throw Error("Cannot place " + type);
      g.player.x = before.x; g.player.y = before.y; g.selectedSlot = null;
    };
    for (const ox of [0, 20]) for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
      if (x === 0 || y === 0 || x === 4 || y === 4) g.testPlace(x === 2 && y === 4 ? "wood_door" : "wall", x + ox, y);
      else { g.testPlace("wood_floor", x + ox, y); g.testPlace("roof", x + ox, y); }
    }
    g.player.x = 50; g.player.y = 50; g.lastPlayerSafe = { x: 50, y: 50 };
    g.inventory.equipment.fill(null); g.inventory.backpack.fill(null); g.renderInventory();
    g.clock.setTimeOfDay(12); g.syncHud(true); return true;
  })()`);
  await delay(200);
  const dark = await evaluate(`(() => {
    const g = wildsGame, data = g.renderer.ctx.getImageData(220*wildsGame.renderer.renderScale,130*wildsGame.renderer.renderScale,1,1).data;
    return { pixel: Array.from(data), room: !!g.closedRoomAtPosition(50, 50), visibleSpawn: g.monsterSpawnAllowed(1,1), unseenSpawn: g.monsterSpawnAllowed(21,1) };
  })()`);
  assert.equal(dark.room, true); assert.equal(dark.visibleSpawn, false); assert.equal(dark.unseenSpawn, true);
  assert.ok(dark.pixel[0] + dark.pixel[1] + dark.pixel[2] > 5 && dark.pixel[0] + dark.pixel[1] + dark.pixel[2] < 180, JSON.stringify(dark));
  const walls=await evaluate(`(()=>{
    const g=wildsGame,r=g.renderer;const render=()=>r.render(g.player,g.elapsed,g.clock.lighting,[],null,[...g.placedObjects.values()],[],[],g.getRoomIndex());
    render();const actual=Array.from(r.ctx.getImageData(200*wildsGame.renderer.renderScale,130*wildsGame.renderer.renderScale,1,1).data);
    const saved=r.drawEnclosedLighting;r.drawEnclosedLighting=()=>{};render();const daylight=Array.from(r.ctx.getImageData(200*wildsGame.renderer.renderScale,130*wildsGame.renderer.renderScale,1,1).data);
    r.drawEnclosedLighting=saved;render();return{actual,daylight,belongs:!!g.getRoomIndex().at(0,2)};
  })()`);
  assert.equal(walls.belongs,true);assert.deepEqual(walls.actual,walls.daylight,"boundary wall must keep outdoor illumination");
  await screenshot("rooms-daytime-dark");
  // Neither indoor nor outdoor lamps may spill across the region boundary.
  await evaluate("wildsGame.clock.setTimeOfDay(0); true"); await delay(100);
  const outdoorBefore = await evaluate("Array.from(wildsGame.renderer.ctx.getImageData(180*wildsGame.renderer.renderScale,150*wildsGame.renderer.renderScale,1,1).data)");
  await evaluate("wildsGame.testPlace('torch',0,2); true"); await delay(150);
  const lit = await evaluate("Array.from(wildsGame.renderer.ctx.getImageData(220*wildsGame.renderer.renderScale,130*wildsGame.renderer.renderScale,1,1).data)");
  assert.ok(lit[0] + lit[1] + lit[2] > 40, JSON.stringify(lit));
  const outdoorAfter = await evaluate("Array.from(wildsGame.renderer.ctx.getImageData(180*wildsGame.renderer.renderScale,150*wildsGame.renderer.renderScale,1,1).data)");
  assert.deepEqual(outdoorAfter, outdoorBefore, "indoor torch must not light outdoors");
  const insideBefore = await evaluate("Array.from(wildsGame.renderer.ctx.getImageData(260*wildsGame.renderer.renderScale,130*wildsGame.renderer.renderScale,1,1).data)");
  await evaluate("wildsGame.testPlace('torch',-1,1); true"); await delay(100);
  const insideAfter = await evaluate("Array.from(wildsGame.renderer.ctx.getImageData(260*wildsGame.renderer.renderScale,130*wildsGame.renderer.renderScale,1,1).data)");
  assert.ok(insideAfter.slice(0,3).every((v,i)=>Math.abs(v-insideBefore[i])<5), "outdoor torch must not light indoors");
  await evaluate("wildsGame.clock.setTimeOfDay(12); true"); await delay(100);
  await screenshot("rooms-daytime-torch");
  const aggro = await evaluate(`(() => {
    const g = wildsGame; g.player.x = 50; g.player.y = 130;
    const zombie = g.spawnMob("zombie",1,1); g.updateMobs(0.01,performance.now());
    const cross = zombie.aggro;
    g.player.y = 50; g.updateMobs(0.01,performance.now()); g.updateAudio(performance.now());
    return { cross, same: zombie.aggro, scene: g.audio.scene };
  })()`);
  assert.deepEqual(aggro, { cross: false, same: true, scene: "combat" });
  const exposed = await evaluate(`(() => {
    const g = wildsGame; g.player.x = 50; g.player.y = 70; g.lastPlayerSafe = {x:50,y:70};
    g.openPlacedObject(2,4); const before = g.mobs[0].health; g.applyDaylightDamage(0.1);
    return { closed: !!g.closedRoomAtPosition(50,50), damage: before - g.mobs[0].health };
  })()`);
  assert.equal(exposed.closed, false); assert.equal(exposed.damage, 1);
  await delay(100); await screenshot("rooms-door-open-daylight");
  const causes = await evaluate(`(() => {
    const g = wildsGame, result = [];
    const reset = () => { g.closeDeath(); g.player.reset(g.world); g.mobs=[]; };
    reset(); g.player.satiety=0; g.player.health=0.5; g.player.updateVitals(1); g.die(); result.push(g.deathTitle.textContent);
    reset(); g.player.health=1; g.damagePlayer(2,{name:"测试新怪物"}); g.die(); result.push(g.deathTitle.textContent);
    reset(); g.player.health=1; g.player.applyPoison(20,1,{name:"测试新毒食物"}); g.player.updateEffects(0.1); g.die(); result.push(g.deathTitle.textContent);
    return result;
  })()`);
  assert.deepEqual(causes,["你饿死了","你被【测试新怪物】击败了","你吃【测试新毒食物】食物中毒死了"]);
  assert.equal(await evaluate("document.getElementById('deathReason') === null"),true);
  await screenshot("death-food-reason");
  assert.deepEqual(errors, []);
  console.log("Browser room/death checks passed: night-level indoor darkness and two-way light isolation, torch light, spawn visibility, aggro, daytime combat music, door exposure and automatic death reasons.");
} finally { ws.close(); }
