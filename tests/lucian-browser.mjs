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
 g.world={...g.world,terrainAt:()=>Wilds.TERRAIN.GRASS,featureAt:()=>Wilds.FEATURE.NONE,waterDepthAt:()=>0};g.player.world=g.world;g.renderer.setWorld(g.world);g.placedObjects.clear();g.placedObjectTiles.clear();g.invalidateRooms();
 g.player.x=10;g.player.y=10;g.lastPlayerSafe={x:10,y:10};g.clock.setTimeOfDay(22);g.player.health=10000;g.firstNightLucianSpawned=true;
 const m=g.spawnMob('dark_lucian',6,0);m.cullingCooldown=0;g.updateCulling(m,0);return true;})()`);
 await delay(700);await screenshot('dark-lucian-culling');
 assert.equal(await evaluate("wildsGame.mobs.some(m=>m.type==='dark_lucian'&&m.maxHealth===100)"),true);
 assert.equal(await evaluate("wildsGame.projectiles.some(p=>p.type==='culling_bullet'&&p.skill==='culling'&&p.damage===10)"),true);
 await evaluate(`(()=>{const g=wildsGame;g.mobs=[];g.projectiles=[];g.inventory.equipment[0]={itemId:'lucian_holy_gun',count:1,durability:5};g.selectedSlot={area:'equipment',index:0};const r=g.canvas.getBoundingClientRect();g.pointerInside=true;g.pointerClientX=r.left+r.width*.75;g.pointerClientY=r.top+r.height*.5;g.renderInventory();return true;})()`);
 await send('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyR',key:'r'});await send('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyR',key:'r'});
 await delay(1200);
 assert.equal(await evaluate("wildsGame.inventory.equipment[0].durability"),4);
 assert.equal(await evaluate("wildsGame.projectiles.some(p=>p.type==='culling_bullet'&&p.owner==='player')"),true);
 assert.equal(await evaluate("wildsGame.inventoryButtons.equipment[0].querySelector('.skill-durability').textContent"),'4/5');
 assert.equal(await evaluate("wildsGame.inventoryButtons.equipment[0].querySelector('.skill-cooldown').textContent.includes('s')"),true);
 await screenshot('holy-gun-cooldown');
 assert.equal(await evaluate('wildsGame.canvas.width'),480);assert.equal(await evaluate('wildsGame.canvas.height'),300);
 assert.equal(await evaluate('wildsGame.renderer.projectileCanvas.width'),1440);
 assert.equal(await evaluate("getComputedStyle(wildsGame.renderer.projectileCanvas).pointerEvents"),'none');
 await evaluate(`(()=>{const g=wildsGame;g.holyGunCasts=[];g.projectiles=[];g.mobs=[];g.inventory.equipment[7]={itemId:'wall',count:1};g.selectedSlot={area:'equipment',index:7};g.placeSelectedObject(2,0);return true;})()`);
 const masked=await evaluate(`(()=>{const g=wildsGame,r=g.renderer,p=[{type:'culling_bullet',owner:'player',x:50,y:10,vx:270,vy:0}];
 const render=objects=>r.render(g.player,g.elapsed,{darkness:0,warm:0},[],null,objects,[],p,null);
 render([]);const visible=r.projectileCanvas.getContext('2d').getImageData(280*3,150*3,1,1).data[3];
 render([...g.placedObjects.values()]);const blocked=r.projectileCanvas.getContext('2d').getImageData(280*3,150*3,1,1).data[3];
 return {visible,blocked};})()`);
 assert(masked.visible>0);assert.equal(masked.blocked,0);
 await send('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyA',key:'a'});await delay(150);
 await send('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyA',key:'a'});await delay(60);
 const stoppedX=await evaluate('wildsGame.player.x');await delay(150);assert.equal(await evaluate('wildsGame.player.x'),stoppedX);
 assert.equal(await evaluate('wildsGame.renderer.projectileCanvas.hidden'),true);
 assert.deepEqual(errors,[]);console.log('Lucian browser check passed: blue projectiles, R activation, durability and cooldown UI.');
}finally{ws.close();}
