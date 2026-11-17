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
 await send("Page.enable");await send("Runtime.enable");await send("Page.navigate",{url});
 for(let i=0;i<100;i++){if(await evaluate("!!globalThis.wildsGame"))break;await delay(100);}
 await evaluate(`(()=>{const g=wildsGame;g.beginGameFromStart();g.player.health=100000;g.profile={};g.inputLags=[];
 const wrap=(object,name)=>{const original=object[name];object[name]=function(...args){const start=performance.now();try{return original.apply(this,args);}finally{const elapsed=performance.now()-start;const p=g.profile[name]||={calls:0,total:0,max:0};p.calls++;p.total+=elapsed;p.max=Math.max(p.max,elapsed);}};};
 for(const name of ['updateFarming','updateMobs','updateSpawner','findMobSpawnTile','updateProjectiles','enforceGroundObstacleInvariant','findNearestUnblockedPosition','drawMinimap','updateHolyGun'])wrap(g,name);
 for(const name of ['render','drawTile','drawTree','drawPlacedObjects','drawOccludedFixtures','drawMobsWithOcclusion','drawRoofs','drawLighting','drawEnclosedLighting','drawFarming'])wrap(g.renderer,name);
 document.addEventListener('keyup',e=>g.inputLags.push(performance.now()-e.timeStamp));
 })()`);
 for(const hour of [12,22]) {
  await evaluate(`wildsGame.clock.setTimeOfDay(${hour});wildsGame.profile={}`);await delay(2500);
  await send("Input.dispatchKeyEvent",{type:"keyDown",code:"KeyA",key:"a"});await delay(100);
  await send("Input.dispatchKeyEvent",{type:"keyUp",code:"KeyA",key:"a"});await delay(100);
  const stopped=await evaluate("wildsGame.player.x");await delay(100);assert.equal(await evaluate("wildsGame.player.x"),stopped);
  console.log(JSON.stringify(await evaluate(`({hour:${hour},mobs:wildsGame.mobs.length,objects:wildsGame.placedObjects.size,profile:wildsGame.profile,input:wildsGame.inputLags})`)));
 }
 const audioResult=await evaluate(`(async()=>{
 const a=Object.create(Wilds.AudioDirector.prototype);a.ctx=new AudioContext();await a.ctx.resume();
 a.musicGain=a.ctx.createGain();a.musicGain.gain.value=0;a.musicGain.connect(a.ctx.destination);a.sfxGain=a.musicGain;a.drumGain=a.musicGain;a.master=a.musicGain;a.muted=false;a.actionSounds={};
 a.noiseBuffer=a.ctx.createBuffer(1,4800,a.ctx.sampleRate);const now=a.ctx.currentTime;
 a.note(220,now,.1,'sine',.1,{fat:true});a.stringNote(220,now,.3,.1,0,'lead');a.pianoNote(220,now,.2,.1,0,'lead');a.malletNote(220,now,.2,.1,0,'lead');
 a.actionTone(220,.1,'sine',.1);a.noiseBurst(now,.1,.1,500);a.playWaterFlow();
 const peak=a.activeAudioNodes;for(let i=0;i<40&&a.activeAudioNodes;i++)await new Promise(resolve=>setTimeout(resolve,100));
 const remaining=a.activeAudioNodes;await a.ctx.close();return {peak,remaining};})()`);
 assert(audioResult.peak>20);assert.equal(audioResult.remaining,0,'Finished voices must release all their temporary audio nodes');
 const reloadStart=Date.now();await send('Page.reload',{ignoreCache:true});let reloaded=false;
 for(let i=0;i<100;i++){if(await evaluate('!!globalThis.wildsGame && !wildsGame.started')){reloaded=true;break;}await delay(50);}
 assert(reloaded,'Local page must reload and return to the start screen');
 console.log(JSON.stringify({audio:audioResult,reloadMs:Date.now()-reloadStart}));assert.deepEqual(errors,[]);
} finally {ws.close();}
