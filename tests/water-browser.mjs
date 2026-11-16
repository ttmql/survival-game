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
 await evaluate(`(()=>{
 const g=wildsGame;g.beginGameFromStart();g.mobs=[];g.updateSpawner=()=>{};const dug=new Set();
 g.world={...g.world,terrainAt:(x,y)=>x<2?Wilds.TERRAIN.GRASS:Wilds.TERRAIN.OCEAN,waterDepthAt:(x,y)=>x<2?0:x<4?1:2,featureAt:(x,y)=>x===6&&y===0?Wilds.FEATURE.SILICA:Wilds.FEATURE.NONE,isDug:(x,y)=>dug.has(x+","+y),markDug:(x,y)=>dug.add(x+","+y)};
 g.player.world=g.world;g.renderer.setWorld(g.world);g.player.x=50;g.player.y=30;g.lastPlayerSafe={x:50,y:30};g.clock.setTimeOfDay(12);
 g.player.updateVitals(1);g.syncHud(true);return true;
 })()`);
 await delay(150);assert.equal(await evaluate("wildsGame.player.isWading"),true);
 await screenshot("water-shallow-deep");
 const result=await evaluate(`(()=>{
 const g=wildsGame;g.player.x=90;g.player.oxygen=10;g.player.updateVitals(1);const deep=g.player.oxygen;
 g.player.x=50;g.player.updateVitals(1);const shallow=g.player.oxygen;
 g.inventory.equipment.fill(null);g.inventory.backpack.fill(null);g.inventory.addItem("glass_bottle",1);
 const filled=g.fillWaterBottle(2,1),bottles=g.inventory.countItem("water_bottle"),fillSound=g.audio.actionSounds.fillWater;
 g.furnaceObject={fuel:1};g.inventory.setSlot("equipment",0,{itemId:"fine_sand",count:1});const before=g.audio.actionSounds.craftSuccess;g.useFurnaceSlot("equipment",0);const glass=g.inventory.countItem("glass"),smeltSound=g.audio.actionSounds.craftSuccess>before;
 g.furnaceObject=null;
 const add=(type,x,y)=>{g.player.x=(x-1+0.5)*20;g.player.y=(y+0.5)*20;g.inventory.setSlot("equipment",0,{itemId:type,count:1});g.selectedSlot={area:"equipment",index:0};if(!g.placeSelectedObject(x,y))throw Error(type);};
 for(let x=2;x<=6;x++)add("driftwood",x,2);add("wall",5,2);add("torch",5,2);add("roof",5,2);
 g.player.x=70;g.player.y=50;g.lastPlayerSafe={x:70,y:50};g.player.updateVitals(1);g.selectedSlot=null;g.renderInventory();
 g.spawnMob("pig",4,2);g.updateMobs=()=>{};
 return {deep,shallow,filled,bottles,fillSound,glass,smeltSound,supported:!g.player.isDiving&&!g.player.isWading,animalDeck:g.mobCanOccupy(90,50),animalWater:g.mobCanOccupy(90,30)};
 })()`);
 assert.equal(result.deep,9);assert.equal(result.shallow,10);assert.equal(result.filled,true);assert.equal(result.bottles,1);assert.ok(result.fillSound>0);assert.equal(result.glass,1);assert.equal(result.smeltSound,true);assert.equal(result.supported,true);assert.equal(result.animalDeck,true);assert.equal(result.animalWater,false);
 await delay(150);await screenshot("water-driftwood-buildings");
 await evaluate(`(()=>{const g=wildsGame;g.spawnMob("small_fish",5,0);g.spawnMob("small_fish",6,1);g.spawnMob("shark",7,1);g.player.satiety=50;g.inventory.equipment.fill(null);g.inventory.addItem("animal_manure",1);g.eatFood("equipment",0);g.syncVitals(true);return true;})()`);
 await delay(120);assert.equal(await evaluate("wildsGame.player.manureDietHours>23"),true);
 assert.equal(await evaluate("document.getElementById('foodRestriction').hidden"),false);
 await evaluate("wildsGame.inventory.addItem('deep_sea_gills',1);wildsGame.spawnDrop('deep_sea_gills',1,4,3);wildsGame.renderInventory();true");
 await delay(100);
 await screenshot("water-fish-shark-diet");
const flow=await evaluate(`(async()=>{
 const ctx=new OfflineAudioContext(1,22050,22050),director=Object.create(Wilds.AudioDirector.prototype);
 director.ctx=ctx;director.muted=false;director.master=ctx.destination;
 director.noiseBuffer=ctx.createBuffer(1,22050,22050);const input=director.noiseBuffer.getChannelData(0);
 for(let i=0;i<input.length;i++)input[i]=Math.sin(i*1.73)*0.6+Math.sin(i*0.39)*0.3;
 director.playWaterFlow();const rendered=await ctx.startRendering();const data=rendered.getChannelData(0);
 return {peak:Math.max(...data.map(Math.abs)),onset:Math.abs(data[0])};
 })()`);
 assert.ok(flow.peak>0&&flow.peak<0.04&&flow.onset<0.001,"flow must have a soft, quiet envelope");
 assert.deepEqual(errors,[]);
 console.log("Water browser checks passed: depth visuals, oxygen, bottle collection, smelting sound, float support and creature collisions.");
}finally{ws.close();}
