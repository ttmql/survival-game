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
  await send("Page.enable"); await send("Runtime.enable"); await send("Page.navigate", { url });
  for (let i = 0; i < 100; i++) { if (await evaluate("!!globalThis.wildsGame")) break; await delay(100); }
  const scene = await evaluate(`(() => {
    const g = wildsGame;
    g.beginGameFromStart(); g.mobs = []; g.updateSpawner = () => {};
    g.world = { ...g.world, terrainAt: () => Wilds.TERRAIN.GRASS, featureAt: () => Wilds.FEATURE.NONE, isDug: () => false };
    g.player.world = g.world; g.renderer.setWorld(g.world);
    g.placedObjects.clear(); g.placedObjectTiles.clear();
    function place(type, x, y) {
      g.player.x = (x - 1 + 0.5) * 20; g.player.y = (y + 0.5) * 20;
      g.inventory.setSlot("equipment", 0, { itemId: type, count: 1 });
      g.selectedSlot = { area: "equipment", index: 0 };
      if (!g.placeSelectedObject(x, y)) throw Error("Cannot place " + type + " at " + x + "," + y);
    }
    for (let y = 0; y <= 4; y++) for (let x = 0; x <= 6; x++) {
      place("wood_floor", x, y);
      if (x === 0 || x === 6 || y === 0 || y === 4) place(x === 3 && y === 4 ? "wood_door" : "wall", x, y);
      place("roof", x, y);
    }
    place("torch", 0, 2); place("torch", 6, 2);
    for (let y = 0; y <= 4; y++) for (let x = 9; x <= 13; x++) {
      if (x === 9 || x === 13 || y === 0 || y === 4) place(x === 11 && y === 4 ? "fence_gate" : "wood_fence", x, y);
    }
    g.inventory.equipment.fill(null); g.inventory.backpack.fill(null); g.selectedSlot = null;
    g.player.x = 70; g.player.y = 130; g.lastPlayerSafe = { x: 70, y: 130 };
    g.clock.setTimeOfDay(12); g.syncHud(true); g.renderInventory();
    return { count: g.placedObjects.size, recipes: Wilds.RECIPES.length };
  })()`);
  assert.ok(scene.recipes >= 24); assert.ok(scene.count > 90);
  await delay(150); assert.equal(await evaluate("wildsGame.renderer.transparentRoofTiles.size"), 0);
  await screenshot("buildings-roof-opaque");
  const door = await evaluate(`(() => {
    const g = wildsGame; g.player.y = 110;
    g.openPlacedObject(3, 4);
    const open = g.placedObjectAt(3, 4).open;
    const pass = !g.projectilePathBlocked(70, 70, 70, 110);
    g.player.y = 50; g.lastPlayerSafe = { x: 70, y: 50 };
    g.openPlacedObject(3, 4);
    return { open, pass, closed: !g.placedObjectAt(3, 4).open };
  })()`);
  assert.deepEqual(door, { open: true, pass: true, closed: true });
  await delay(150); assert.equal(await evaluate("wildsGame.renderer.transparentRoofTiles.size"), 35);
  await screenshot("buildings-roof-transparent");
  // Isolated fixtures make partial occlusion and logical-vs-visual tile offsets explicit.
  await evaluate(`(() => {
    const g = wildsGame; g.placedObjects.clear(); g.placedObjectTiles.clear(); g.drops = [];
    for (const [type, x, y] of [["workbench", 3, 2], ["wall", 3, 3], ["torch", 2, 2], ["stele", 2, 3], ["roof", 5, 2]]) {
      g.player.x = (x - 1 + 0.5) * 20; g.player.y = (y + 0.5) * 20;
      g.inventory.setSlot("equipment", 0, { itemId: type, count: 1 });
      g.selectedSlot = { area: "equipment", index: 0 };
      if (!g.placeSelectedObject(x, y)) throw Error("Scene placement failed: " + type);
    }
    g.player.x = 70; g.player.y = 110; g.lastPlayerSafe = { x: 70, y: 110 };
    g.selectedSlot = null; g.inventory.equipment.fill(null); g.renderInventory();
    return true;
  })()`);
  await delay(150);
  assert.ok(await evaluate("wildsGame.renderer.occlusionGhostCount > 0"));
  const revealedPixels = await evaluate(`(() => {
    const g = wildsGame, r = g.renderer;
    const render = () => r.render(g.player, g.elapsed, g.clock.lighting, [], null, [...g.placedObjects.values()], [], []);
    render(); const withGhost = r.ctx.getImageData(0, 0, 480, 300).data;
    const saved = r.drawOccludedFixtures; r.drawOccludedFixtures = () => {};
    render(); const withoutGhost = r.ctx.getImageData(0, 0, 480, 300).data;
    r.drawOccludedFixtures = saved; render();
    let changed = 0;
    for (let i = 0; i < withGhost.length; i += 4) if (withGhost[i] !== withoutGhost[i] || withGhost[i+1] !== withoutGhost[i+1] || withGhost[i+2] !== withoutGhost[i+2]) changed++;
    return changed;
  })()`);
  assert.ok(revealedPixels > 10, "occluded model pixels should become faintly visible");
  await screenshot("buildings-occlusion-and-roof");
  await evaluate(`(() => {
    const g = wildsGame;
    g.inventory.setSlot("equipment", 0, { itemId: "roof", count: 2 });
    g.selectedSlot = { area: "equipment", index: 0 }; g.renderInventory(); return true;
  })()`);
  async function hover(tx, ty) {
    const point = await evaluate(`(() => {
      const g = wildsGame, rect = g.canvas.getBoundingClientRect();
      const scale = Math.max(rect.width / 480, rect.height / 300);
      return { x: rect.left + ((${tx} + 0.5) * 20 - g.player.x + 240) * scale - (480 * scale - rect.width) / 2,
        y: rect.top + ((${ty} + 0.5) * 20 - g.player.y + 150) * scale - (300 * scale - rect.height) / 2 };
    })()`);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point }); await delay(100);
  }
  await hover(4, 3);
  const validPreview = await evaluate("({ kind: wildsGame.renderTarget()?.kind, valid: wildsGame.renderTarget()?.valid, count: wildsGame.inventory.equipment[0].count, objects: wildsGame.placedObjects.size })");
  assert.equal(validPreview.kind, "placement"); assert.equal(validPreview.valid, true);
  assert.equal(validPreview.count, 2); assert.equal(validPreview.objects, 5);
  await screenshot("buildings-placement-preview");
  await hover(5, 2);
  assert.equal(await evaluate("wildsGame.renderTarget()?.valid"), false);
  await screenshot("buildings-placement-invalid");
  const creatureMask = await evaluate(`(() => {
    const g=wildsGame, r=g.renderer; g.selectedSlot=null; g.pointerInside=false; g.updateMobs=()=>{};
    g.mobs=[]; g.spawnMob("pig",2,2); g.spawnMob("zombie",3,2);
    const render=()=>r.render(g.player,g.elapsed,g.clock.lighting,[],null,[...g.placedObjects.values()],g.mobs,[],g.getRoomIndex());
    render(); const faded=r.ctx.getImageData(0,0,480,300).data;
    const saved=r.drawMobsWithOcclusion;
    r.drawMobsWithOcclusion=function(mobs,objects,x,y,t){this.drawMobs(mobs,x,y,t);};
    render(); const solid=r.ctx.getImageData(0,0,480,300).data;
    r.drawMobsWithOcclusion=saved;render();
    let changed=0;for(let i=0;i<faded.length;i+=4)if(faded[i]!==solid[i]||faded[i+1]!==solid[i+1]||faded[i+2]!==solid[i+2])changed++;
    return changed;
  })()`);
  assert.ok(creatureMask>10,"creatures behind tall fixtures must not render fully opaque");
  await screenshot("creatures-obstacle-occlusion");
  const playerMask=await evaluate(`(() => {
    const g=wildsGame,r=g.renderer;g.finishObjectMining({tx:3,ty:2});g.player.x=70;g.player.y=50;g.lastPlayerSafe={x:70,y:50};
    const render=()=>r.render(g.player,g.elapsed,g.clock.lighting,[],null,[...g.placedObjects.values()],[],[],g.getRoomIndex());
    render();const faded=r.ctx.getImageData(0,0,480,300).data;
    const saved=r.drawPlayerWithOcclusion;r.drawPlayerWithOcclusion=function(player){this.drawPlayer(player);};
    render();const solid=r.ctx.getImageData(0,0,480,300).data;
    r.drawPlayerWithOcclusion=saved;render();
    let changed=0;for(let i=0;i<faded.length;i+=4)if(faded[i]!==solid[i]||faded[i+1]!==solid[i+1]||faded[i+2]!==solid[i+2])changed++;
    return changed;
  })()`);
  assert.ok(playerMask>10,"player behind a tall obstacle should fade only in the occluded pixels");
  await screenshot("player-obstacle-occlusion");
  const jointMining=await evaluate(`(() => {
    const g=wildsGame;
    g.inventory.setSlot("equipment",0,{itemId:"torch",count:1});g.selectedSlot={area:"equipment",index:0};
    if(!g.placeSelectedObject(3,3))throw Error("Cannot stack torch");
    g.drops=[];g.finishObjectMining({tx:3,ty:3});
    return { remaining:g.objectsAt(3,3).map(o=>o.type), drops:g.drops.map(d=>d.itemId) };
  })()`);
  assert.equal(jointMining.remaining.includes("torch"),false);
  assert.ok(jointMining.drops.includes("torch")&&jointMining.drops.includes("wall"));
  const treeDepth=await evaluate(`(()=>{
    const g=wildsGame,r=g.renderer;g.paused=true;
    const tree={type:'tree',tx:3,ty:3},wall={type:'wall',tx:3,ty:2};
    const original=r.ctx,room=r.roomIndex,viewer=r.viewerRoom;r.roomIndex=null;r.viewerRoom=null;
    function layer(draw){const canvas=document.createElement('canvas');canvas.width=480;canvas.height=300;r.ctx=canvas.getContext('2d');draw();return r.ctx.getImageData(0,0,480,300).data;}
    let checked=0,maxError=0;
    try{
      const trees=layer(()=>r.drawFixedObject(tree,0,0,0)),walls=layer(()=>r.drawFixedObject(wall,0,0,0));
      const combined=layer(()=>r.drawPlacedObjects([tree,wall],0,0,0));
      for(let i=0;i<trees.length;i+=4){
        if(trees[i+3]!==255||walls[i+3]!==255||trees[i+1]<=trees[i])continue;
        checked++;for(let c=0;c<3;c++)maxError=Math.max(maxError,Math.abs(combined[i+c]-(trees[i+c]*.72+walls[i+c]*.28)));
      }
    }finally{r.ctx=original;r.roomIndex=room;r.viewerRoom=viewer;}
    g.placedObjects.clear();g.placedObjectTiles.clear();g.invalidateRooms();g.mobs=[];g.drops=[];g.farm.clear();
    g.player.x=10;g.player.y=30;g.player.cameraOffset=null;
    g.world.terrainAt=()=>Wilds.TERRAIN.GRASS;g.world.featureAt=(x,y)=>x===3&&y===3?Wilds.FEATURE.TREE:Wilds.FEATURE.NONE;
    const placed={...wall,itemId:'wall',tiles:[{tx:3,ty:2}]};placed.storageKey=Wilds.Buildings.key(placed);g.placedObjects.set(placed.storageKey,placed);g.placedObjectTiles.set('3,2',new Set([placed]));
    r.render(g.player,0,{darkness:0,warm:0},[],null,[placed],[],[],g.getRoomIndex());
    return {checked,maxError,natural:r.naturalFixtures.some(o=>o.type==='tree'&&o.tx===3&&o.ty===3),ghosts:r.occlusionGhostCount};
  })()`);
  assert(treeDepth.checked>0);assert(treeDepth.maxError<3,JSON.stringify(treeDepth));assert(treeDepth.natural);assert(treeDepth.ghosts>0);
  await screenshot("browser-tree-depth-ghost");
  assert.deepEqual(errors, []);
  console.log("Browser checks passed: crafting, layered placement, door passage, opaque roof, connected roof transparency, occlusion pixels, hover preview, invalid preview, no runtime errors.");
} finally { ws.close(); }
