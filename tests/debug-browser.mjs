// Real-browser scene and rendering checks. Run using run-browser-test.ps1 -CheckScript debug-browser.mjs.
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
  await writeFile(new URL(`../screenshots/browser-${name}.png`, import.meta.url), Buffer.from(result.data, "base64"));
}
try {
 const target=new URL(url);target.searchParams.set("seed","123456");
 await send("Page.enable");await send("Runtime.enable");await send("Page.navigate",{url:target.href});
 for(let i=0;i<100;i++){if(await evaluate("!!globalThis.wildsGame"))break;await delay(100);}
 const info=await evaluate(`(()=>{const g=wildsGame;g.beginGameFromStart();return{debug:g.world.isDebugMap,seed:g.seedText,chests:[...g.placedObjects.values()].filter(o=>o.storage).length};})()`);
 assert.equal(info.debug,undefined);assert.equal(info.seed,"123456");assert.equal(info.chests,0);await delay(700);await screenshot("debug-map-spawn");
 async function space(){await send("Input.dispatchKeyEvent",{type:"keyDown",code:"Space",key:" ",windowsVirtualKeyCode:32});await send("Input.dispatchKeyEvent",{type:"keyUp",code:"Space",key:" ",windowsVirtualKeyCode:32});}
 await space();const frozen=await evaluate("({paused:wildsGame.paused,time:wildsGame.clock.time,elapsed:wildsGame.elapsed})");assert.equal(frozen.paused,true);
 await delay(350);assert.equal(await evaluate("wildsGame.clock.time"),frozen.time);assert.equal(await evaluate("wildsGame.elapsed"),frozen.elapsed);assert.equal(await evaluate("document.getElementById('pauseOverlay').hidden"),false);
 await screenshot("game-space-pause");await space();await delay(150);assert.equal(await evaluate("wildsGame.paused"),false);assert.ok(await evaluate("wildsGame.clock.time")>frozen.time);
 await evaluate("wildsGame.firstNightLucianSpawned=true;wildsGame.clock.setTimeOfDay(22);wildsGame.trySleep();true");await delay(100);await space();await delay(350);
 assert.equal(await evaluate("wildsGame.sleeping && wildsGame.paused"),true);
 await space();await delay(100);assert.equal(await evaluate("wildsGame.sleeping && !wildsGame.paused"),true);
 await evaluate("wildsGame.closeSleep();true");
 await evaluate("wildsGame.openMap();true");await screenshot("debug-map-layout");assert.deepEqual(errors,[]);

 await send('Page.navigate', { url: target.href });
 for (let i = 0; i < 100; i++) {
   if (await evaluate('!!globalThis.wildsGame && !wildsGame.started')) break;
   await delay(100);
 }
 const inspectTestMap = mode => evaluate(`(() => {
   const g = wildsGame;
   if (g.started) g.returnToStart();
   document.querySelector('input[name="gameMode"][value="${mode}"]').click();
   document.getElementById('seedInput').value = '12345678';
   document.getElementById('startGameBtn').click();
   const door = g.placedObjectAt(6, 3);
   const room = g.getRoomIndex().at(6, 5);
   return {
     mode: g.gameMode, seed: g.seedText, spawn: [g.player.tileX, g.player.tileY],
     hour: g.clock.hours, rooms: g.getRoomIndex().closedRooms.length,
     fixtures: g.placedObjects.size, crops: g.farm.size,
     accessibleSpawn: !g.isGroundBlockedForCreature(1, 1),
     closedDoor: door.type === 'wood_door' && !door.open && !!room,
     perimeterRoofFree: [...g.placedObjects.values()]
       .filter(o => o.type === 'wall' || o.type === 'wood_door')
       .every(o => !g.objectsAt(o.tx, o.ty).some(layer => layer.type === 'roof')),
     riceShallow: [...g.farm.values()].filter(p => p.crop === 'rice').every(p => g.world.waterDepthAt(p.tx, p.ty) === 1),
     normalInventory: g.isCreative() ? g.inventory.equipment.every(s => !s) : g.inventory.equipment[1]?.itemId === 'creation_scroll',
   };
 })()`);

 const survival = await inspectTestMap('survival');
 assert.deepEqual(survival, {
   mode: 'survival', seed: '12345678', spawn: [1, 1], hour: 12,
   rooms: 18, fixtures: 2556, crops: 1062,
   accessibleSpawn: true, closedDoor: true, perimeterRoofFree: true, riceShallow: true, normalInventory: true,
 });
 await delay(400);
 await screenshot('test-map-spawn');
 const x = await evaluate('wildsGame.player.x');
 await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyA', key: 'a' });
 await delay(250);
 await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyA', key: 'a' });
 assert.ok(await evaluate('wildsGame.player.x') < x, 'The main street is walkable from spawn');

 assert.ok(await evaluate(`(() => {
   const g = wildsGame, size = Wilds.CONFIG.TILE_SIZE;
   g.player.x = (6 + 0.5) * size;
   g.player.y = (2 + 0.5) * size;
   g.lastPlayerSafe = { x: g.player.x, y: g.player.y };
   return g.openPlacedObject(6, 3);
 })()`), 'The test house can be opened');
 await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyS', key: 's' });
 let enteredHouse = false;
 for (let i = 0; i < 30 && !enteredHouse; i++) {
   await delay(100);
   enteredHouse = await evaluate('wildsGame.player.tileY >= 4');
 }
 await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyS', key: 's' });
 assert.ok(enteredHouse, 'The player can walk inside the test house');

 const creative = await inspectTestMap('creative');
 assert.deepEqual(creative, { ...survival, mode: 'creative' });
 await evaluate("wildsGame.returnToStart();document.getElementById('seedInput').value='123456';document.getElementById('startGameBtn').click();true");
 assert.equal(await evaluate('wildsGame.placedObjects.size'), 0, 'Ordinary seeds still open the procedural world');
 assert.deepEqual(errors, []);
 console.log('Browser checks passed for the ordinary seed, pause, and the shared test map in both modes.');
}finally{ws.close();}
