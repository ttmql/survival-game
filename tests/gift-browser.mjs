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
 await evaluate(`(()=>{const g=wildsGame;g.beginGameFromStart();g.mobs=[];g.updateSpawner=()=>{};
 g.world={...g.world,terrainAt:()=>Wilds.TERRAIN.GRASS,featureAt:()=>Wilds.FEATURE.NONE};g.player.world=g.world;g.renderer.setWorld(g.world);
 g.placedObjects.clear();g.placedObjectTiles.clear();g.invalidateRooms();g.player.x=10;g.player.y=10;g.lastPlayerSafe={x:10,y:10};g.clock.setTimeOfDay(12);
 g.inventory.equipment.fill(null);g.inventory.backpack.fill(null);g.inventory.addItem("blg_gift_box",2);g.selectedSlot={area:"equipment",index:0};g.renderInventory();return true;})()`);
 await delay(750);await evaluate("wildsGame.renderer.blgImage.decode().then(()=>true)");
 const point=await evaluate(`(()=>{const g=wildsGame,r=g.canvas.getBoundingClientRect(),scale=Math.max(r.width/480,r.height/300);return{x:r.left+300*scale-(480*scale-r.width)/2,y:r.top+150*scale-(300*scale-r.height)/2};})()`);
 await send("Input.dispatchMouseEvent",{type:"mouseMoved",...point});await delay(100);
 assert.equal(await evaluate("wildsGame.renderTarget().valid"),true);await screenshot("blg-gift-preview-valid");
 await evaluate(`(()=>{const g=wildsGame,o={id:999,type:"torch",itemId:"torch",tx:6,ty:0,tiles:[{tx:6,ty:0}],storageKey:"6,0:torch"};g.placedObjects.set(o.storageKey,o);g.placedObjectTiles.set("6,0",new Set([o]));return true;})()`);await delay(100);
 assert.equal(await evaluate("wildsGame.renderTarget().valid"),false);await screenshot("blg-gift-preview-invalid");
 await send("Input.dispatchMouseEvent",{type:"mousePressed",button:"left",clickCount:1,...point});await send("Input.dispatchMouseEvent",{type:"mouseReleased",button:"left",clickCount:1,...point});assert.equal(await evaluate("wildsGame.inventory.countItem('blg_gift_box')"),2);
 await evaluate("wildsGame.placedObjects.clear();wildsGame.placedObjectTiles.clear();true");
 await send("Input.dispatchMouseEvent",{type:"mousePressed",button:"left",clickCount:1,...point});await send("Input.dispatchMouseEvent",{type:"mouseReleased",button:"left",clickCount:1,...point});
 assert.equal(await evaluate("wildsGame.inventory.countItem('blg_gift_box')"),1);
 await send("Input.dispatchMouseEvent",{type:"mouseMoved",x:20,y:20});await delay(900);await screenshot("blg-gift-circle");
 assert.equal(await evaluate("wildsGame.giftEffects.length"),1);assert.equal(await evaluate("wildsGame.giftEffects[0].radius"),60);assert.equal(await evaluate("wildsGame.audio.actionSounds.giftLand"),1);await delay(4900);assert.equal(await evaluate("wildsGame.giftEffects.length"),0);
 assert.deepEqual(errors,[]);console.log("Gift browser checks passed: original logo, valid/invalid hover, one-item consumption, landing and five-second expiry.");
}finally{ws.close();}
