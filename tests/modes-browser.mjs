import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const port=Number(process.argv[2]),url=process.argv[3],delay=ms=>new Promise(r=>setTimeout(r,ms));
let targets;
for(let i=0;i<60;i++){try{targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();break;}catch{await delay(200);}}
assert(targets?.some(t=>t.type==='page'),'Browser debugging endpoint did not start');
const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let seq=0;const pending=new Map(),errors=[];
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
 if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}});
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
async function click(selector){
 const p=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Missing target');el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',...p});await send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});
}
async function key(code,key){await send('Input.dispatchKeyEvent',{type:'keyDown',code,key});await send('Input.dispatchKeyEvent',{type:'keyUp',code,key});}
async function shot(name){const r=await send('Page.captureScreenshot',{format:'png'});await writeFile(new URL(`../screenshots/browser-${name}.png`,import.meta.url),Buffer.from(r.data,'base64'));}
try{
 await send('Page.enable');await send('Runtime.enable');await send('Page.navigate',{url});
 for(let i=0;i<100;i++){if(await evaluate('!!globalThis.wildsGame'))break;await delay(100);}
 await shot('mode-start');await click('input[name="gameMode"][value="creative"]');
 await evaluate('document.getElementById("seedInput").value="123456"');await click('#startGameBtn');
 const initial=await evaluate(`(()=>{const g=wildsGame;g.updateSpawner=()=>{};g.spawnFirstNightLucian=()=>false;return{creative:g.isCreative(),seed:g.seedText,empty:g.inventory.equipment.every(s=>s===null),backpack:g.inventory.backpack.every(s=>s===null),fixtures:g.placedObjects.size,debug:!!g.world.isDebugMap,vitals:document.getElementById('vitalsPanel').hidden};})()`);
 assert.deepEqual(initial,{creative:true,seed:'123456',empty:true,backpack:true,fixtures:0,debug:false,vitals:true});
 await evaluate(`(()=>{const g=wildsGame;g.world.terrainAt=()=>Wilds.TERRAIN.GRASS;g.world.featureAt=()=>Wilds.FEATURE.NONE;g.world.waterDepthAt=()=>0;g.player.x=10;g.player.y=10;g.lastPlayerSafe={x:10,y:10};})()`);
 await click('#bagButton');assert.equal(await evaluate('document.getElementById("backpackTitle").textContent'),'全部物品');
 assert(await evaluate('document.getElementById("backpackGrid").hidden'));
 await click('#creativeItemGrid [data-item="wood_axe"]');await click('#hotbar [data-index="3"]');
 assert.equal(await evaluate('wildsGame.inventory.equipment[3].count'),1);
 assert((await evaluate("document.querySelectorAll('#hotbar .inv-slot')[3].textContent")).includes('∞'));
 await click('#creativeCategories [data-category="materials"]');await click('#creativeItemGrid [data-item="wood"]');await click('#hotbar [data-index="4"]');
 assert.equal(await evaluate('wildsGame.inventory.equipment[4].count'),64);await shot('creative-catalogue');
 await click('#closeBackpack');await key('KeyF','f');assert(await evaluate('wildsGame.player.fastTravel'));
 await send('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyD',key:'d'});await delay(180);
 const speed=await evaluate('wildsGame.player.speed');assert.equal(speed,await evaluate('Wilds.CONFIG.PLAYER_SPEED*5'));
 await send('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyD',key:'d'});await key('KeyF','f');assert(!await evaluate('wildsGame.player.fastTravel'));
 await click('#switchGameMode');
 assert.deepEqual(await evaluate('({mode:wildsGame.gameMode,creative:wildsGame.player.creative,vitals:document.getElementById("vitalsPanel").hidden})'),{mode:'survival',creative:false,vitals:false});
 await evaluate('wildsGame.inventory.setSlot("backpack",0,{itemId:"rock",count:7});wildsGame.player.takeDamage(10)');assert.equal(await evaluate('wildsGame.player.health'),90);
 await click('#switchGameMode');assert.equal(await evaluate('wildsGame.inventory.backpack[0].count'),7);assert.equal(await evaluate('wildsGame.player.health'),100);
 await click('#switchGameMode');assert.equal(await evaluate('wildsGame.inventory.backpack[0].count'),7);
 await evaluate('wildsGame.player.takeDamage(100);wildsGame.die()');assert(await evaluate('wildsGame.isDead'));
 await click('#returnCreativeAfterDeath');assert(await evaluate('!wildsGame.isDead && wildsGame.isCreative()'));await shot('creative-game');
 const melee=await evaluate(`(()=>{const g=wildsGame;g.clock.setTimeOfDay(22);g.player.x=10;g.player.y=10;g.lastPlayerSafe={x:10,y:10};g.mobs=[];
   g.inventory.equipment.fill(null);g.selectedSlot={area:'equipment',index:0};g.syncHeldStats();g.renderInventory();g.nextAttackAt=0;
   g.testEnderman=g.spawnMob('enderman',2,0);g.testEnderman.speed=0;
   const r=g.canvas.getBoundingClientRect(),s=Math.max(r.width/480,r.height/300);
   return{x:r.left+280*s-(480*s-r.width)/2,y:r.top+124*s-(300*s-r.height)/2};})()`);
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',...melee});await delay(100);
 assert(!await evaluate('wildsGame.testEnderman.provoked'));
 await send('Input.dispatchMouseEvent',{type:'mousePressed',...melee,button:'left',clickCount:1});
 await send('Input.dispatchMouseEvent',{type:'mouseReleased',...melee,button:'left',clickCount:1});
 assert.deepEqual(await evaluate('({health:wildsGame.testEnderman.health,aggro:wildsGame.testEnderman.aggro,provoked:wildsGame.testEnderman.provoked})'),{health:85,aggro:false,provoked:false});
 const pickup=await evaluate(`(()=>{const g=wildsGame;g.inventory.backpack.fill(null);g.drops=[];
   for(let n=0;n<8;n++)g.inventory.setSlot('equipment',n,{itemId:'wood',count:64});
   g.spawnDrop('rock',3,g.player.tileX,g.player.tileY);g.drops[0].armed=true;g.collectNearbyDrops(performance.now());
   return {drops:g.drops.length,item:g.inventory.backpack[0].itemId,count:g.inventory.backpack[0].count,hidden:document.getElementById('backpackGrid').hidden};})()`);
 assert.deepEqual(pickup,{drops:0,item:'rock',count:3,hidden:true});
 await click('#switchGameMode');await click('#bagButton');
 assert.equal(await evaluate('document.querySelector("#backpackGrid .inv-slot").dataset.item'),'rock');
 assert(!await evaluate('document.getElementById("backpackGrid").hidden'));
 await click('#closeBackpack');await click('#switchGameMode');assert.equal(await evaluate('wildsGame.inventory.backpack[0].count'),3);
 await click('#exitGame');assert(await evaluate('!document.getElementById("exitConfirmOverlay").hidden && wildsGame.paused'));
 await shot('exit-confirm');await click('#cancelExitGame');assert(await evaluate('wildsGame.started && !wildsGame.paused'));
 await click('#exitGame');await click('#confirmExitGame');
 assert.deepEqual(await evaluate('({started:wildsGame.started,world:wildsGame.world,player:wildsGame.player,objects:wildsGame.placedObjects.size,equipment:wildsGame.inventory.equipment.some(Boolean),backpack:wildsGame.inventory.backpack.some(Boolean),start:document.getElementById("startScreen").hidden})'),{started:false,world:null,player:null,objects:0,equipment:false,backpack:false,start:false});
 await click('input[name="gameMode"][value="survival"]');await click('#startGameBtn');
 assert.deepEqual(await evaluate('({mode:wildsGame.gameMode,first:wildsGame.inventory.equipment[0],second:wildsGame.inventory.equipment[1].itemId,backpack:wildsGame.inventory.backpack.some(Boolean),toggle:document.getElementById("switchGameMode").hidden})'),{mode:'survival',first:null,second:'creation_scroll',backpack:false,toggle:true});
 await key('Space',' ');await click('#exitGameFromPause');await click('#cancelExitGame');assert(await evaluate('wildsGame.paused'));
 await click('#exitGameFromPause');await click('#confirmExitGame');assert(!await evaluate('wildsGame.started'));
 assert.deepEqual(errors,[]);console.log('Mode browser checks passed: start modes, seed, catalogue/hotbar, flight, simulation, death recovery, exit cancellation and clean restart.');
}finally{ws.close();}
