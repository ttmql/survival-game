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
 const target=new URL(url);target.searchParams.set("seed","123456");
 await send("Page.enable");await send("Runtime.enable");await send("Page.navigate",{url:target.href});
 for(let i=0;i<100;i++){if(await evaluate("!!globalThis.wildsGame"))break;await delay(100);}
 const info=await evaluate(`(()=>{const g=wildsGame;g.beginGameFromStart();return{debug:g.world.isDebugMap,seed:g.seedText,chests:[...g.placedObjects.values()].filter(o=>o.storage).length};})()`);
 assert.equal(info.debug,true);assert.equal(info.seed,"123456");assert.ok(info.chests>=24);await delay(700);await screenshot("debug-map-spawn");
 async function space(){await send("Input.dispatchKeyEvent",{type:"keyDown",code:"Space",key:" ",windowsVirtualKeyCode:32});await send("Input.dispatchKeyEvent",{type:"keyUp",code:"Space",key:" ",windowsVirtualKeyCode:32});}
 await space();const frozen=await evaluate("({paused:wildsGame.paused,time:wildsGame.clock.time,elapsed:wildsGame.elapsed})");assert.equal(frozen.paused,true);
 await delay(350);assert.equal(await evaluate("wildsGame.clock.time"),frozen.time);assert.equal(await evaluate("wildsGame.elapsed"),frozen.elapsed);assert.equal(await evaluate("document.getElementById('pauseOverlay').hidden"),false);
 await screenshot("game-space-pause");await space();await delay(150);assert.equal(await evaluate("wildsGame.paused"),false);assert.ok(await evaluate("wildsGame.clock.time")>frozen.time);
 await evaluate("wildsGame.clock.setTimeOfDay(22);wildsGame.trySleep();true");await delay(100);await space();await delay(350);
 assert.equal(await evaluate("wildsGame.sleeping && wildsGame.paused"),true);
 await space();await delay(100);assert.equal(await evaluate("wildsGame.sleeping && !wildsGame.paused"),true);
 await evaluate("wildsGame.closeSleep();true");
 const supplies=await evaluate(`(()=>{const g=wildsGame;const chests=[...g.placedObjects.values()].filter(o=>o.storage);return Object.values(Wilds.ITEMS).every(item=>{const stacks=chests.flatMap(c=>c.storage).filter(s=>s?.itemId===item.id);return g.inventory.maxStackFor(item.id)===1?stacks.length===3&&stacks.every(s=>s.count===1):stacks.reduce((n,s)=>n+s.count,0)===64;});})()`);
 assert.equal(supplies,true);await evaluate("wildsGame.openMap();true");await screenshot("debug-map-layout");assert.deepEqual(errors,[]);
 console.log("Debug browser checks passed: seed, catalogue supplies, space pause, frozen simulation and resume.");
}finally{ws.close();}
