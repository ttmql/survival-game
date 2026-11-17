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
 const start=await evaluate(`(()=>{const g=wildsGame;g.beginGameFromStart();g.updateSpawner=()=>{};g.mobs=[];return g.selectedSlot.index;})()`);assert.equal(start,0);await delay(750);
 const switched=await evaluate(`(()=>{const g=wildsGame;g.inventory.equipment.fill(null);g.inventory.backpack.fill(null);
 g.inventory.setSlot("equipment",0,{itemId:"wood",count:64});g.inventory.setSlot("equipment",1,{itemId:"wood_axe",count:1,durability:9});g.renderInventory();
 document.querySelectorAll("#hotbar .inv-slot")[1].click();document.querySelectorAll("#hotbar .inv-slot")[1].click();
 const selected=g.selectedSlot.index,wood=g.inventory.equipment[0].count;
 document.querySelectorAll("#hotbar .inv-slot")[7].click();const empty=g.selectedSlot.index;
 g.selectedSlot=null;return{selected,wood,empty,persistent:g.selectedSlot.index};})()`);
 assert.deepEqual(switched,{selected:1,wood:64,empty:7,persistent:7});
 const sorted=await evaluate(`(()=>{const g=wildsGame;g.openBackpack();
 g.inventory.setSlot("backpack",3,{itemId:"rock",count:40});g.inventory.setSlot("backpack",8,{itemId:"rock",count:35});
 g.inventory.setSlot("backpack",12,{itemId:"wood_axe",count:1,durability:3});g.inventory.setSlot("backpack",20,{itemId:"wood_axe",count:1,durability:7});
 g.renderInventory();document.getElementById("sortBackpack").click();return{slots:g.inventory.backpack.slice(0,5),held:g.selectedSlot.index};})()`);
 assert.equal(sorted.slots[0].count,64);assert.equal(sorted.slots[1].count,11);assert.equal(sorted.slots[2].durability,3);assert.equal(sorted.slots[3].durability,7);assert.equal(sorted.slots[4],null);assert.equal(sorted.held,7);
 await screenshot("inventory-64-sort");
 const bagFrame=await evaluate(`(()=>{const g=wildsGame,b=g.inventoryButtons.backpack[0];b.click();g.renderInventory();
   const framed=b.classList.contains("is-selected"),width=getComputedStyle(b).outlineWidth;b.click();return {framed,width,cleared:!b.classList.contains("is-selected")};})()`);
 assert.deepEqual(bagFrame,{framed:true,width:"2px",cleared:true});
 const swap=await evaluate(`(()=>{const g=wildsGame;
 document.querySelectorAll("#backpackGrid .inv-slot")[0].click();document.querySelectorAll("#hotbar .inv-slot")[0].click();
 const first={hand:g.inventory.equipment[0].itemId,bag:g.inventory.backpack[0].itemId};
 document.querySelectorAll("#backpackGrid .inv-slot")[0].click();document.querySelectorAll("#backpackGrid .inv-slot")[1].click();
 return{...first,bagFirst:g.inventory.backpack[0].itemId,bagSecond:g.inventory.backpack[1].itemId,held:g.selectedSlot.index};})()`);
 assert.deepEqual(swap,{hand:"rock",bag:"wood",bagFirst:"rock",bagSecond:"wood",held:0});
 const chest=await evaluate(`(()=>{const g=wildsGame;g.closeBackpack();const object={storage:new Array(32).fill(null)};g.addToArray(object.storage,{itemId:"wood",count:130});g.openStorage(object);return object.storage.slice(0,3).map(s=>s.count);})()`);
 assert.deepEqual(chest,[64,64,2]);await screenshot("storage-64-stacks");
 const equipmentStored=await evaluate(`(()=>{const g=wildsGame;g.inventory.equipment[0]={itemId:"wood_axe",count:1,durability:7};g.inventory.equipment[1]={itemId:"wood",count:5};g.selectedSlot={area:"equipment",index:0};g.syncHeldStats();g.renderStorage();const count=g.chestEquipmentGrid.children.length;g.chestEquipmentGrid.children[0].click();g.chestEquipmentGrid.children[1].click();return {count,axe:g.storageObject.storage.find(s=>s?.itemId==="wood_axe"),wood:g.storageObject.storage[2].count,empty:g.inventory.equipment[0]===null&&g.inventory.equipment[1]===null,selected:g.selectedSlot.index,attack:g.player.attackDamage,base:g.player.baseAttackDamage};})()`);
 assert.equal(equipmentStored.count,8);assert.equal(equipmentStored.axe.durability,7);assert.equal(equipmentStored.wood,7);assert(equipmentStored.empty);assert.equal(equipmentStored.selected,0);assert.equal(equipmentStored.attack,equipmentStored.base);
 const chestFrame=await evaluate(`(()=>{const g=wildsGame;const equipment=g.chestEquipmentGrid.children[1].classList.contains("is-selected");
   g.chestGrid.children[0].click();g.renderStorage();const chest=g.chestGrid.children[0].classList.contains("is-selected");
   const width=getComputedStyle(g.chestGrid.children[0]).outlineWidth;
   return {equipment,chest,width,oldCleared:!g.chestEquipmentGrid.children[1].classList.contains("is-selected")};})()`);
 assert.deepEqual(chestFrame,{equipment:true,chest:true,width:"2px",oldCleared:true});
 await screenshot("browser-storage-selected");
 const furnaceFrame=await evaluate(`(()=>{const g=wildsGame;g.openFurnace({fuel:0});g.inventory.equipment[0]={itemId:"raw_pork",count:3};g.inventory.equipment[1]={itemId:"coal",count:3};g.renderFurnace();
   g.furnaceEquipmentGrid.children[0].click();g.renderFurnace();const failed=g.furnaceEquipmentGrid.children[0].classList.contains("is-selected");
   g.furnaceObject.fuel=1;g.furnaceEquipmentGrid.children[0].click();const afterSmelt=g.furnaceEquipmentGrid.children[0].classList.contains("is-selected");
   g.furnaceEquipmentGrid.children[1].click();return {failed,afterSmelt,coal:g.furnaceEquipmentGrid.children[1].classList.contains("is-selected"),oldCleared:!g.furnaceEquipmentGrid.children[0].classList.contains("is-selected"),width:getComputedStyle(g.furnaceEquipmentGrid.children[1]).outlineWidth};})()`);
 assert.deepEqual(furnaceFrame,{failed:true,afterSmelt:true,coal:true,oldCleared:true,width:"2px"});
 await screenshot("browser-furnace-selected");await evaluate("wildsGame.closeFurnace()");
 const revived=await evaluate(`(()=>{const g=wildsGame;g.closeStorage();g.selectedSlot={area:"equipment",index:7};g.respawn={tx:g.player.tileX,ty:g.player.tileY};g.player.health=0;g.die();g.respawnPlayer();return g.selectedSlot;})()`);
 assert.deepEqual(revived,{area:"equipment",index:0});assert.deepEqual(errors,[]);
 console.log("Inventory browser checks passed: default held slot, empty slot persistence, hotbar switching, cross swaps, sorting, 64-stack chest and respawn.");
}finally{ws.close();}
