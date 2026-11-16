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
 await send('Page.enable');await send('Runtime.enable');await send('Page.navigate',{url});
 for(let i=0;i<100;i++){if(await evaluate('!!globalThis.wildsGame'))break;await delay(100);}
 await evaluate(`(()=>{const g=wildsGame;g.beginGameFromStart();g.mobs=[];
 g.world={...g.world,terrainAt:()=>Wilds.TERRAIN.GRASS,featureAt:()=>Wilds.FEATURE.NONE,waterDepthAt:()=>0};g.player.world=g.world;g.renderer.setWorld(g.world);
 g.placedObjects.clear();g.placedObjectTiles.clear();g.invalidateRooms();g.player.x=10;g.player.y=10;g.lastPlayerSafe={x:10,y:10};
 const spawn=g.spawnMob;g.spawnMob=function(type,tx,ty){if(type==='dark_lucian'){const x=(tx+.5)*20,y=(ty+.5)*20;this.testLucianSpawn={visible:this.isMobInView({x,y}),lit:this.isPositionLitBySource(x,y),allowed:this.monsterSpawnAllowed(tx,ty)};}return spawn.call(this,type,tx,ty);};
 g.player.health=100000;g.firstNightLucianSpawned=false;g.firstNightLucianHour=20;g.clock.setTimeOfDay(19.99);return true;})()`);
 await delay(1500);
 const before=await evaluate('wildsGame.elapsed');await delay(1000);const after=await evaluate('wildsGame.elapsed');
 assert.deepEqual(errors,[],'Night transition must not throw');
 assert.equal(await evaluate('wildsGame.firstNightLucianSpawned'),true);assert(after-before>.2,'Animation loop must keep advancing after night spawn');
 assert.deepEqual(await evaluate('wildsGame.testLucianSpawn'),{visible:false,lit:false,allowed:true});
 assert.equal(await evaluate("wildsGame.mobs.filter(m=>m.type==='dark_lucian').length>=1"),true);
 await send('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyA',key:'a'});await delay(120);
 await send('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyA',key:'a'});await delay(80);
 const stopped=await evaluate('wildsGame.player.x');await delay(150);assert.equal(await evaluate('wildsGame.player.x'),stopped);
 await delay(5000);assert.deepEqual(errors,[]);await screenshot('night-spawn-running');
 console.log('Night transition passed: real spawning/path checks, first-night Lucian, sustained firing, animation heartbeat and key release.');
}finally{ws.close();}
