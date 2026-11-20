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
  const mouse=await evaluate(`(()=>{
    const g=wildsGame;g.beginGameFromStart();g.updateSpawner=()=>{};g.spawnFirstNightLucian=()=>false;g.updateSurvival=()=>{};
    g.mobs=[];g.placedObjects.clear();g.placedObjectTiles.clear();g.invalidateRooms();g.farm.clear();
    g.world.terrainAt=()=>Wilds.TERRAIN.GRASS;g.world.featureAt=()=>Wilds.FEATURE.NONE;g.world.waterDepthAt=()=>0;g.world.isDug=()=>false;
    g.player.x=10;g.player.y=10;g.lastPlayerSafe={x:10,y:10};g.clock.setTimeOfDay(22);g.wanderMob=()=>{};
    g.inventory.equipment.fill(null);g.inventory.equipment[0]={itemId:"enderman_portal",count:1,durability:15};
    g.selectedSlot={area:"equipment",index:0};g.renderInventory();g.syncHeldStats();
    g.testPig=g.spawnMob("pig",1,0);g.testZombie=g.spawnMob("zombie",10,0);g.testZombie.speed=0;
    g.drawPortalScene=()=>g.renderer.render(g.player,g.elapsed,g.clock.lighting,g.drops,g.renderTarget(),[...g.placedObjects.values()],g.mobs,g.projectiles,g.getRoomIndex(),g.giftEffects,g.farm,g.waterEffects,g.portalEffects);
    const r=g.canvas.getBoundingClientRect(),scale=Math.max(r.width/Wilds.CONFIG.VIEW_WIDTH,r.height/Wilds.CONFIG.VIEW_HEIGHT);
    return {x:r.left+(200+Wilds.CONFIG.VIEW_WIDTH/2)*scale-(Wilds.CONFIG.VIEW_WIDTH*scale-r.width)/2,
      y:r.top+Wilds.CONFIG.VIEW_HEIGHT/2*scale-(Wilds.CONFIG.VIEW_HEIGHT*scale-r.height)/2};
  })()`);
  await send("Input.dispatchMouseEvent",{type:"mouseMoved",...mouse});await delay(100);
  assert.equal(await evaluate("wildsGame.renderTarget().kind"),"portal");assert(await evaluate("wildsGame.renderTarget().valid"));
  const previews=await evaluate(`(()=>{const g=wildsGame,r=g.renderer,draw=r.drawPortalDisc,centres=[];
    r.drawPortalDisc=function(...args){centres.push(args.slice(0,2));return draw.apply(this,args);};
    try {r.drawPortalPreview(g.renderTarget(),r.cameraX,r.cameraY,g.elapsed);} finally {r.drawPortalDisc=draw;}
    return centres;})()`);
  assert.deepEqual(previews,[[240,150],[440,150]],"Both source and target portals must have previews");
  await screenshot("browser-portal-preview");
  await send("Input.dispatchKeyEvent",{type:"keyDown",code:"Digit1",key:"1"});
  await send("Input.dispatchKeyEvent",{type:"keyUp",code:"Digit1",key:"1"});
  const activated=await evaluate(`(()=>{const g=wildsGame;g.paused=true;g.pointerInside=false;
    return {count:g.portalEffects.length,durability:g.inventory.equipment[0].durability,cooldown:g.holyGunRemaining(g.inventory.equipment[0])};})()`);
  assert.equal(activated.count,1);assert.equal(activated.durability,14);assert(activated.cooldown>7.5);
  assert.equal(await evaluate("wildsGame.audio.actionSounds.portalOpen"),1);
  await evaluate(`(()=>{const g=wildsGame;g.updatePortalEffects(1-g.portalEffects[0].age);g.drawPortalScene();})()`);
  const nightLight=await evaluate(`(()=>{const g=wildsGame,r=g.renderer,casts=g.portalEffects;
    const pixels=()=>casts[0].ends.map((end,i)=>{const x=Math.round(end.x+(i?-40:40)-r.cameraX),y=Math.round(end.y+40-r.cameraY);
      const p=r.ctx.getImageData(x,y,1,1).data;return p[0]+p[1]+p[2];});
    const lit=pixels();g.portalEffects=[];g.drawPortalScene();const dark=pixels();g.portalEffects=casts;g.drawPortalScene();
    return {lit,dark};})()`);
  assert(nightLight.lit.every((value,i)=>value>nightLight.dark[i]+15),"Both portals must illuminate nearby night terrain");
  await screenshot("browser-portal-preparing");
  await evaluate(`(()=>{const g=wildsGame;g.updatePortalEffects(1.5-g.portalEffects[0].age);g.drawPortalScene();})()`);
  assert(await evaluate("wildsGame.player.portalFrozen && wildsGame.testPig.portalFrozen && wildsGame.testZombie.portalFrozen"));
  const hollow=await evaluate(`(()=>{const g=wildsGame,r=g.renderer;r.ctx.clearRect(0,0,64,64);
    r.drawPortalSilhouette(()=>r.drawPig(32,44),32,44);
    const pixels=r.portalOutlineCanvas.getContext("2d").getImageData(0,0,64,64).data;
    let count=0,colour;for(let i=3;i<pixels.length;i+=4){if(pixels[i])count++;if(pixels[i]===255&&!colour)colour=Array.from(pixels.slice(i-3,i));}
    g.drawPortalScene();return {count,centre:pixels[(42*64+32)*4+3],colour};})()`);
  assert(hollow.count>30);assert.equal(hollow.centre,0,"Outline body interior must be transparent");
  assert.deepEqual(hollow.colour,[10,29,81],"Unit outlines use near-black deep blue");
  const brightness=await evaluate(`(()=>{const g=wildsGame,r=g.renderer,original=r.ctx,probe=document.createElement("canvas");
    probe.width=100;probe.height=100;const ctx=probe.getContext("2d"),levels=[];
    try {r.ctx=ctx;for(const age of [1.49,1.5,2.99]) {
      ctx.clearRect(0,0,100,100);const effects=[{age,radius:30,ends:[{x:50,y:50}]}];
      r.drawPortals(effects,0,0,false);r.drawPortals(effects,0,0,true);
      const core=ctx.getImageData(50,50,1,1).data,edge=ctx.getImageData(80,50,1,1).data;
      levels.push({core:core[0]+core[1]+core[2],edge:edge[0]+edge[1]+edge[2]});
    }} finally {r.ctx=original;}return levels;})()`);
  assert(brightness[1].edge>brightness[0].edge+100,"Preparation must end with a bright rim burst");
  assert(brightness[2].edge>=brightness[1].edge*.95,"Rim brightness must persist until disappearance");
  assert(brightness.every(value=>value.core<40),"Portal cores stay almost black even during the flash");
  await screenshot("browser-portal-source-outline");
  const arrival=await evaluate(`(()=>{const g=wildsGame;g.player.update(.2,1,0,false);const frozenX=g.player.x;
    g.updatePortalEffects(.5);g.enforceGroundObstacleInvariant();g.drawPortalScene();
    return {frozenX,x:g.player.x,pigX:g.testPig.x,zombieX:g.testZombie.x,screenX:g.renderer.playerScreenX,camera:g.player.cameraOffset.x};})()`);
  assert.equal(arrival.frozenX,10);assert.equal(arrival.x,210);assert.equal(arrival.pigX,230);assert.equal(arrival.zombieX,10);
  assert.equal(await evaluate("wildsGame.audio.actionSounds.portalSwap"),1);
  assert.equal(arrival.camera,-200);assert.equal(arrival.screenX,440);
  await screenshot("browser-portal-arrival-outline");
  const halfway=await evaluate(`(()=>{const g=wildsGame;g.updatePortalEffects(.1);g.updatePortalCamera(.1);g.drawPortalScene();
    return {frozen:g.player.portalFrozen,offset:g.player.cameraOffset.x,screenX:g.renderer.playerScreenX};})()`);
  assert.deepEqual(halfway,{frozen:true,offset:-100,screenX:340});
  const aim=await evaluate(`(()=>{const g=wildsGame,r=g.canvas.getBoundingClientRect();return g.getPointerWorldPosition(r.left+r.width/2,r.top+r.height/2);})()`);
  assert.deepEqual(aim,{x:110,y:10},"Mouse aim must follow the temporarily offset camera");
  await screenshot("browser-portal-camera-return");
  await evaluate(`(()=>{const g=wildsGame;g.updatePortalEffects(.1);g.updatePortalCamera(.1);g.drawPortalScene();})()`);
  assert.equal(await evaluate("wildsGame.renderer.playerScreenX"),240);
  assert.equal(await evaluate("wildsGame.player.portalFrozen"),true);
  assert.equal(await evaluate("wildsGame.player.cameraOffset"),null);
  await evaluate("wildsGame.updatePortalEffects(.29);wildsGame.drawPortalScene()");
  await screenshot("browser-portal-sustained-flash");
  await evaluate("wildsGame.updatePortalEffects(.01);wildsGame.drawPortalScene()");
  assert.equal(await evaluate("wildsGame.player.portalFrozen"),false);
  assert.equal(await evaluate("wildsGame.portalEffects.length"),1);
  await evaluate("wildsGame.updatePortalEffects(.499);wildsGame.drawPortalScene()");
  assert.equal(await evaluate("wildsGame.portalEffects.length"),1);
  await evaluate("wildsGame.updatePortalEffects(.001);wildsGame.drawPortalScene()");
  assert.equal(await evaluate("wildsGame.renderer.playerScreenX"),240);assert.equal(await evaluate("wildsGame.portalEffects.length"),0);
  // A fully blocked destination shows the red preview and cannot spend another use.
  const invalid=await evaluate(`(()=>{const g=wildsGame;for(let ty=-1;ty<=1;ty++)for(let tx=14;tx<=16;tx++) {
    const o={type:"wall",tx,ty,tiles:[{tx,ty}]};o.storageKey=Wilds.Buildings.key(o);g.placedObjects.set(o.storageKey,o);g.placedObjectTiles.set(tx+","+ty,new Set([o]));
    }g.invalidateRooms();g.pointerInside=true;g.getPointerWorldPosition=()=>({x:310,y:10});g.paused=false;
    g.holyGunTime=100;const result=g.startPortal();g.paused=true;const plan=g.portalPlan(310,10);
    g.renderer.drawPortalPreview(plan,g.renderer.cameraX,g.renderer.cameraY,g.elapsed);
    return {result,valid:plan.valid,durability:g.inventory.equipment[0].durability};})()`);
  assert.deepEqual(invalid,{result:false,valid:false,durability:14});await screenshot("browser-portal-invalid");
  const late=await evaluate(`(()=>{const g=wildsGame;g.placedObjects.clear();g.placedObjectTiles.clear();g.invalidateRooms();g.mobs=[];
    g.player.x=10;g.player.y=10;g.player.cameraOffset=null;g.lastPlayerSafe={x:10,y:10};
    g.getPointerWorldPosition=()=>({x:210,y:10});g.holyGunTime=100;g.pointerInside=true;g.paused=false;
    const started=g.startPortal();g.paused=true;g.pointerInside=false;g.player.x=90;g.player.y=90;
    const pig=g.spawnMob("pig",3,0),zombie=g.spawnMob("zombie",7,0);zombie.speed=0;
    g.updatePortalEffects(1.5);g.updatePortalEffects(.49);
    g.player.x=15;g.player.y=13;pig.x=25;zombie.x=205;
    g.capturePortalEntrants();const captured=g.player.portalFrozen&&pig.portalFrozen&&zombie.portalFrozen;
    g.drawPortalScene();g.updatePortalEffects(.009);const before=g.player.x;
    g.updatePortalEffects(.001);g.enforceGroundObstacleInvariant();const positions=[g.player.x,pig.x,zombie.x];
    const sheep=g.spawnMob("sheep",0,1);g.capturePortalEntrants();const arrivalIgnored=!sheep.portalFrozen;
    const cast=g.portalEffects[0];g.updatePortalEffects(.5);const released=!g.player.portalFrozen&&!pig.portalFrozen&&!zombie.portalFrozen;
    const fixedDuration=g.portalEffects.length===1&&Math.abs(cast.age-2.5)<1e-8;
    g.updatePortalEffects(.5);g.updatePortalCamera(.5);g.drawPortalScene();
    return {started,captured,before,positions,released,fixedDuration,arrivalIgnored,remaining:g.portalEffects.length};})()`);
  assert.deepEqual(late,{started:true,captured:true,before:15,positions:[215,225,5],released:true,fixedDuration:true,arrivalIgnored:true,remaining:0});
  await evaluate(`(()=>{const g=wildsGame;g.placedObjects.clear();g.placedObjectTiles.clear();g.invalidateRooms();g.mobs=[];
    g.getPointerWorldPosition=()=>({x:10,y:110});g.holyGunTime=200;g.pointerInside=true;g.paused=false;g.lastFrameTime=0;})()`);
  await send("Input.dispatchKeyEvent",{type:"keyDown",code:"Digit1",key:"1"});
  await send("Input.dispatchKeyEvent",{type:"keyUp",code:"Digit1",key:"1"});
  await send("Input.dispatchKeyEvent",{type:"keyDown",code:"KeyD",key:"d"});await delay(850);
  await send("Input.dispatchKeyEvent",{type:"keyUp",code:"KeyD",key:"d"});await delay(100);
  const escaped=await evaluate(`(()=>{const g=wildsGame,c=g.portalEffects[0];return {age:c.age,distance:Math.hypot(g.player.x-c.ends[0].x,g.player.y-c.ends[0].y),x:g.player.x,y:g.player.y};})()`);
  assert(escaped.age<1.5);assert(escaped.distance>30);
  await delay(3100);
  assert.equal(await evaluate("wildsGame.portalEffects.length"),0);
  assert.deepEqual(await evaluate("({x:wildsGame.player.x,y:wildsGame.player.y,frozen:wildsGame.player.portalFrozen})"),{x:escaped.x,y:escaped.y,frozen:false});
  // M-map targeting uses real mouse/key events, including drag-to-pan.
  const drag=await evaluate(`(()=>{const g=wildsGame;g.player.x=10;g.player.y=10;g.player.cameraOffset=null;g.lastPlayerSafe={x:10,y:10};
    g.mobs=[];g.holyGunTime=1000;g.inventory.equipment[0]={itemId:"enderman_portal",count:1,durability:15};g.selectedSlot={area:"equipment",index:1};
    g.explored.clear();g.explored.add(g.tileKey(60,0));g.explored.add(g.tileKey(61,0));g.paused=false;g.renderInventory();g.syncHeldStats();
    const r=g.worldMapCanvas.getBoundingClientRect();return r.width;})()`);
  await send("Input.dispatchKeyEvent",{type:"keyDown",code:"KeyM",key:"m"});
  await send("Input.dispatchKeyEvent",{type:"keyUp",code:"KeyM",key:"m"});
  assert(await evaluate("wildsGame.mapOpen"));
  const mapDrag=await evaluate(`(()=>{const g=wildsGame,r=g.worldMapCanvas.getBoundingClientRect();return {x:r.left+r.width*.6,y:r.top+r.height*.5,dx:400*r.width/960,cam:g.mapCamX};})()`);
  await send("Input.dispatchMouseEvent",{type:"mouseMoved",x:mapDrag.x,y:mapDrag.y});
  await send("Input.dispatchMouseEvent",{type:"mousePressed",x:mapDrag.x,y:mapDrag.y,button:"left",clickCount:1});
  await send("Input.dispatchMouseEvent",{type:"mouseMoved",x:mapDrag.x-mapDrag.dx,y:mapDrag.y,buttons:1});
  await send("Input.dispatchMouseEvent",{type:"mouseReleased",x:mapDrag.x-mapDrag.dx,y:mapDrag.y,button:"left",clickCount:1});
  assert(Math.abs(await evaluate("wildsGame.mapCamX")-mapDrag.cam-50)<.01);
  async function aimMap(tx) {
    const point=await evaluate(`(()=>{const g=wildsGame,r=g.worldMapCanvas.getBoundingClientRect();return {x:r.left+(${tx}+.5-g.mapCamX)*8*r.width/960,y:r.top+(.5-g.mapCamY)*8*r.height/600};})()`);
    await send("Input.dispatchMouseEvent",{type:"mouseMoved",...point});
    return evaluate(`(()=>{const g=wildsGame,ctx=g.worldMapCtx,stroke=ctx.stroke,colours=[];ctx.stroke=function(...args){colours.push(this.strokeStyle);return stroke.apply(this,args);};
      try{g.drawMapPortalPreview();}finally{ctx.stroke=stroke;}return {valid:g.portalPlan(g.mapPortalTarget.x,g.mapPortalTarget.y,true).valid,colours};})()`);
  }
  const unknown=await aimMap(59);assert(!unknown.valid);assert(unknown.colours.includes("#ff646f"));
  await send("Input.dispatchKeyEvent",{type:"keyDown",code:"Digit1",key:"1"});await send("Input.dispatchKeyEvent",{type:"keyUp",code:"Digit1",key:"1"});
  assert(await evaluate("wildsGame.mapOpen"));assert.equal(await evaluate("wildsGame.inventory.equipment[0].durability"),15);
  const distant=await aimMap(61);assert(!distant.valid);assert(distant.colours.includes("#ff646f"));
  const allowed=await aimMap(60);assert(allowed.valid);assert(allowed.colours.includes("#7df7a1"));
  await screenshot("browser-map-portal-preview");
  await send("Input.dispatchKeyEvent",{type:"keyDown",code:"Digit1",key:"1"});await send("Input.dispatchKeyEvent",{type:"keyUp",code:"Digit1",key:"1"});
  const mapCast=await evaluate(`(()=>{const g=wildsGame;g.paused=true;const cast=g.portalEffects[0];return {map:g.mapOpen,count:g.portalEffects.length,x:cast.ends[1].x,durability:g.inventory.equipment[0].durability};})()`);
  assert.deepEqual(mapCast,{map:false,count:1,x:1210,durability:14});
  const longCamera=await evaluate(`(()=>{const g=wildsGame;g.updatePortalEffects(2-g.portalEffects[0].age);const duration=g.player.cameraOffset.duration;
    g.updatePortalCamera(.5);return {duration,x:g.player.x,offset:g.player.cameraOffset,frozen:g.player.portalFrozen};})()`);
  assert.deepEqual(longCamera,{duration:.5,x:1210,offset:null,frozen:true});
  assert.deepEqual(errors,[]);
  console.log("Portal browser checks passed, including M-map panning, explored/range checks, red/green previews, skill shortcuts and long-distance camera return.");
} finally { ws.close(); }
