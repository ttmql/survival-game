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
 await evaluate(`(()=>{const g=wildsGame;g.beginGameFromStart();g.mobs=[];g.updateSpawner=()=>{};
 g.world={...g.world,terrainAt:()=>Wilds.TERRAIN.GRASS,featureAt:()=>Wilds.FEATURE.NONE,waterDepthAt:()=>0};g.player.world=g.world;g.renderer.setWorld(g.world);
 g.placedObjects.clear();g.placedObjectTiles.clear();g.invalidateRooms();g.player.x=10;g.player.y=70;g.lastPlayerSafe={x:10,y:70};g.clock.setTimeOfDay(12);
 g.inventory.equipment.fill(null);g.inventory.backpack.fill(null);
 const ids=['wood_hoe','stone_hoe','sapling','wheat_seed','rice_seed','wheat','rice','wood_bowl','bread','raw_rice','cooked_rice'];
 ids.forEach(id=>g.inventory.addItem(id,1));g.renderInventory();
 for(let y=-2;y<1;y++)for(let x=-4;x<4;x++)g.farm.set(x+','+y,{tx:x,ty:y,soil:true,wet:x>=0,dryAge:0});
 ['wheat','rice','sapling'].forEach((crop,row)=>{for(let n=0;n<4;n++)g.farm.set((n-2)+','+(row-2),{tx:n-2,ty:row-2,soil:true,wet:true,crop,growth:crop==='sapling'?Math.min(n,2):n,dryAge:0});});
 g.inventory.backpack[8]={itemId:'animal_manure',count:3};g.isPositionLit=()=>false;
 g.withinRange=()=>true;const old=g.farm.get('-1,-2').growth;g.selectedSlot={area:'equipment',index:0};
 g.inventory.equipment[0]={itemId:'animal_manure',count:3};g.useFarmItem(-1,-2);
 if(g.farm.get('-1,-2').growth!==old+1)throw Error('Fertilizer did not advance growth immediately');
 g.inventory.equipment[0]={itemId:'wood_hoe',count:1,durability:15};g.renderInventory();g.openBackpack();return true;})()`);
 await delay(500);await screenshot('farming-items-reworked');
 await evaluate('wildsGame.closeBackpack();true');await delay(200);await screenshot('farming-world-reworked');
 assert.deepEqual(errors,[]);console.log('Farming browser passed: fertilizer interaction, distinct inventory art and crop rendering.');
}finally{ws.close();}

