// Real pointer events exercise silhouette gaze, combat music, blink collision and rendering.
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
  if (pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id); pending.delete(m.id);
    m.error ? reject(m.error) : resolve(m.result);
  }
});
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function screenshot(name) {
  const result = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(new URL(`../screenshots/browser-${name}.png`, import.meta.url), Buffer.from(result.data, "base64"));
}
async function pointAt(offsetX, offsetY) {
  const point = await evaluate(`(()=>{
    const g=wildsGame,m=g.testEnderman,r=g.canvas.getBoundingClientRect();
    const scale=Math.max(r.width/Wilds.CONFIG.VIEW_WIDTH,r.height/Wilds.CONFIG.VIEW_HEIGHT);
    return {x:r.left+(m.x-g.player.x+Wilds.CONFIG.VIEW_WIDTH/2+${offsetX})*scale-(Wilds.CONFIG.VIEW_WIDTH*scale-r.width)/2,
      y:r.top+(m.y-g.player.y+Wilds.CONFIG.VIEW_HEIGHT/2+${offsetY})*scale-(Wilds.CONFIG.VIEW_HEIGHT*scale-r.height)/2};
  })()`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  return point;
}

try {
  await send("Page.enable"); await send("Runtime.enable"); await send("Page.navigate", { url });
  for (let i=0;i<100;i++) { if (await evaluate("!!globalThis.wildsGame")) break; await delay(100); }
  await evaluate(`(()=>{
    const g=wildsGame;g.beginGameFromStart();g.updateSpawner=()=>{};g.spawnFirstNightLucian=()=>false;g.updateSurvival=()=>{};
    g.mobs=[];g.placedObjects.clear();g.placedObjectTiles.clear();g.invalidateRooms();g.farm.clear();
    g.world.terrainAt=()=>Wilds.TERRAIN.GRASS;g.world.featureAt=()=>Wilds.FEATURE.NONE;
    g.world.waterDepthAt=()=>0;g.world.isDug=()=>false;
    g.player.x=10;g.player.y=10;g.lastPlayerSafe={x:10,y:10};g.player.facing="down";
    g.clock.setTimeOfDay(18.1);g.combatMusicUntil=0;g.pointerInside=false;g.wanderMob=()=>{};
    const update=g.audio.update.bind(g.audio);g.audio.update=scene=>{g.testCombat=scene.combat;update(scene);};
    g.testEnderman=g.spawnMob("enderman",5,0);g.testEnderman.speed=0;
  })()`);
  await delay(250);
  assert.deepEqual(await evaluate("({provoked:wildsGame.testEnderman.provoked,aggro:wildsGame.testEnderman.aggro,combat:wildsGame.testCombat})"),
    {provoked:false,aggro:false,combat:false});
  await screenshot("enderman-neutral");
  await pointAt(0,3); await delay(150);
  assert.equal(await evaluate("wildsGame.testEnderman.provoked"),false,"Gap between legs must not provoke");
  await pointAt(0,-26); await delay(100);
  const blink=await evaluate(`(()=>{const g=wildsGame,m=g.testEnderman;return {provoked:m.provoked,aggro:m.aggro,
    x:m.x,y:m.y,health:g.player.health,cooldown:m.blinkCooldown,safeX:m.lastSafeX,safeY:m.lastSafeY,combat:g.testCombat};})()`);
  assert(blink.provoked&&blink.aggro&&blink.combat);assert.equal(blink.x,10);assert.equal(blink.y,-10);
  assert.equal(blink.health,70);assert(blink.cooldown>7.5&&blink.cooldown<=8);
  assert.equal(blink.x,blink.safeX);assert.equal(blink.y,blink.safeY);
  assert.equal(await evaluate("wildsGame.audio.actionSounds.endermanBlink"),1);
  await screenshot("enderman-blink");
  // A blink may cross an intervening wall as long as the landing is legal.
  const blocked=await evaluate(`(()=>{
    const g=wildsGame,m=g.testEnderman;g.pointerInside=false;g.mobs=[m];
    m.x=m.lastSafeX=110;m.y=m.lastSafeY=10;m.blinkCooldown=0;m.blinkRetry=0;
    for(let ty=-2;ty<=2;ty++) {
      const wall={id:999+ty,type:"wall",tx:2,ty,tiles:[{tx:2,ty}]};wall.storageKey=Wilds.Buildings.key(wall);
      g.placedObjects.set(wall.storageKey,wall);g.placedObjectTiles.set("2,"+ty,new Set([wall]));
    }g.invalidateRooms();
    const before=g.player.health,result=g.tryEndermanBlink(m,performance.now());g.enforceGroundObstacleInvariant();
    return {result,x:m.x,y:m.y,health:g.player.health,before};
  })()`);
  assert.equal(blocked.result,true);assert.equal(blocked.x,10);assert.equal(blocked.y,-10);assert.equal(blocked.health,blocked.before-30);
  const refreshed=await evaluate(`(()=>{
    const g=wildsGame,m=g.testEnderman;g.placedObjects.clear();g.placedObjectTiles.clear();g.invalidateRooms();
    g.player.facing="left";g.player.health=100;m.blinkCooldown=0.01;m.blinkRetry=0;m.attackAt=Infinity;
    g.updateMobs(0.02,performance.now());g.enforceGroundObstacleInvariant();
    return {x:m.x,y:m.y,cooldown:m.blinkCooldown,health:g.player.health};
  })()`);
  assert.deepEqual(refreshed,{x:30,y:10,cooldown:8,health:70});
  const fallback=await evaluate(`(()=>{
    const g=wildsGame,m=g.testEnderman;g.player.facing="down";g.player.health=100;
    m.x=m.lastSafeX=110;m.y=m.lastSafeY=10;m.blinkCooldown=0;m.blinkRetry=0;
    const wall={id:777,type:"wall",tx:0,ty:-1,tiles:[{tx:0,ty:-1}]};wall.storageKey=Wilds.Buildings.key(wall);
    g.placedObjects.set(wall.storageKey,wall);g.placedObjectTiles.set("0,-1",new Set([wall]));g.invalidateRooms();
    const before=g.audio.actionSounds.endermanBlink,result=g.tryEndermanBlink(m,performance.now());
    g.enforceGroundObstacleInvariant();return {result,x:m.x,y:m.y,health:g.player.health,sounds:g.audio.actionSounds.endermanBlink-before};
  })()`);
  assert.equal(fallback.result,true);assert.equal(Math.abs(fallback.x-10),20);assert.equal(fallback.y,10);
  assert.equal(fallback.health,70);assert.equal(fallback.sounds,1);
  const surrounded=await evaluate(`(()=>{
    const g=wildsGame,m=g.testEnderman;g.placedObjects.clear();g.placedObjectTiles.clear();
    for(let ty=-1;ty<=1;ty++)for(let tx=-1;tx<=1;tx++) {
      if(!tx&&!ty)continue;
      const wall={id:888+ty*3+tx,type:"wall",tx,ty,tiles:[{tx,ty}]};wall.storageKey=Wilds.Buildings.key(wall);
      g.placedObjects.set(wall.storageKey,wall);g.placedObjectTiles.set(tx+","+ty,new Set([wall]));
    }g.invalidateRooms();g.player.health=100;m.x=m.lastSafeX=110;m.y=m.lastSafeY=10;m.blinkCooldown=0;m.blinkRetry=0;
    const result=g.tryEndermanBlink(m,performance.now());g.enforceGroundObstacleInvariant();
    return {result,distance:Math.hypot(m.x-g.player.x,m.y-g.player.y),health:g.player.health,cooldown:m.blinkCooldown,legal:g.mobCanOccupy(m.x,m.y,m)};
  })()`);
  assert.deepEqual(surrounded,{result:true,distance:40,health:100,cooldown:8,legal:true});
  const shore=await evaluate(`(()=>{
    const g=wildsGame,m=g.testEnderman;g.placedObjects.clear();g.placedObjectTiles.clear();g.invalidateRooms();
    g.world.terrainAt=(x,y)=>x<=0?Wilds.TERRAIN.GRASS:Wilds.TERRAIN.OCEAN;
    g.world.waterDepthAt=(x,y)=>x<=0?0:x<=2?1:2;
    g.player.x=70;g.player.y=10;g.player.health=100;m.x=m.lastSafeX=-50;m.y=m.lastSafeY=10;
    m.speed=30;m.blinkCooldown=0;m.blinkRetry=0;
    const before=g.audio.actionSounds.endermanBlink;
    for(let i=0;i<100;i++)g.updateMobs(.05,performance.now()+i*50);
    g.enforceGroundObstacleInvariant();return {aggro:m.aggro,provoked:m.provoked,x:m.x,health:g.player.health,sounds:g.audio.actionSounds.endermanBlink-before};
  })()`);
  assert(shore.aggro&&shore.provoked);assert(shore.x>10&&shore.x<15);assert.equal(shore.health,100);assert.equal(shore.sounds,0);
  await screenshot("enderman-shore");
  // A direct click on the tall head also counts as a player melee attack.
  await evaluate(`(()=>{const g=wildsGame;g.world.terrainAt=()=>Wilds.TERRAIN.GRASS;g.world.waterDepthAt=()=>0;
    g.player.x=10;g.lastPlayerSafe={x:10,y:10};g.mobs=[];g.testEnderman=g.spawnMob("enderman",2,0);
    g.testEnderman.speed=0;g.inventory.equipment.fill(null);g.selectedSlot={area:"equipment",index:0};
    g.syncHeldStats();g.player.health=100;g.pointerInside=false;g.nextAttackAt=0;g.paused=true;})()`);
  const click=await pointAt(0,-26);
  // Resume and dispatch synchronously to test the click path before the next gaze frame.
  await evaluate(`(()=>{const g=wildsGame;g.paused=false;g.canvas.dispatchEvent(new PointerEvent("pointerdown",{button:0,clientX:${click.x},clientY:${click.y},pointerId:1,bubbles:true,cancelable:true}));})()`);
  assert(await evaluate("wildsGame.testEnderman.health<90 && wildsGame.testEnderman.provoked"));
  const floorAttack=await evaluate(`(()=>{
    const g=wildsGame;g.pointerInside=false;g.mobs=[];const mob=g.spawnMob("pig",1,0);
    const floor={type:"wood_floor",tx:1,ty:0,itemId:"wood_floor",tiles:[{tx:1,ty:0}]};floor.storageKey=Wilds.Buildings.key(floor);
    g.placedObjects.set(floor.storageKey,floor);g.placedObjectTiles.set("1,0",new Set([floor]));g.nextAttackAt=0;
    const r=g.canvas.getBoundingClientRect(),scale=Math.max(r.width/Wilds.CONFIG.VIEW_WIDTH,r.height/Wilds.CONFIG.VIEW_HEIGHT);
    const clientX=r.left+(mob.x-g.player.x+Wilds.CONFIG.VIEW_WIDTH/2)*scale-(Wilds.CONFIG.VIEW_WIDTH*scale-r.width)/2;
    const clientY=r.top+(mob.y-g.player.y+Wilds.CONFIG.VIEW_HEIGHT/2)*scale-(Wilds.CONFIG.VIEW_HEIGHT*scale-r.height)/2;
    g.canvas.dispatchEvent(new PointerEvent("pointerdown",{button:0,clientX,clientY,pointerId:1,bubbles:true,cancelable:true}));
    return {health:mob.health,max:mob.maxHealth,mining:g.mining,floor:g.placedObjects.has(floor.storageKey)};
  })()`);
  assert(floorAttack.health<floorAttack.max);assert.equal(floorAttack.mining,null);assert(floorAttack.floor);
  await delay(100); assert.deepEqual(errors,[]);
  console.log("Enderman browser checks passed: gaze, blink across walls, nearest landing beyond blockers, water avoidance, sound and creature attack above flooring.");
} finally { ws.close(); }
