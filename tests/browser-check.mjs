/**
 * Browser-level smoke test for 荒野方界.
 *
 * Usage:
 *   node tests/browser-check.mjs <debug-port> <game-url>
 *
 * Chrome must already be running with --remote-debugging-port=<port>.
 * The script drives the page over the DevTools protocol, checks movement,
 * the centre-lock invariant, terrain variety, and new-world generation,
 * then writes screenshots to screenshots/.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const port = Number(process.argv[2]);
const gameUrl = process.argv[3];
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shotDir = join(root, "screenshots");

if (!Number.isFinite(port) || !gameUrl) {
  console.error("usage: node tests/browser-check.mjs <debug-port> <game-url>");
  process.exit(2);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log("  ok  " + name);
  } else {
    failed += 1;
    console.error("FAIL  " + name + (detail ? " — " + detail : ""));
  }
}

async function fetchTarget() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:" + port + "/json/list");
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find((target) => target.type === "page");
        if (page) return page;
      }
    } catch (error) {
      // Chrome is still booting.
    }
    await delay(200);
  }
  throw new Error("Chrome DevTools endpoint did not become ready");
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.consoleErrors = [];

    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);

      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
        return;
      }

      this.events.push(message);

      if (message.method === "Runtime.exceptionThrown") {
        this.consoleErrors.push(
          message.params.exceptionDetails?.exception?.description ||
          message.params.exceptionDetails?.text ||
          "uncaught exception"
        );
      }

      if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
        this.consoleErrors.push(
          message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" ")
        );
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });

    if (result.exceptionDetails) {
      const description = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
      throw new Error("Page evaluation failed: " + description);
    }

    return result.result.value;
  }

  async screenshot(path) {
    const result = await this.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    await writeFile(path, Buffer.from(result.data, "base64"));
  }
}

function openSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener("open", () => resolve(socket), { once: true });
    socket.addEventListener("error", () => reject(new Error("WebSocket connection failed")), { once: true });
  });
}

async function isReady(cdp) {
  try {
    return await cdp.evaluate("Boolean(window.wildsGame && wildsGame.player && wildsGame.world)");
  } catch (error) {
    return false;
  }
}

async function waitForGame(cdp, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await isReady(cdp)) return true;
    await delay(120);
  }
  return false;
}

const STATE_EXPRESSION = `(() => {
  const g = window.wildsGame;
  const counts = { ocean: 0, grass: 0, rock: 0 };
  const features = { tree: 0, coal: 0 };
  const names = ["ocean", "grass", "rock"];
  for (let y = g.player.tileY - 7; y <= g.player.tileY + 7; y += 1) {
    for (let x = g.player.tileX - 12; x <= g.player.tileX + 12; x += 1) {
      counts[names[g.world.terrainAt(x, y)]] += 1;
      const feature = g.world.featureAt(x, y);
      if (feature === 1) features.tree += 1;
      else if (feature === 2) features.coal += 1;
    }
  }
  const summarizeSlots = (slots) => slots.map((stack) => (
    stack ? { itemId: stack.itemId, count: stack.count, durability: stack.durability } : null
  ));
  return {
    seed: g.seed,
    seedCode: document.getElementById("seedCode").textContent,
    x: g.player.x,
    y: g.player.y,
    tileX: g.player.tileX,
    tileY: g.player.tileY,
    underfoot: g.world.terrainAt(g.player.tileX, g.player.tileY),
    isDugUnderfoot: g.world.isDug(g.player.tileX, g.player.tileY),
    featureUnderfoot: g.world.featureAt(g.player.tileX, g.player.tileY),
    terrainName: document.getElementById("terrainName").textContent,
    coordText: document.getElementById("coordReadout").textContent,
    hotbarSlotCount: document.querySelectorAll("#hotbar .inv-slot").length,
    backpackSlotCount: document.querySelectorAll("#backpackGrid .inv-slot").length,
    backpackHidden: document.getElementById("backpackOverlay").hidden,
    workbenchHidden: document.getElementById("workbenchOverlay").hidden,
    steleHidden: document.getElementById("steleOverlay").hidden,
    recipeCount: document.querySelectorAll("#recipeList .recipe-card").length,
    bagDisabled: document.getElementById("bagButton").disabled,
    detailHidden: document.getElementById("itemDetail").hidden,
    detailName: document.getElementById("itemDetailName").textContent,
    detailType: document.getElementById("itemDetailType").textContent,
    detailDescription: document.getElementById("itemDetailDescription").textContent,
    detailCount: document.getElementById("itemDetailCount").textContent,
    selectedSlot: g.selectedSlot,
    storageHidden: document.getElementById("storageOverlay").hidden,
    chestSlotCount: document.querySelectorAll("#chestGrid .inv-slot").length,
    furnaceHidden: document.getElementById("furnaceOverlay").hidden,
    furnaceFuel: g.furnaceObject ? g.furnaceObject.fuel : null,
    toastText: document.getElementById("gameToast").hidden ? "" : document.getElementById("gameToast").textContent,
    respawnButtonHidden: document.getElementById("respawnButton").hidden,
    deathNoRespawnHidden: document.getElementById("deathNoRespawn").hidden,
    deathNewGameHidden: document.getElementById("deathNewGameBtn").hidden,
    lastDeath: g.lastDeath ? { tx: g.lastDeath.tx, ty: g.lastDeath.ty } : null,
    equipmentItems: summarizeSlots(g.inventory.equipment),
    backpackItems: summarizeSlots(g.inventory.backpack),
    placedObjects: Array.from(g.placedObjects.values()).map((object) => ({
      type: object.type,
      itemId: object.itemId,
      tx: object.tx,
      ty: object.ty,
      active: Boolean(object.active)
    })),
    attackDamage: g.player.attackDamage,
    respawn: (() => {
      const point = g.isDead ? g.respawn : g.nearestRespawnStele(g.player.x, g.player.y);
      return point ? { tx: point.tx, ty: point.ty } : null;
    })(),
    baseRespawn: g.baseRespawn ? { tx: g.baseRespawn.tx, ty: g.baseRespawn.ty } : null,
    exploredCount: g.explored.size,
    mapOpen: g.mapOpen,
    mapHidden: document.getElementById("mapOverlay").hidden,
    deathHidden: document.getElementById("deathOverlay").hidden,
    deathTitle: document.getElementById("deathTitle").textContent,
    mapRespawnText: document.getElementById("mapRespawnCoords").textContent,
    minimapSize: [g.minimapCanvas.width, g.minimapCanvas.height],
    minimapVisible: getComputedStyle(document.getElementById("minimapPanel")).display !== "none",
    drops: g.drops.map((drop) => ({
      id: drop.id,
      itemId: drop.itemId,
      count: drop.count,
      durability: drop.durability,
      tx: drop.tx,
      ty: drop.ty,
      armed: drop.armed,
      lifetime: drop.expiresAt - drop.createdAt
    })),
    miningActive: Boolean(g.mining),
    miningProgress: g.mining ? g.mining.progress : 0,
    clockText: document.getElementById("gameClock").textContent,
    clockDayText: document.getElementById("dayCount").textContent,
    clockPhaseText: document.getElementById("phaseLabel").textContent,
    clockPhase: document.getElementById("gameClockBox").dataset.phase,
    clockDay: g.clock.day,
    clockHours: g.clock.hours,
    lighting: g.clock.lighting,
    clockLayout: (() => {
      const clock = document.getElementById("gameClockBox").getBoundingClientRect();
      const hud = document.querySelector(".game-hud").getBoundingClientRect();
      return {
        centerOffset: clock.left + clock.width / 2 - (hud.left + hud.width / 2),
        top: clock.top - hud.top,
        width: clock.width,
        displayed: getComputedStyle(document.getElementById("gameClockBox")).display !== "none"
      };
    })(),
    counts,
    features,
    canvasWidth: g.canvas.width,
    canvasHeight: g.canvas.height,
    playerScreenX: g.renderer.playerScreenX,
    playerScreenY: g.renderer.playerScreenY,
    cameraX: g.renderer.cameraX,
    cameraY: g.renderer.cameraY,
    health: g.player.health,
    oxygen: g.player.oxygen,
    satiety: g.player.satiety,
    satietyGraceRemaining: g.satietyGraceRemaining,
    maxHealth: g.player.maxHealth,
    maxOxygen: g.player.maxOxygen,
    maxSatiety: g.player.maxSatiety,
    isDiving: g.player.isDiving,
    healthText: document.getElementById("healthValue").textContent,
    oxygenText: document.getElementById("oxygenValue").textContent,
    satietyText: document.getElementById("satietyValue").textContent,
    poisonHours: g.player.poisonRemainingHours,
    slowHours: g.player.slowRemainingHours,
    speedFactor: g.player.speedFactor,
    sleeping: g.sleeping,
    animalTarget: g.animalTarget,
    monsterTarget: g.monsterTarget,
    audioScene: g.audio ? g.audio.scene : null,
    audioTracks: window.Wilds.MUSIC_TRACKS || [],
    chickenSound: g.audio ? g.audio.chickenSoundUrl : null,
    animalHurtCount: g.audio ? g.audio.animalHurtCount : 0,
    monsterHurtCount: g.audio ? g.audio.monsterHurtCount : 0,
    playerHurtCount: g.audio ? g.audio.playerHurtCount : 0,
    actionSounds: g.audio ? { ...g.audio.actionSounds } : null,
    mobs: g.mobs.map((mob) => ({
      id: mob.id,
      type: mob.type,
      health: mob.health,
      maxHealth: mob.maxHealth,
      monster: mob.monster,
      aggro: mob.aggro,
      dying: Boolean(mob.dying),
      tx: Math.floor(mob.x / 20),
      ty: Math.floor(mob.y / 20)
    })),
    projectiles: g.projectiles.map((projectile) => ({
      type: projectile.type,
      owner: projectile.owner,
      damage: projectile.damage
    })),
    stateText: document.getElementById("stateLabel").textContent,
    vitalsLayout: (() => {
      const panel = document.getElementById("vitalsPanel").getBoundingClientRect();
      const viewport = document.getElementById("viewport").getBoundingClientRect();
      return {
        left: panel.left - viewport.left,
        top: panel.top - viewport.top,
        width: panel.width,
        height: panel.height,
        viewportWidth: viewport.width,
        displayed: getComputedStyle(document.getElementById("vitalsPanel")).display !== "none"
      };
    })(),
    isDrowning: document.getElementById("vitalsPanel").classList.contains("is-drowning"),
    viewportDiving: g.viewport.classList.contains("is-diving"),
    urlSeed: new URL(location.href).searchParams.get("seed"),
    pageScrollWidth: document.documentElement.scrollWidth,
    pageWidth: window.innerWidth,
    hintHidden: document.getElementById("startHint").classList.contains("is-hidden"),
    docs: {
      hasStartHint: Boolean(document.getElementById("startHint")),
      hasNewWorldButton: Boolean(document.getElementById("newWorldBtn")),
      canvasPixels: [g.canvas.width, g.canvas.height],
    }
  };
})()`;

const CANVAS_LUMA_EXPRESSION = `(() => {
  const g = window.wildsGame;
  const ctx = g.canvas.getContext("2d");
  const { width, height } = g.canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let total = 0;
  let samples = 0;
  for (let y = 0; y < height; y += 8) {
    for (let x = 0; x < width; x += 8) {
      const index = (y * width + x) * 4;
      total += data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
      samples += 1;
    }
  }
  return total / samples;
})()`;

async function main() {
  await mkdir(shotDir, { recursive: true });

  const target = await fetchTarget();
  const ws = await openSocket(target.webSocketDebuggerUrl);
  const cdp = new CDP(ws);

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Page.bringToFront");

  await cdp.send("Page.navigate", { url: gameUrl });

  const ready = await waitForGame(cdp);
  check("game boots in the browser", ready);
  if (!ready) throw new Error("game did not expose wildsGame before timeout");

  await delay(700);

  const clickTile = async (tx, ty) => {
    const point = await cdp.evaluate(`(() => {
      const g = window.wildsGame;
      const rect = g.canvas.getBoundingClientRect();
      const internalX = (${tx} + 0.5) * 20 - g.renderer.cameraX;
      const internalY = (${ty} + 0.5) * 20 - g.renderer.cameraY;
      const scale = Math.max(rect.width / 480, rect.height / 300);
      const cropX = (480 * scale - rect.width) / 2;
      const cropY = (300 * scale - rect.height) / 2;
      return {
        x: rect.left + internalX * scale - cropX,
        y: rect.top + internalY * scale - cropY
      };
    })()`);

    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
      button: "none",
      buttons: 0,
    });
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
    await delay(120);
  };

  const holdTile = async (tx, ty, ms) => {
    const point = await cdp.evaluate(`(() => {
      const g = window.wildsGame;
      const rect = g.canvas.getBoundingClientRect();
      const internalX = (${tx} + 0.5) * 20 - g.renderer.cameraX;
      const internalY = (${ty} + 0.5) * 20 - g.renderer.cameraY;
      const scale = Math.max(rect.width / 480, rect.height / 300);
      const cropX = (480 * scale - rect.width) / 2;
      const cropY = (300 * scale - rect.height) / 2;
      return {
        x: rect.left + internalX * scale - cropX,
        y: rect.top + internalY * scale - cropY
      };
    })()`);

    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
      button: "none",
      buttons: 0,
    });
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await delay(ms);
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
    await delay(180);
  };

  const findPlaceTile = async () => cdp.evaluate(`(() => {
    const g = window.wildsGame;
    const candidates = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [2, 0], [-2, 0], [0, 2], [0, -2],
      [1, 1], [-1, 1], [1, -1], [-1, -1],
      [2, 1], [2, -1], [-2, 1], [-2, -1]
    ];
    for (const [dx, dy] of candidates) {
      const tx = g.player.tileX + dx;
      const ty = g.player.tileY + dy;
      const terrain = g.world.terrainAt(tx, ty);
      if ((terrain === 1 || terrain === 2) && g.world.featureAt(tx, ty) === 0 && !g.placedObjectAt(tx, ty)) {
        return { tx, ty };
      }
    }
    return null;
  })()`);

  const startScreenState = await cdp.evaluate(`(() => {
    const screen = document.getElementById("startScreen");
    const seed = document.getElementById("seedInput");
    const button = document.getElementById("startGameBtn");
    const rect = screen.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    return {
      hidden: screen.hidden,
      fullscreen: Math.abs(rect.width - window.innerWidth) < 2 && Math.abs(rect.height - window.innerHeight) < 2,
      pageHidden: getComputedStyle(document.querySelector(".page")).visibility === "hidden",
      seedValue: seed.value,
      maxLength: seed.maxLength,
      buttonCount: screen.querySelectorAll("button").length,
      buttonNearBottom: buttonRect.bottom > window.innerHeight - 100
    };
  })()`);
  check("the page opens on a full-screen start screen", startScreenState.hidden === false && startScreenState.fullscreen && startScreenState.pageHidden, JSON.stringify(startScreenState));
  check("the start screen has only the new-game button and seed input", startScreenState.buttonCount === 1, JSON.stringify(startScreenState));
  check("the start screen shows an optional seed input with no length limit", startScreenState.seedValue === "1A2B3C4D" && startScreenState.maxLength === -1, JSON.stringify(startScreenState));
  check("the new-game button sits at the bottom", startScreenState.buttonNearBottom === true, JSON.stringify(startScreenState));
  await cdp.screenshot(join(shotDir, "browser-start-screen.png"));

  await cdp.evaluate("document.getElementById('startGameBtn').click(); true");
  await delay(700);
  const startedState = await cdp.evaluate(`(() => {
    const card = document.querySelector(".game-card").getBoundingClientRect();
    return {
      startHidden: document.getElementById("startScreen").hidden,
      startMode: document.body.classList.contains("start-mode"),
      gameMode: document.body.classList.contains("game-mode"),
      pageVisible: getComputedStyle(document.querySelector(".page")).visibility !== "hidden",
      cardWidth: card.width,
      cardHeight: card.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      topbarHidden: getComputedStyle(document.querySelector(".topbar")).display === "none",
      sidebarHidden: getComputedStyle(document.querySelector(".sidebar")).display === "none",
      pageFooterHidden: getComputedStyle(document.querySelector(".page-footer")).display === "none"
    };
  })()`);
  check("starting the game leaves the start screen and reveals the game", startedState.startHidden && !startedState.startMode && startedState.pageVisible, JSON.stringify(startedState));
  check(
    "the started game fills the entire webpage",
    startedState.gameMode &&
    Math.abs(startedState.cardWidth - startedState.viewportWidth) < 2 &&
    Math.abs(startedState.cardHeight - startedState.viewportHeight) < 2 &&
    startedState.topbarHidden &&
    startedState.sidebarHidden &&
    startedState.pageFooterHidden,
    JSON.stringify(startedState)
  );

  const initial = await cdp.evaluate(STATE_EXPRESSION);
  console.log("\n  initial state:", JSON.stringify({
    seed: initial.seed.toString(16),
    tile: [initial.tileX, initial.tileY],
    counts: initial.counts,
  }));

  check("URL seed is respected", initial.seed === 0x1a2b3c4d, initial.seed.toString(16));
  check("seed is displayed in the sidebar", initial.seedCode.replace(" ", "") === "1A2B3C4D", initial.seedCode);
  check("URL keeps the seed for reloads", initial.urlSeed === "1A2B3C4D", initial.urlSeed);
  check("player spawns on grass", initial.underfoot === 1, String(initial.underfoot));
  check("HUD names the terrain underfoot", initial.terrainName === "草地", initial.terrainName);
  check("initial view contains ocean", initial.counts.ocean > 20, JSON.stringify(initial.counts));
  check("initial view contains grass", initial.counts.grass > 20, JSON.stringify(initial.counts));
  check("initial view contains rock", initial.counts.rock > 20, JSON.stringify(initial.counts));
  check("trees are generated on the opening grass", initial.features.tree > 0, JSON.stringify(initial.features));
  check("coal is generated on the opening rock", initial.features.coal > 0, JSON.stringify(initial.features));
  check("equipment bar has exactly eight slots", initial.hotbarSlotCount === 8, String(initial.hotbarSlotCount));
  check("backpack has 4 × 8 slots", initial.backpackSlotCount === 32, String(initial.backpackSlotCount));
  check("backpack starts hidden", initial.backpackHidden === true);
  check("workbench panel starts hidden", initial.workbenchHidden === true);
  check("stele panel starts hidden", initial.steleHidden === true);
  check(
    "the creation scroll starts in slot two while the empty first slot is held",
    initial.equipmentItems[0] === null &&
    initial.equipmentItems[1]?.itemId === "creation_scroll" &&
    initial.equipmentItems[1].count === 1 &&
    initial.equipmentItems.slice(2).every((slot) => slot === null) &&
    initial.selectedSlot?.area === "equipment" && initial.selectedSlot.index === 0 &&
    initial.backpackItems.every((slot) => slot === null),
    JSON.stringify({ equipment: initial.equipmentItems, selected: initial.selectedSlot })
  );
  check("item details start hidden", initial.detailHidden === true);
  check("vitals panel sits in the upper-left of the viewport", initial.vitalsLayout.displayed && initial.vitalsLayout.left < 40 && initial.vitalsLayout.top < 40, JSON.stringify(initial.vitalsLayout));
  const vitalsReadability = await cdp.evaluate(`(() => {
    const value = document.querySelector(".vital-value");
    const track = document.querySelector(".vital-track");
    const panel = document.querySelector(".vitals-panel");
    return {
      valueSize: parseFloat(getComputedStyle(value).fontSize),
      trackHeight: parseFloat(getComputedStyle(track).height),
      panelWidth: parseFloat(getComputedStyle(panel).width)
    };
  })()`);
  check(
    "health, satiety and oxygen are large and prominent",
    vitalsReadability.valueSize >= 12 &&
    vitalsReadability.trackHeight >= 8 &&
    vitalsReadability.panelWidth >= 210,
    JSON.stringify(vitalsReadability)
  );
  check("health starts full", initial.health === 100 && initial.maxHealth === 100 && initial.healthText === "100 / 100", initial.healthText);
  check("oxygen starts full", initial.oxygen === 10 && initial.maxOxygen === 10 && initial.oxygenText === "10.0 / 10", initial.oxygenText);
  check("satiety starts full and is shown in the top-left", initial.satiety === 100 && initial.maxSatiety === 100 && initial.satietyText === "100 / 100", initial.satietyText);
  check("animal and monster density targets are three per view", initial.animalTarget === 3 && initial.monsterTarget === 3, JSON.stringify({ animals: initial.animalTarget, monsters: initial.monsterTarget }));
  check(
    "the audio director has the four improved tracks plus night/combat and the chicken hurt sound",
    initial.audioTracks.length === 6 &&
    ["day1", "day2", "dawn", "dusk", "night", "combat"].every((track) => initial.audioTracks.includes(track)) &&
    initial.chickenSound === "Music/chicken.wav" &&
    initial.audioScene === "dawn",
    JSON.stringify({ tracks: initial.audioTracks, scene: initial.audioScene, chicken: initial.chickenSound })
  );
  check("player starts on land", initial.isDiving === false && initial.stateText === "陆地", initial.stateText);
  check("game clock is horizontally centred in the HUD", initial.clockLayout.displayed && Math.abs(initial.clockLayout.centerOffset) < 2, JSON.stringify(initial.clockLayout));
  check(
    "the world opens at day 1, early morning",
    initial.clockDay === 1 && initial.clockHours >= 6 && initial.clockHours < 6.2 && initial.clockPhase === "dawn" && initial.clockPhaseText === "清晨",
    JSON.stringify({ day: initial.clockDay, hours: initial.clockHours, phase: initial.clockPhase, text: initial.clockText })
  );
  check("dawn lighting includes a warm wash", initial.lighting.warm > 0.03 && initial.lighting.darkness > 0.01, JSON.stringify(initial.lighting));
  check("the clock shows a padded 24-hour time", /^06:0\d$/.test(initial.clockText), initial.clockText);
  check("main scene uses its native 480 × 300 buffer", initial.canvasWidth === 480 && initial.canvasHeight === 300);
  check("player is horizontally centred", initial.playerScreenX === 240, String(initial.playerScreenX));
  check("player is vertically centred", initial.playerScreenY === 150, String(initial.playerScreenY));
  check("player starts at screen centre", initial.x - initial.cameraX === 240 && initial.y - initial.cameraY === 150);

  await cdp.screenshot(join(shotDir, "browser-initial.png"));

  const wheelSwitch = await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.inventory.addEquipment("wood_bow", 30);
    g.renderInventory();
    const scrollIndex = g.inventory.equipment.findIndex((stack) => stack && stack.itemId === "creation_scroll");
    g.selectedSlot = { area: "equipment", index: scrollIndex };
    g.renderSelection();
    document.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true }));
    const downIndex = g.selectedSlot ? g.selectedSlot.index : -1;
    const downItem = g.inventory.getSlot("equipment", downIndex);
    document.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true }));
    const upIndex = g.selectedSlot ? g.selectedSlot.index : -1;
    const upItem = g.inventory.getSlot("equipment", upIndex);
    const bowIndex = g.inventory.equipment.findIndex((stack) => stack && stack.itemId === "wood_bow");
    if (bowIndex >= 0) g.inventory.removeSlot("equipment", bowIndex);
    g.selectedSlot = { area: "equipment", index: scrollIndex };
    g.renderInventory();
    g.renderSelection();
    g.syncHeldStats();
    return {
      downItem: downItem ? downItem.itemId : null,
      upItem: upItem ? upItem.itemId : null
    };
  })()`);
  check(
    "the mouse wheel cycles the held equipment slot",
    wheelSwitch.downItem === "wood_bow" && wheelSwitch.upItem === "creation_scroll",
    JSON.stringify(wheelSwitch)
  );

  const objectDrawOrder = await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    const order = [];
    const oldWorkbench = g.renderer.drawPlacedWorkbench;
    const oldChest = g.renderer.drawPlacedChest;
    g.renderer.drawPlacedWorkbench = () => order.push("upper");
    g.renderer.drawPlacedChest = () => order.push("lower");
    g.renderer.drawPlacedObjects([
      { type: "workbench", tx: 0, ty: 0 },
      { type: "storage_chest", tx: 0, ty: 1 }
    ], 0, 0, 0);
    g.renderer.drawPlacedWorkbench = oldWorkbench;
    g.renderer.drawPlacedChest = oldChest;
    return order;
  })()`);
  check(
    "lower fixed objects are drawn after and occlude upper fixed objects",
    objectDrawOrder.length === 2 && objectDrawOrder[0] === "upper" && objectDrawOrder[1] === "lower",
    JSON.stringify(objectDrawOrder)
  );

  await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.clock.day = 1;
    g.clock.time = 12 * 3600;
    g.player.satiety = 100;
    g.player.health = 50;
    g.player.poisonRemainingHours = 0;
    g.syncHud(true);
    return true;
  })()`);
  await delay(760);
  const dayOneNeeds = await cdp.evaluate(STATE_EXPRESSION);
  check("satiety does not drain on day one", dayOneNeeds.satiety === 100 && dayOneNeeds.satietyText === "100 / 100", dayOneNeeds.satietyText);
  check("full satiety heals a damaged player by game-hour regeneration", dayOneNeeds.health > 50.5, dayOneNeeds.health.toFixed(2));

  await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.clock.day = 2;
    g.clock.time = 6 * 3600;
    g.player.satiety = 100;
    g.player.health = 100;
    g.satietyGraceRemaining = window.Wilds.CONFIG.SATIETY_GRACE_HOURS;
    g.syncHud(true);
    return true;
  })()`);
  await delay(760);
  const dayTwoNeeds = await cdp.evaluate(STATE_EXPRESSION);
  check(
    "full satiety pauses hunger for two game hours",
    dayTwoNeeds.satiety === 100 && dayTwoNeeds.satietyGraceRemaining < 2,
    JSON.stringify({ satiety: dayTwoNeeds.satiety, grace: dayTwoNeeds.satietyGraceRemaining })
  );

  await cdp.evaluate("wildsGame.satietyGraceRemaining = 0; true");
  await delay(500);
  const afterGrace = await cdp.evaluate(STATE_EXPRESSION);
  check("satiety drains again after the five-hour grace", afterGrace.satiety < 100, afterGrace.satiety.toFixed(3));

  await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.clock.day = 1;
    g.clock.time = 6 * 3600;
    g.player.satiety = 100;
    g.player.health = 100;
    g.player.poisonRemainingHours = 0;
    g.player.slowRemainingHours = 0;
    g.player.speedFactor = 1;
    g.syncHud(true);
    return true;
  })()`);

  await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.mobs = [];
    g.projectiles = [];
    g.mobSpawnTimer = 0;
    g.player.health = 100;
    g.clock.day = 1;
    g.clock.time = 22 * 3600;
    return true;
  })()`);
  await delay(5000);
  const density = await cdp.evaluate(STATE_EXPRESSION);
  check(
    "animals spawn randomly and monsters start spawning at 20:00",
    density.mobs.some((mob) => !mob.monster) &&
    density.mobs.some((mob) => mob.monster),
    JSON.stringify({ mobs: density.mobs.map((mob) => mob.type), phase: density.clockPhase })
  );

  await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.mobs = [];
    g.projectiles = [];
    g.clock.day = 1;
    g.clock.time = 22 * 3600;
    g.spawnMob("zombie", g.player.tileX + 24, g.player.tileY);
    return true;
  })()`);
  await delay(700);
  const offscreenMonster = await cdp.evaluate(STATE_EXPRESSION);
  check(
    "monsters outside the player's view wander randomly instead of chasing",
    offscreenMonster.mobs.some((mob) => mob.type === "zombie" && mob.aggro === false),
    JSON.stringify(offscreenMonster.mobs)
  );

  await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.mobs = [];
    g.projectiles = [];
    g.clock.day = 1;
    g.clock.time = 22 * 3600;
    g.player.health = 100;
    g.spawnMob("sheep", g.player.tileX + 4, g.player.tileY);
    g.spawnMob("algorithm_chicken", g.player.tileX - 4, g.player.tileY);
    g.spawnMob("zombie", g.player.tileX + 5, g.player.tileY - 3);
    g.spawnMob("savage_archer", g.player.tileX - 5, g.player.tileY - 3);
    const zombie = g.mobs.find((mob) => mob.type === "zombie");
    if (zombie) g.damageMob(zombie, 1);
    return true;
  })()`);
  await delay(180);
  await cdp.screenshot(join(shotDir, "browser-monsters.png"));
  const combatAudio = await cdp.evaluate(STATE_EXPRESSION);
  check(
    "visible monsters switch to combat music and monster hurt has its own cry",
    combatAudio.audioScene === "combat" && combatAudio.monsterHurtCount > 0,
    JSON.stringify({ scene: combatAudio.audioScene, monsterHurts: combatAudio.monsterHurtCount })
  );

  await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.mobs = [];
    g.projectiles = [];
    g.animalTarget = 0;
    g.monsterTarget = 0;
    g.clock.day = 1;
    g.clock.time = 6 * 3600;
    g.player.health = 100;
    return true;
  })()`);

  const minimapLayout = await cdp.evaluate(`(() => {
    const panel = document.getElementById("minimapPanel").getBoundingClientRect();
    const viewport = document.getElementById("viewport").getBoundingClientRect();
    return {
      top: panel.top - viewport.top,
      right: viewport.right - panel.right,
      width: panel.width,
      height: panel.height
    };
  })()`);
  check("there is no initial respawn point", initial.respawn === null && initial.baseRespawn === null, JSON.stringify({ respawn: initial.respawn, base: initial.baseRespawn }));
  check("nearby terrain is recorded in the explored map", initial.exploredCount > 0, String(initial.exploredCount));
  check("the minimap is visible in the upper-right of the viewport", initial.minimapVisible && minimapLayout.top < 30 && minimapLayout.right < 30, JSON.stringify(minimapLayout));
  check("the minimap has a compact canvas", initial.minimapSize[0] === 132 && initial.minimapSize[1] === 88, JSON.stringify(initial.minimapSize));

  // ---------- Inventory UI ----------

  await cdp.evaluate("document.getElementById('bagButton').click(); true");
  await delay(120);
  const bagOpen = await cdp.evaluate(STATE_EXPRESSION);
  check("clicking backpack opens the backpack", bagOpen.backpackHidden === false);
  check("the open backpack still has 4 × 8 slots", bagOpen.backpackSlotCount === 32, String(bagOpen.backpackSlotCount));
  check("backpack button reflects the open state", bagOpen.bagDisabled === true);
  await cdp.screenshot(join(shotDir, "browser-backpack.png"));

  await cdp.evaluate("document.getElementById('closeBackpack').click(); true");
  await delay(120);
  const bagClosed = await cdp.evaluate(STATE_EXPRESSION);
  check("clicking exit closes the backpack", bagClosed.backpackHidden === true && bagClosed.bagDisabled === false);

  // ---------- Mine the grass underfoot with a long press ----------

  const shovelSetup = await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.inventory.addItem("wood_shovel", 1);
    g.renderInventory();
    const index = g.inventory.equipment.findIndex((stack) => stack && stack.itemId === "wood_shovel");
    document.querySelectorAll("#hotbar .inv-slot")[index].click();
    return { index };
  })()`);

  const canvasCenter = await cdp.evaluate(`(() => {
    const rect = window.wildsGame.canvas.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);

  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: canvasCenter.x,
    y: canvasCenter.y,
    button: "none",
    buttons: 0,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: canvasCenter.x,
    y: canvasCenter.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await delay(280);

  const mining = await cdp.evaluate(STATE_EXPRESSION);
  check("holding the mouse starts mining", mining.miningActive === true, JSON.stringify({ active: mining.miningActive, progress: mining.miningProgress }));
  check("mining progress advances", mining.miningProgress > 0.05, String(mining.miningProgress));
  await cdp.screenshot(join(shotDir, "browser-mining.png"));

  await delay(550);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: canvasCenter.x,
    y: canvasCenter.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
  await delay(220);

  const mined = await cdp.evaluate(STATE_EXPRESSION);
  console.log("  mining result:", JSON.stringify({
    underfoot: mined.underfoot,
    dug: mined.isDugUnderfoot,
    equipment: mined.equipmentItems,
    drops: mined.drops,
  }));

  check("mining grass leaves the terrain in place", mined.underfoot === 1, String(mined.underfoot));
  check("mined grass is marked as dug", mined.isDugUnderfoot === true);
  const grassCannotBeMined = await cdp.evaluate(
    "wildsGame.miningTargetAt(wildsGame.player.tileX, wildsGame.player.tileY) === null"
  );
  const outOfRangeTarget = await cdp.evaluate(
    "wildsGame.miningTargetAt(wildsGame.player.tileX + 3, wildsGame.player.tileY) === null"
  );
  check("dug grass cannot be mined again", grassCannotBeMined === true);
  check("resources outside two tiles cannot be mined", outOfRangeTarget === true);
  check(
    "mining creates a dirt drop on the ground instead of adding it directly to the inventory",
    !mined.equipmentItems.some((slot) => slot && slot.itemId === "dirt") &&
    mined.drops.length === 1 &&
    mined.drops[0].itemId === "dirt" &&
    mined.drops[0].count === 1 &&
    mined.drops[0].tx === mined.tileX &&
    mined.drops[0].ty === mined.tileY,
    JSON.stringify({ equipment: mined.equipmentItems, drops: mined.drops })
  );
  check(
    "the matching shovel loses one durability for one completed harvest",
    mined.equipmentItems[shovelSetup.index] &&
    mined.equipmentItems[shovelSetup.index].itemId === "wood_shovel" &&
    mined.equipmentItems[shovelSetup.index].durability === 14,
    JSON.stringify(mined.equipmentItems[shovelSetup.index])
  );
  check("a fresh drop has a one-game-day real-time lifetime", mined.drops[0] && mined.drops[0].lifetime === 300000, JSON.stringify(mined.drops[0]));
  await cdp.screenshot(join(shotDir, "browser-ground-drop.png"));

  // Step away so the drop arms, then come back to collect it.
  await cdp.evaluate("wildsGame.player.x += 40; true");
  await delay(140);
  const armedDrop = await cdp.evaluate(STATE_EXPRESSION);
  check(
    "the drop remains on the ground until approached",
    armedDrop.drops.length === 1 && !armedDrop.equipmentItems.some((slot) => slot && slot.itemId === "dirt")
  );
  check("stepping away arms the nearby drop", armedDrop.drops[0] && armedDrop.drops[0].armed === true, JSON.stringify(armedDrop.drops[0]));

  await cdp.evaluate("wildsGame.player.x -= 40; true");
  await delay(220);
  const picked = await cdp.evaluate(STATE_EXPRESSION);
  check(
    "walking back to the dirt drop collects it into the equipment bar",
    picked.drops.length === 0 &&
    picked.equipmentItems.some((slot) => slot && slot.itemId === "dirt" && slot.count === 1),
    JSON.stringify({ drops: picked.drops, equipment: picked.equipmentItems })
  );

  // ---------- Item details and swapping ----------

  const dirtSlotIndex = await cdp.evaluate(`(() => {
    return wildsGame.inventory.equipment.findIndex((stack) => stack && stack.itemId === "dirt");
  })()`);

  // Clear any held tool so a double-click starts from an unselected slot.
  await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.selectedSlot = null;
    g.syncHeldStats();
    g.renderSelection();
    return true;
  })()`);

  await cdp.evaluate(`(() => {
    const slot = document.querySelectorAll("#hotbar .inv-slot")[${dirtSlotIndex}];
    slot.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return true;
  })()`);
  await delay(100);

  const detail = await cdp.evaluate(STATE_EXPRESSION);
  check("single-clicking an item shows its details", detail.detailHidden === false);
  check("item detail shows the dirt name", detail.detailName === "土块", detail.detailName);
  check("item detail shows the material type", detail.detailType === "材料", detail.detailType);
  check("item detail shows the requested description", detail.detailDescription === "土块，材料，挖掘脚下的草地获得", detail.detailDescription);
  const equipmentDetailPlacement = await cdp.evaluate(`(() => {
    const detail = document.getElementById("itemDetail").getBoundingClientRect();
    const hotbar = document.getElementById("hotbar").getBoundingClientRect();
    return {
      detailBottom: detail.bottom,
      hotbarTop: hotbar.top,
      detailCenter: detail.left + detail.width / 2,
      hotbarCenter: hotbar.left + hotbar.width / 2,
      hidden: document.getElementById("itemDetail").hidden
    };
  })()`);
  check(
    "equipment item description appears directly above the equipment bar",
    equipmentDetailPlacement.hidden === false &&
    equipmentDetailPlacement.detailBottom <= equipmentDetailPlacement.hotbarTop + 1 &&
    Math.abs(equipmentDetailPlacement.detailCenter - equipmentDetailPlacement.hotbarCenter) < 4,
    JSON.stringify(equipmentDetailPlacement)
  );
  await cdp.screenshot(join(shotDir, "browser-item-detail.png"));

  // Double-clicking a different item while holding a tool should still
  // reveal that item's details, and the temporary swap should be undone.
  await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.selectedSlot = { area: "equipment", index: 0 };
    g.renderSelection();
    g.syncHeldStats();
    const slot = document.querySelectorAll("#hotbar .inv-slot")[${dirtSlotIndex}];
    slot.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return true;
  })()`);
  await delay(100);
  const heldDetail = await cdp.evaluate(STATE_EXPRESSION);
  check(
    "clicking while holding another item still shows the clicked item",
    heldDetail.detailName === "土块" &&
    heldDetail.equipmentItems[0] &&
    heldDetail.equipmentItems[0].itemId === "dirt" &&
    heldDetail.equipmentItems[dirtSlotIndex] &&
    heldDetail.equipmentItems[dirtSlotIndex].itemId === "creation_scroll",
    JSON.stringify({ detail: heldDetail.detailName, equipment: heldDetail.equipmentItems })
  );

  const swapTargets = await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    const slides = document.querySelectorAll("#hotbar .inv-slot");
    const dirt = g.inventory.equipment.findIndex((stack) => stack && stack.itemId === "dirt");
    const empty = g.inventory.equipment.findIndex((stack) => stack === null);
    slides[dirt].click();
    slides[empty].click();
    return { dirt, empty };
  })()`);
  await delay(100);

  const swapped = await cdp.evaluate(STATE_EXPRESSION);
  check(
    "single click + second slot swaps with an empty slot",
    swapped.equipmentItems[swapTargets.dirt] === null &&
    swapped.equipmentItems[swapTargets.empty] &&
    swapped.equipmentItems[swapTargets.empty].itemId === "dirt",
    JSON.stringify(swapped.equipmentItems)
  );
  await delay(420);

  await cdp.evaluate("document.getElementById('bagButton').click(); true");
  await delay(100);
  const crossSwapTargets = await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    const hotbar = document.querySelectorAll("#hotbar .inv-slot");
    const backpack = document.querySelectorAll("#backpackGrid .inv-slot");
    const dirt = g.inventory.equipment.findIndex((stack) => stack && stack.itemId === "dirt");
    const empty = g.inventory.backpack.findIndex((stack) => stack === null);
    hotbar[dirt].click();
    backpack[empty].click();
    return { dirt, empty };
  })()`);
  await delay(100);

  const crossSwapped = await cdp.evaluate(STATE_EXPRESSION);
  check(
    "equipment and backpack slots can exchange items while the backpack is open",
    crossSwapped.equipmentItems[crossSwapTargets.dirt] === null &&
    crossSwapped.backpackItems[crossSwapTargets.empty] &&
    crossSwapped.backpackItems[crossSwapTargets.empty].itemId === "dirt",
    JSON.stringify({ equipment: crossSwapped.equipmentItems, backpack: crossSwapped.backpackItems })
  );
  const backpackDetailPlacement = await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    const index = g.inventory.backpack.findIndex(Boolean);
    const stack = g.inventory.getSlot("backpack", index);
    g.showItemDetails(stack, true, { area: "backpack", index });
    const detail = document.getElementById("itemDetail").getBoundingClientRect();
    const panel = document.querySelector(".backpack-panel").getBoundingClientRect();
    return {
      detailBottom: detail.bottom,
      panelTop: panel.top,
      detailCenter: detail.left + detail.width / 2,
      panelCenter: panel.left + panel.width / 2,
      hidden: document.getElementById("itemDetail").hidden
    };
  })()`);
  check(
    "backpack item description appears directly above the backpack panel",
    backpackDetailPlacement.hidden === false &&
    backpackDetailPlacement.detailBottom <= backpackDetailPlacement.panelTop + 1 &&
    Math.abs(backpackDetailPlacement.detailCenter - backpackDetailPlacement.panelCenter) < 4,
    JSON.stringify(backpackDetailPlacement)
  );
  await cdp.screenshot(join(shotDir, "browser-backpack-filled.png"));

  await cdp.evaluate("document.getElementById('closeBackpack').click(); true");
  await delay(100);

  // Hold D for 850 ms. The camera should move, but the player should not.
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "d",
    code: "KeyD",
    windowsVirtualKeyCode: 68,
    nativeVirtualKeyCode: 68,
  });
  await delay(850);
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "d",
    code: "KeyD",
    windowsVirtualKeyCode: 68,
    nativeVirtualKeyCode: 68,
  });
  await delay(180);

  const moved = await cdp.evaluate(STATE_EXPRESSION);
  console.log("  moved state:", JSON.stringify({
    from: [initial.tileX, initial.tileY],
    to: [moved.tileX, moved.tileY],
    x: moved.x.toFixed(1),
    cameraX: moved.cameraX.toFixed(1),
  }));

  check("walking moves the player right", moved.x > initial.x + 20, moved.x + " vs " + initial.x);
  check("walking changes the visible tile coordinate", moved.tileX > initial.tileX, moved.tileX + " vs " + initial.tileX);
  check("walking scrolls the camera with the player", moved.cameraX > initial.cameraX + 20);
  check("the start hint dismisses after the first step", moved.hintHidden === true);
  check("player remains horizontally centred while walking", moved.playerScreenX === 240);
  check("player remains vertically centred while walking", moved.playerScreenY === 150);
  check(
    "player stays centre-locked relative to the camera",
    Math.abs((moved.x - moved.cameraX) - 240) < 0.001 &&
    Math.abs((moved.y - moved.cameraY) - 150) < 0.001
  );

  await cdp.screenshot(join(shotDir, "browser-after-walk.png"));

  // ---------- Underwater oxygen / health integration ----------

  const waterSpot = await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    const centerX = g.player.tileX;
    const centerY = g.player.tileY;
    for (let radius = 0; radius <= 80; radius += 1) {
      for (let y = -radius; y <= radius; y += 1) {
        for (let x = -radius; x <= radius; x += 1) {
          if (radius > 0 && Math.abs(x) !== radius && Math.abs(y) !== radius) continue;
          const tx = centerX + x;
          const ty = centerY + y;
          if (g.world.terrainAt(tx, ty) === 0 && g.world.waterDepthAt(tx,ty) === 2) {
            g.player.x = (tx + 0.5) * 20;
            g.player.y = (ty + 0.5) * 20;
            return { tx, ty };
          }
        }
      }
    }
    return null;
  })()`);

  check("found an ocean tile for the vitals test", waterSpot !== null, JSON.stringify(waterSpot));
  await delay(250);

  const enteredWater = await cdp.evaluate(STATE_EXPRESSION);
  check("water switches the character to the diving state", enteredWater.isDiving === true && enteredWater.stateText === "深水潜行", enteredWater.stateText);
  check("the underwater tint is active", enteredWater.viewportDiving === true);

  await cdp.evaluate("wildsGame.player.oxygen = 10; wildsGame.player.health = 100; true");
  await delay(1600);

  const oxygenDrained = await cdp.evaluate(STATE_EXPRESSION);
  console.log("  underwater state:", JSON.stringify({
    oxygen: oxygenDrained.oxygen.toFixed(2),
    health: oxygenDrained.health,
    state: oxygenDrained.stateText,
  }));

  check("oxygen drains while underwater", oxygenDrained.oxygen < 9.5 && oxygenDrained.oxygen > 8.3, oxygenDrained.oxygen.toFixed(2));
  check("health stays intact while oxygen remains", oxygenDrained.health === 100, String(oxygenDrained.health));
  check("oxygen readout updates", oxygenDrained.oxygenText !== "10.0 / 10", oxygenDrained.oxygenText);
  check("diving state reaches the HUD", oxygenDrained.stateText === "深水潜行", oxygenDrained.stateText);

  await cdp.screenshot(join(shotDir, "browser-diving.png"));

  await cdp.evaluate("wildsGame.player.oxygen = 0; wildsGame.player.health = 100; true");
  await delay(1800);

  const drowning = await cdp.evaluate(STATE_EXPRESSION);
  console.log("  drowning state:", JSON.stringify({
    oxygen: drowning.oxygen,
    health: drowning.health.toFixed(2),
    healthText: drowning.healthText,
  }));

  check("zero oxygen underwater drains health", drowning.health < 97 && drowning.health > 80, drowning.health.toFixed(2));
  check("drowning warning is shown", drowning.isDrowning === true);
  check("health readout updates", drowning.healthText !== "100 / 100", drowning.healthText);

  await cdp.screenshot(join(shotDir, "browser-drowning.png"));

  const justBeforeReturn = await cdp.evaluate(STATE_EXPRESSION);

  await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.player.x = (g.player.spawn.tx + 0.5) * 20;
    g.player.y = (g.player.spawn.ty + 0.5) * 20;
    return true;
  })()`);
  await delay(1700);

  const recovered = await cdp.evaluate(STATE_EXPRESSION);
  check("returning to land clears the diving state", recovered.isDiving === false && recovered.stateText === "陆地", recovered.stateText);
  check("oxygen recovers on land", recovered.oxygen > 0.5, recovered.oxygen.toFixed(2));
  check(
    "full satiety regenerates health on land",
    recovered.satiety === 100 && recovered.health > justBeforeReturn.health + 0.5,
    recovered.health.toFixed(2) + " vs " + justBeforeReturn.health.toFixed(2)
  );
  check("the underwater tint clears on land", recovered.viewportDiving === false);

  // ---------- Time of day and lighting ----------

  // Keep the visual-regression screenshots clean after the drowning test.
  await cdp.evaluate("wildsGame.player.health = 100; wildsGame.player.oxygen = 10; true");

  await cdp.evaluate("wildsGame.clock.setTimeOfDay(12); true");
  await delay(160);
  const noon = await cdp.evaluate(STATE_EXPRESSION);
  const noonLuma = await cdp.evaluate(CANVAS_LUMA_EXPRESSION);

  check("noon shows 12:00", noon.clockText === "12:00", noon.clockText);
  check("noon is labelled daytime", noon.clockPhase === "day" && noon.clockPhaseText === "白天", noon.clockPhaseText);
  check("daytime uses the cheerful first track", noon.audioScene === "day1", noon.audioScene);
  check("noon has no night darkness", noon.lighting.darkness < 0.01, JSON.stringify(noon.lighting));
  await cdp.screenshot(join(shotDir, "browser-noon.png"));

  await cdp.evaluate("wildsGame.clock.day = 2; wildsGame.clock.setTimeOfDay(12); true");
  await delay(140);
  const secondDay = await cdp.evaluate(STATE_EXPRESSION);
  check("the second daytime track alternates on another day", secondDay.audioScene === "day2", secondDay.audioScene);
  await cdp.evaluate("wildsGame.clock.day = 1; wildsGame.clock.setTimeOfDay(12); true");

  await cdp.evaluate("wildsGame.clock.setTimeOfDay(0); true");
  await delay(160);
  const midnight = await cdp.evaluate(STATE_EXPRESSION);
  const midnightLuma = await cdp.evaluate(CANVAS_LUMA_EXPRESSION);

  console.log("  lighting:", JSON.stringify({
    noon: { luma: Number(noonLuma.toFixed(1)), darkness: Number(noon.lighting.darkness.toFixed(3)) },
    midnight: { luma: Number(midnightLuma.toFixed(1)), darkness: Number(midnight.lighting.darkness.toFixed(3)) },
  }));

  check("midnight shows 00:00", midnight.clockText === "00:00", midnight.clockText);
  check("midnight is labelled night", midnight.clockPhase === "night" && midnight.clockPhaseText === "夜晚", midnight.clockPhaseText);
  check("nighttime uses the quiet night track", midnight.audioScene === "night", midnight.audioScene);
  check("midnight applies heavy darkness", midnight.lighting.darkness > 0.7, JSON.stringify(midnight.lighting));
  check("the rendered night is clearly darker than noon", midnightLuma < noonLuma * 0.7, noonLuma.toFixed(1) + " -> " + midnightLuma.toFixed(1));
  await cdp.screenshot(join(shotDir, "browser-night.png"));

  await cdp.evaluate("wildsGame.clock.setTimeOfDay(18.5); true");
  await delay(160);
  const dusk = await cdp.evaluate(STATE_EXPRESSION);

  check("dusk is labelled and lit warmly", dusk.clockPhase === "dusk" && dusk.clockPhaseText === "黄昏" && dusk.lighting.warm > 0.1, JSON.stringify({ phase: dusk.clockPhaseText, lighting: dusk.lighting }));
  check("dusk uses the soft D-minor string track", dusk.audioScene === "dusk", dusk.audioScene);
  await cdp.screenshot(join(shotDir, "browser-dusk.png"));

  // ---------- Tree / coal / rock drop mapping ----------

  const resourceResults = await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.drops = [];
    const startX = g.player.tileX;
    const startY = g.player.tileY;
    const found = { tree: null, coal: null, rock: null };

    for (let oy = -60; oy <= 60 && (!found.tree || !found.coal || !found.rock); oy += 1) {
      for (let ox = -60; ox <= 60 && (!found.tree || !found.coal || !found.rock); ox += 1) {
        const tx = startX + ox;
        const ty = startY + oy;
        const terrain = g.world.terrainAt(tx, ty);
        const feature = g.world.featureAt(tx, ty);
        if (terrain === 1 && feature === 1 && !found.tree) found.tree = { tx, ty };
        if (terrain === 2 && feature === 2 && !found.coal) found.coal = { tx, ty };
        if (terrain === 2 && feature === 0 && !g.world.isDug(tx, ty) && !found.rock) found.rock = { tx, ty };
      }
    }

    if (!found.tree || !found.coal || !found.rock) {
      return { error: "resource target not found", found };
    }

    const summarizeDrop = (drop) => drop ? {
      itemId: drop.itemId,
      count: drop.count,
      tx: drop.tx,
      ty: drop.ty,
      armed: drop.armed,
      lifetime: drop.expiresAt - drop.createdAt
    } : null;

    const mine = (target, kind) => {
      g.player.x = (target.tx + 0.5) * 20;
      g.player.y = (target.ty + 0.5) * 20;
      const targetBefore = g.miningTargetAt(target.tx, target.ty);
      const terrainBefore = g.world.terrainAt(target.tx, target.ty);
      const featureBefore = g.world.featureAt(target.tx, target.ty);
      const dropCountBefore = g.drops.length;
      g.finishMining({ tx: target.tx, ty: target.ty, kind });
      const newDrop = g.drops.length > dropCountBefore ? g.drops[g.drops.length - 1] : null;
      return {
        targetKindBefore: targetBefore ? targetBefore.kind : null,
        terrainBefore,
        terrainAfter: g.world.terrainAt(target.tx, target.ty),
        featureBefore,
        featureAfter: g.world.featureAt(target.tx, target.ty),
        isDug: g.world.isDug(target.tx, target.ty),
        targetAfter: g.miningTargetAt(target.tx, target.ty),
        drop: summarizeDrop(newDrop)
      };
    };

    const tree = mine(found.tree, "tree");
    const coal = mine(found.coal, "coal");
    const rock = mine(found.rock, "rock");

    g.player.x = (g.player.spawn.tx + 0.5) * 20;
    g.player.y = (g.player.spawn.ty + 0.5) * 20;
    g.clock.setTimeOfDay(12);

    return {
      tree,
      coal,
      rock,
      woodInInventory: g.inventory.countItem("wood"),
      coalInInventory: g.inventory.countItem("coal"),
      rockInInventory: g.inventory.countItem("rock"),
      groundDrops: g.drops.map(summarizeDrop)
    };
  })()`);

  check("tree target opens as a tree and drops three wood on the ground", resourceResults.tree && resourceResults.tree.targetKindBefore === "tree" && resourceResults.tree.featureAfter === 0 && resourceResults.tree.terrainAfter === 1 && resourceResults.tree.drop && resourceResults.tree.drop.itemId === "wood" && resourceResults.tree.drop.count === 3, JSON.stringify(resourceResults.tree));
  check("coal target opens as coal and drops one coal on the ground", resourceResults.coal && resourceResults.coal.targetKindBefore === "coal" && resourceResults.coal.featureAfter === 0 && resourceResults.coal.terrainAfter === 2 && resourceResults.coal.drop && resourceResults.coal.drop.itemId === "coal" && resourceResults.coal.drop.count === 1, JSON.stringify(resourceResults.coal));
  check("rock target drops one rock and marks the ground dug", resourceResults.rock && resourceResults.rock.targetKindBefore === "rock" && resourceResults.rock.isDug === true && resourceResults.rock.terrainAfter === 2 && resourceResults.rock.drop && resourceResults.rock.drop.itemId === "rock" && resourceResults.rock.drop.count === 1, JSON.stringify(resourceResults.rock));
  check("dug rock cannot be mined again", resourceResults.rock && resourceResults.rock.targetAfter === null, JSON.stringify(resourceResults.rock && resourceResults.rock.targetAfter));
  check(
    "mined drops stay on the ground until approached",
    resourceResults.woodInInventory === 0 &&
    resourceResults.coalInInventory === 0 &&
    resourceResults.rockInInventory === 0 &&
    resourceResults.groundDrops.length === 3,
    JSON.stringify(resourceResults.groundDrops)
  );

  await delay(150);
  await cdp.screenshot(join(shotDir, "browser-resources.png"));

  // ---------- Right-click drops and real-time expiry ----------

  const rightClickSetup = await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.drops = [];
    g.player.facing = "right";
    g.inventory.addItem("wood", 3);
    g.renderInventory();
    const index = g.inventory.equipment.findIndex((stack) => stack && stack.itemId === "wood");
    return {
      index,
      tx: g.player.tileX + 2,
      ty: g.player.tileY
    };
  })()`);

  await cdp.evaluate(`(() => {
    const slot = document.querySelectorAll("#hotbar .inv-slot")[${rightClickSetup.index}];
    slot.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }));
    return true;
  })()`);
  await delay(120);

  const rightDropped = await cdp.evaluate(STATE_EXPRESSION);
  const rightDrop = rightDropped.drops[0];
  check("right-clicking an inventory item creates a ground drop", rightDrop && rightDrop.itemId === "wood" && rightDrop.count === 3, JSON.stringify(rightDropped.drops));
  check("the right-click drop lands two tiles in front", rightDrop && rightDrop.tx === rightClickSetup.tx && rightDrop.ty === rightClickSetup.ty, JSON.stringify({ drop: rightDrop, expected: rightClickSetup }));
  check("the right-clicked slot is emptied", rightDropped.equipmentItems[rightClickSetup.index] === null, JSON.stringify(rightDropped.equipmentItems[rightClickSetup.index]));
  check("right-click drops use the same one-day lifetime", rightDrop && rightDrop.lifetime === 300000, JSON.stringify(rightDrop));
  await cdp.screenshot(join(shotDir, "browser-right-click-drop.png"));

  await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.player.x = (${rightDrop.tx} + 0.5) * 20;
    g.player.y = (${rightDrop.ty} + 0.5) * 20;
    return true;
  })()`);
  await delay(200);

  const rightPicked = await cdp.evaluate(STATE_EXPRESSION);
  check(
    "approaching the right-click drop picks it up again",
    rightPicked.drops.length === 0 && rightPicked.equipmentItems[rightClickSetup.index] && rightPicked.equipmentItems[rightClickSetup.index].itemId === "wood" && rightPicked.equipmentItems[rightClickSetup.index].count === 3,
    JSON.stringify({ drops: rightPicked.drops, equipment: rightPicked.equipmentItems[rightClickSetup.index] })
  );

  const expirySetup = await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.player.facing = "left";
    g.inventory.addItem("coal", 1);
    g.renderInventory();
    const index = g.inventory.equipment.findIndex((stack) => stack && stack.itemId === "coal");
    return { index };
  })()`);

  await cdp.evaluate(`(() => {
    const slot = document.querySelectorAll("#hotbar .inv-slot")[${expirySetup.index}];
    slot.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }));
    return true;
  })()`);
  await delay(100);

  const expiryLife = await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    const drop = g.drops[g.drops.length - 1];
    if (!drop) return null;
    const lifetime = drop.expiresAt - drop.createdAt;
    drop.expiresAt = performance.now() + 150;
    return { lifetime, itemId: drop.itemId, count: drop.count };
  })()`);
  await delay(350);

  const expired = await cdp.evaluate(STATE_EXPRESSION);
  check("dropped items expire after one game day", expiryLife && expiryLife.lifetime === 300000 && expiryLife.itemId === "coal" && expiryLife.count === 1, JSON.stringify(expiryLife));
  check("an expired drop is removed from the world", expired.drops.length === 0, JSON.stringify(expired.drops));

  // ---------- New world resets vitals ----------

  const beforeNewWorld = await cdp.evaluate(STATE_EXPRESSION);
  await cdp.evaluate("document.getElementById('newWorldBtn').click(); true");
  await delay(700);

  const afterNewWorld = await cdp.evaluate(STATE_EXPRESSION);
  console.log("  new world:", JSON.stringify({
    seed: afterNewWorld.seed.toString(16),
    tile: [afterNewWorld.tileX, afterNewWorld.tileY],
    counts: afterNewWorld.counts,
  }));

  check("new world changes the seed", afterNewWorld.seed !== beforeNewWorld.seed);
  check("new world resets the player to grass", afterNewWorld.underfoot === 1, String(afterNewWorld.underfoot));
  check(
    "new world clears the respawn point until a stele is activated",
    afterNewWorld.respawn === null && afterNewWorld.baseRespawn === null,
    JSON.stringify({ respawn: afterNewWorld.respawn, base: afterNewWorld.baseRespawn })
  );
  check("new world starts with a fresh explored map", afterNewWorld.exploredCount > 0);
  check("new world restores full health and oxygen", afterNewWorld.health === 100 && afterNewWorld.oxygen === 10, JSON.stringify({ health: afterNewWorld.health, oxygen: afterNewWorld.oxygen }));
  check("new world starts on land", afterNewWorld.isDiving === false && afterNewWorld.stateText === "陆地", afterNewWorld.stateText);
  check(
    "new world resets the clock to day 1 morning",
    afterNewWorld.clockDay === 1 && afterNewWorld.clockHours >= 6 && afterNewWorld.clockHours < 6.3 && afterNewWorld.clockPhase === "dawn",
    JSON.stringify({ day: afterNewWorld.clockDay, hours: afterNewWorld.clockHours, phase: afterNewWorld.clockPhase })
  );
  check("new world seed is written to the URL", afterNewWorld.urlSeed === afterNewWorld.seed.toString(16).toUpperCase().padStart(8, "0"));
  check("new world remains centre-locked", afterNewWorld.playerScreenX === 240 && afterNewWorld.playerScreenY === 150);
  check(
    "new world opening view introduces all three terrains",
    afterNewWorld.counts.ocean >= 20 && afterNewWorld.counts.grass >= 20 && afterNewWorld.counts.rock >= 20,
    JSON.stringify(afterNewWorld.counts)
  );

  await cdp.screenshot(join(shotDir, "browser-new-world.png"));

  // N is available for skill binding without regenerating the world.
  const seedBeforeN = afterNewWorld.seed;
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "n",
    code: "KeyN",
    windowsVirtualKeyCode: 78,
    nativeVirtualKeyCode: 78,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "n",
    code: "KeyN",
    windowsVirtualKeyCode: 78,
    nativeVirtualKeyCode: 78,
  });
  await delay(500);
  const afterN = await cdp.evaluate(STATE_EXPRESSION);
  check("N does not regenerate the world", afterN.seed === seedBeforeN);

  // ---------- Workbench placement and crafting ----------

  const workbenchSetup = await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.placedObjects.clear();
    g.drops = [];
    g.clock.setTimeOfDay(12);
    g.inventory.equipment.fill(null);
    g.inventory.backpack.fill(null);
    g.selectedSlot = null;
    g.syncHeldStats();
    g.inventory.addItem("workbench", 1);
    g.renderInventory();
    document.querySelectorAll("#hotbar .inv-slot")[0].click();
    return true;
  })()`);

  const workbenchTile = await findPlaceTile();
  check("a nearby ground tile is available for the workbench", Boolean(workbenchTile), JSON.stringify(workbenchTile));
  if (!workbenchTile) throw new Error("no workbench placement tile");

  await clickTile(workbenchTile.tx, workbenchTile.ty);
  const benchPlaced = await cdp.evaluate(STATE_EXPRESSION);
  check(
    "selecting the workbench and left-clicking ground places it",
    benchPlaced.placedObjects.some((object) => object.type === "workbench" && object.tx === workbenchTile.tx && object.ty === workbenchTile.ty),
    JSON.stringify(benchPlaced.placedObjects)
  );
  check(
    "placing the workbench removes it from the equipment bar",
    benchPlaced.equipmentItems.every((slot) => slot === null),
    JSON.stringify(benchPlaced.equipmentItems)
  );

  await clickTile(workbenchTile.tx, workbenchTile.ty);
  const benchOpen = await cdp.evaluate(STATE_EXPRESSION);
  check("clicking the placed workbench opens its crafting panel", benchOpen.workbenchHidden === false);
  check("the workbench hides recipes until a related material is held", benchOpen.recipeCount === 0, String(benchOpen.recipeCount));
  check("the workbench disables the backpack button while open", benchOpen.bagDisabled === true);
  const emptyRecipeText = await cdp.evaluate(
    "document.querySelector('#recipeList .recipe-empty')?.textContent || ''"
  );
  check("the workbench shows an empty state when no related material is held", emptyRecipeText.includes("没有持有相关材料"), emptyRecipeText);
  await cdp.evaluate("wildsGame.craftRecipe('recipe_wood_axe'); true");

  const woodOnly = await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.inventory.addItem("wood", 5);
    g.renderInventory();
    const cards = Array.from(document.querySelectorAll("#recipeList .recipe-card"));
    return {
      names: cards.map((card) => card.querySelector(".recipe-name").textContent),
      available: cards.filter((card) => card.classList.contains("is-available")).length,
      unavailable: cards.filter((card) => card.classList.contains("is-unavailable")).length,
      disabled: cards.filter((card) => card.querySelector(".craft-button").disabled).length
    };
  })()`);
  check(
    "recipes are shown when the player holds any one of their materials",
    woodOnly.names.length === 21 &&
    ["木斧头", "石斧头", "舒服的床", "木弓", "储物箱", "夸赞斌神的石碑"].every((name) => woodOnly.names.includes(name)) &&
    !woodOnly.names.includes("复活石碑") &&
    !woodOnly.names.includes("熔炼炉"),
    JSON.stringify(woodOnly)
  );
  check(
    "unavailable recipes are visibly disabled while craftable recipes differ",
    woodOnly.available === 6 && woodOnly.unavailable === 15 && woodOnly.disabled === 15,
    JSON.stringify(woodOnly)
  );
  await cdp.screenshot(join(shotDir, "browser-workbench-filtered.png"));

  await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.inventory.addItem("wood", 7);
    g.inventory.addItem("rock", 10);
    g.inventory.addItem("coal", 4);
    g.inventory.addItem("dirt", 4);
    g.inventory.addItem("wool", 1);
    g.inventory.addItem("silk", 2);
    g.renderInventory();
    return true;
  })()`);

  const recipeNames = await cdp.evaluate(`(() => {
    return Array.from(document.querySelectorAll("#recipeList .recipe-name")).map((node) => node.textContent);
  })()`);
  check(
    "the recipe list contains all requested items when all materials are present",
    recipeNames.length === 24 &&
    ["墙", "木板砖", "屋顶", "木门", "木栅栏", "木栅栏门", "木斧头", "石斧头", "木镐子", "石镐子", "木铲子", "石铲子", "火把", "木剑", "石剑", "夸赞斌神的石碑", "复活石碑", "舒服的床", "木弓", "储物箱", "熔炼炉"]
      .every((name) => recipeNames.includes(name)),
    JSON.stringify(recipeNames)
  );

  const recipeDetail = await cdp.evaluate(`(() => {
    const card = document.querySelector('.recipe-card[data-recipe="recipe_wood_axe"]');
    card.click();
    return {
      hidden: document.getElementById("itemDetail").hidden,
      name: document.getElementById("itemDetailName").textContent,
      description: document.getElementById("itemDetailDescription").textContent
    };
  })()`);
  check(
    "clicking an item in the workbench shows its description",
    recipeDetail.hidden === false &&
    recipeDetail.name === "木斧头" &&
    recipeDetail.description === "装备，对树木使用，可以加快砍伐速度",
    JSON.stringify(recipeDetail)
  );
  await cdp.screenshot(join(shotDir, "browser-workbench.png"));

  const craftInfo = await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    const button = document.querySelector('#recipeList .craft-button[data-recipe="recipe_wood_axe"]');
    const enabled = button && !button.disabled;
    const before = {
      wood: g.inventory.countItem("wood"),
      rock: g.inventory.countItem("rock"),
      coal: g.inventory.countItem("coal"),
      dirt: g.inventory.countItem("dirt")
    };
    if (button) button.click();

    const axe = g.inventory.equipment.find((stack) => stack && stack.itemId === "wood_axe");
    const fill = document.querySelector('#hotbar .inv-slot[data-item="wood_axe"] .durability-fill');
    return {
      enabled,
      before,
      wood: g.inventory.countItem("wood"),
      rock: g.inventory.countItem("rock"),
      coal: g.inventory.countItem("coal"),
      dirt: g.inventory.countItem("dirt"),
      axe: axe ? { durability: axe.durability } : null,
      barClass: fill ? fill.className : null,
      barWidth: fill ? fill.style.width : null,
      feedback: document.getElementById("workbenchFeedback").textContent
    };
  })()`);

  check("the craft button is enabled when materials are sufficient", craftInfo.enabled === true);
  check("crafting an axe consumes exactly five wood", craftInfo.before.wood === 12 && craftInfo.wood === 7, JSON.stringify(craftInfo));
  check("crafting does not consume unrelated materials", craftInfo.rock === 10 && craftInfo.coal === 4 && craftInfo.dirt === 4, JSON.stringify(craftInfo));
  check("the crafted axe appears with full durability", craftInfo.axe && craftInfo.axe.durability === 15, JSON.stringify(craftInfo.axe));
  check(
    "the crafted axe shows a full green durability bar",
    craftInfo.barClass && craftInfo.barClass.includes("is-good") && parseFloat(craftInfo.barWidth) === 100,
    JSON.stringify({ className: craftInfo.barClass, width: craftInfo.barWidth })
  );
  check("crafting gives visible feedback", craftInfo.feedback.includes("木斧头"), craftInfo.feedback);
  await cdp.screenshot(join(shotDir, "browser-workbench-ready.png"));

  const durabilityColors = await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    const index = g.inventory.equipment.findIndex((stack) => stack && stack.itemId === "wood_axe");
    const axe = g.inventory.getSlot("equipment", index);
    const read = (value) => {
      axe.durability = value;
      g.renderInventory();
      const slot = document.querySelectorAll("#hotbar .inv-slot")[index];
      const fill = slot.querySelector(".durability-fill");
      return fill ? fill.className : null;
    };
    return { green: read(11), yellow: read(10), red: read(4) };
  })()`);
  check("durability above 70% is green", durabilityColors.green && durabilityColors.green.includes("is-good"), durabilityColors.green);
  check("durability from 30% to 70% is yellow", durabilityColors.yellow && durabilityColors.yellow.includes("is-warn"), durabilityColors.yellow);
  check("durability below 30% is red", durabilityColors.red && durabilityColors.red.includes("is-bad"), durabilityColors.red);

  await cdp.evaluate("document.getElementById('closeWorkbench').click(); true");
  await delay(100);
  const benchClosed = await cdp.evaluate(STATE_EXPRESSION);
  check("the workbench closes with the exit button", benchClosed.workbenchHidden === true && benchClosed.bagDisabled === false);

  const backpackDurability = await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.inventory.backpack[0] = { itemId: "stone_axe", count: 1, durability: 6 };
    g.renderInventory();
    const fill = document.querySelector('#backpackGrid .inv-slot[data-item="stone_axe"] .durability-fill');
    return fill ? { className: fill.className, width: fill.style.width } : null;
  })()`);
  check(
    "durability bars are also shown inside the backpack",
    backpackDurability &&
    backpackDurability.className.includes("is-bad") &&
    parseFloat(backpackDurability.width) === 20,
    JSON.stringify(backpackDurability)
  );
  await cdp.screenshot(join(shotDir, "browser-durability.png"));

  // ---------- Tool speeds, durability and equipment drops ----------

  const profiles = await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.inventory.equipment.fill(null);
    g.inventory.backpack.fill(null);
    g.selectedSlot = null;
    g.syncHeldStats();
    g.renderInventory();

    const bare = g.miningProfile("dirt").duration;
    const equip = (itemId, kind, durability) => {
      g.inventory.addEquipment(itemId, durability);
      const index = g.inventory.equipment.findIndex((stack) => stack && stack.itemId === itemId);
      g.selectedSlot = { area: "equipment", index };
      g.syncHeldStats();
      const duration = g.miningProfile(kind).duration;
      g.selectedSlot = null;
      g.syncHeldStats();
      return duration;
    };

    const result = {
      bare,
      woodAxe: equip("wood_axe", "tree", 15),
      stoneAxe: equip("stone_axe", "tree", 30),
      woodShovel: equip("wood_shovel", "dirt", 15),
      stoneShovel: equip("stone_shovel", "dirt", 30),
      stonePickaxe: equip("stone_pickaxe", "rock", 30)
    };

    const axeIndex = g.inventory.equipment.findIndex((stack) => stack && stack.itemId === "wood_axe");
    g.selectedSlot = { area: "equipment", index: axeIndex };
    g.syncHeldStats();
    result.axeOnDirt = g.miningProfile("dirt").duration;

    g.inventory.addEquipment("stone_sword", 60);
    const swordIndex = g.inventory.equipment.findIndex((stack) => stack && stack.itemId === "stone_sword");
    g.selectedSlot = { area: "equipment", index: swordIndex };
    g.syncHeldStats();
    result.attackDamage = g.player.attackDamage;

    const shovelIndex = g.inventory.equipment.findIndex((stack) => stack && stack.itemId === "stone_shovel");
    const shovel = g.inventory.getSlot("equipment", shovelIndex);
    shovel.durability = 1;
    g.selectedSlot = { area: "equipment", index: shovelIndex };
    g.syncHeldStats();
    g.consumeToolDurability({ area: "equipment", index: shovelIndex, itemId: "stone_shovel" });
    result.broken = g.inventory.getSlot("equipment", shovelIndex) === null;
    result.attackAfterBreak = g.player.attackDamage;

    g.selectedSlot = null;
    g.syncHeldStats();
    return result;
  })()`);

  check("bare-hand mining takes four times the normal duration", profiles.bare === 2600, String(profiles.bare));
  check("a wood axe restores normal tree speed", profiles.woodAxe === 650, String(profiles.woodAxe));
  check("a stone axe is 1.5× normal tree speed", Math.abs(profiles.stoneAxe - 433.333) < 1, String(profiles.stoneAxe));
  check("a wood shovel restores normal grass speed", profiles.woodShovel === 650, String(profiles.woodShovel));
  check("a stone shovel is 1.5× normal grass speed", Math.abs(profiles.stoneShovel - 433.333) < 1, String(profiles.stoneShovel));
  check("a stone pickaxe is 1.5× normal rock speed", Math.abs(profiles.stonePickaxe - 433.333) < 1, String(profiles.stonePickaxe));
  check("using an axe on dirt stays at bare-hand speed", profiles.axeOnDirt === 2600, String(profiles.axeOnDirt));
  check("holding a stone sword gives 5 + 15 attack damage", profiles.attackDamage === 20, String(profiles.attackDamage));
  check("a tool at zero durability disappears", profiles.broken === true);

  const equipmentDropSetup = await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.inventory.equipment.fill(null);
    g.inventory.backpack.fill(null);
    g.selectedSlot = null;
    g.syncHeldStats();
    g.inventory.addEquipment("stone_sword", 42);
    g.renderInventory();
    g.player.facing = "right";
    const index = g.inventory.equipment.findIndex((stack) => stack && stack.itemId === "stone_sword");
    const slot = document.querySelectorAll("#hotbar .inv-slot")[index];
    slot.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }));
    return { index, tx: g.player.tileX + 2, ty: g.player.tileY };
  })()`);
  await delay(140);

  const equipmentDropped = await cdp.evaluate(STATE_EXPRESSION);
  check(
    "equipment can be dropped and keeps its durability on the ground",
    equipmentDropped.drops.length === 1 &&
    equipmentDropped.drops[0].itemId === "stone_sword" &&
    equipmentDropped.drops[0].durability === 42 &&
    equipmentDropped.equipmentItems[equipmentDropSetup.index] === null,
    JSON.stringify(equipmentDropped.drops)
  );

  await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.player.x = (${equipmentDropped.drops[0].tx} + 0.5) * 20;
    g.player.y = (${equipmentDropped.drops[0].ty} + 0.5) * 20;
    return true;
  })()`);
  await delay(220);
  const equipmentPicked = await cdp.evaluate(STATE_EXPRESSION);
  check(
    "picked-up equipment keeps the same durability",
    equipmentPicked.drops.length === 0 &&
    equipmentPicked.equipmentItems.some((slot) => slot && slot.itemId === "stone_sword" && slot.durability === 42),
    JSON.stringify(equipmentPicked.equipmentItems)
  );

  // ---------- Torch lighting ----------

  await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.inventory.equipment.fill(null);
    g.inventory.backpack.fill(null);
    g.selectedSlot = null;
    g.syncHeldStats();
    g.inventory.addItem("torch", 2);
    g.renderInventory();
    const index = g.inventory.equipment.findIndex((stack) => stack && stack.itemId === "torch");
    document.querySelectorAll("#hotbar .inv-slot")[index].click();
    return true;
  })()`);

  const torchTile = await findPlaceTile();
  check("a nearby ground tile is available for the torch", Boolean(torchTile));
  if (!torchTile) throw new Error("no torch placement tile");

  await clickTile(torchTile.tx, torchTile.ty);
  const torchPlaced = await cdp.evaluate(STATE_EXPRESSION);
  check(
    "torches can be placed on the ground",
    torchPlaced.placedObjects.some((object) => object.type === "torch" && object.tx === torchTile.tx && object.ty === torchTile.ty),
    JSON.stringify(torchPlaced.placedObjects)
  );
  check(
    "placing a torch consumes one torch from its stack",
    torchPlaced.equipmentItems.some((slot) => slot && slot.itemId === "torch" && slot.count === 1),
    JSON.stringify(torchPlaced.equipmentItems)
  );

  await cdp.evaluate("wildsGame.clock.setTimeOfDay(0); true");
  await delay(320);
  await cdp.screenshot(join(shotDir, "browser-torch-night.png"));

  const torchLightInfo = await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    const torch = Array.from(g.placedObjects.values()).find((object) => object.type === "torch");
    const cx = Math.round((torch.tx + 0.5) * 20 - g.renderer.cameraX);
    const cy = Math.round((torch.ty + 0.5) * 20 - g.renderer.cameraY);
    const ctx = g.canvas.getContext("2d");
    const data = ctx.getImageData(0, 0, g.canvas.width, g.canvas.height).data;

    const averageRing = () => {
      let total = 0;
      let samples = 0;
      for (let dy = -40; dy <= 40; dy += 2) {
        for (let dx = -40; dx <= 40; dx += 2) {
          const radius = Math.hypot(dx, dy);
          if (radius < 15 || radius > 40) continue;
          const x = Math.round((cx + dx) * g.renderer.renderScale);
          const y = Math.round((cy + dy) * g.renderer.renderScale);
          if (x < 0 || y < 0 || x >= g.canvas.width || y >= g.canvas.height) continue;
          const index = (y * g.canvas.width + x) * 4;
          total += data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
          samples += 1;
        }
      }
      return samples > 0 ? total / samples : 0;
    };

    const lit = averageRing();
    g.placedObjects.delete(torch.storageKey || window.Wilds.Buildings.key(torch));
    return { lit, cx, cy };
  })()`);

  await delay(160);
  const torchUnlit = await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    const cx = ${torchLightInfo.cx};
    const cy = ${torchLightInfo.cy};
    const ctx = g.canvas.getContext("2d");
    const data = ctx.getImageData(0, 0, g.canvas.width, g.canvas.height).data;
    let total = 0;
    let samples = 0;
    for (let dy = -40; dy <= 40; dy += 2) {
      for (let dx = -40; dx <= 40; dx += 2) {
        const radius = Math.hypot(dx, dy);
        if (radius < 15 || radius > 40) continue;
        const x = Math.round((cx + dx) * g.renderer.renderScale);
        const y = Math.round((cy + dy) * g.renderer.renderScale);
        if (x < 0 || y < 0 || x >= g.canvas.width || y >= g.canvas.height) continue;
        const index = (y * g.canvas.width + x) * 4;
        total += data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
        samples += 1;
      }
    }
    return samples > 0 ? total / samples : 0;
  })()`);

  check(
    "a torch brightens the area around it at night",
    torchLightInfo.lit > torchUnlit + 0.5,
    JSON.stringify({ lit: torchLightInfo.lit, unlit: torchUnlit })
  );

  // ---------- Stele ----------

  await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.clock.setTimeOfDay(12);
    g.inventory.equipment.fill(null);
    g.inventory.backpack.fill(null);
    g.selectedSlot = null;
    g.syncHeldStats();
    g.inventory.addItem("stele", 1);
    g.renderInventory();
    const index = g.inventory.equipment.findIndex((stack) => stack && stack.itemId === "stele");
    document.querySelectorAll("#hotbar .inv-slot")[index].click();
    return true;
  })()`);

  const steleTile = await findPlaceTile();
  check("a nearby ground tile is available for the stele", Boolean(steleTile));
  if (!steleTile) throw new Error("no stele placement tile");

  await clickTile(steleTile.tx, steleTile.ty);
  const stelePlaced = await cdp.evaluate(STATE_EXPRESSION);
  check(
    "the stele can be placed on the ground",
    stelePlaced.placedObjects.some((object) => object.type === "stele" && object.tx === steleTile.tx && object.ty === steleTile.ty),
    JSON.stringify(stelePlaced.placedObjects)
  );
  check(
    "placing the stele consumes the only stele item",
    stelePlaced.equipmentItems.every((slot) => slot === null) && stelePlaced.backpackItems.every((slot) => slot === null),
    JSON.stringify({ equipment: stelePlaced.equipmentItems, backpack: stelePlaced.backpackItems })
  );
  await cdp.screenshot(join(shotDir, "browser-stele-object.png"));

  await clickTile(steleTile.tx, steleTile.ty);
  const steleOpen = await cdp.evaluate(STATE_EXPRESSION);
  check("clicking the placed stele opens its inscription", steleOpen.steleHidden === false);
  const steleLayout = await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    const panel = document.querySelector(".stele-panel").getBoundingClientRect();
    const cap = document.querySelector(".stele-cap").getBoundingClientRect();
    const base = document.querySelector(".stele-base").getBoundingClientRect();
    const hotbar = g.hotbar.getBoundingClientRect();
    return {
      capTop: cap.top,
      baseTop: base.top,
      baseBottom: base.bottom,
      panelTop: panel.top,
      panelBottom: panel.bottom,
      hotbarTop: hotbar.top
    };
  })()`);
  check(
    "the stele cap and plinth are both visible above the equipment bar",
    steleLayout.capTop >= steleLayout.panelTop - 1 &&
    steleLayout.baseTop >= steleLayout.panelTop - 1 &&
    steleLayout.baseBottom <= steleLayout.panelBottom + 1 &&
    steleLayout.baseBottom <= steleLayout.hotbarTop + 1,
    JSON.stringify(steleLayout)
  );
  const steleContent = await cdp.evaluate(`(() => ({
    title: document.getElementById("steleTitle").textContent,
    text: document.getElementById("steleText").textContent
  }))()`);
  check(
    "the stele shows the requested inscription",
    steleContent.title === "夸赞斌神的石碑" &&
    steleContent.text.includes("蓝星神秘大陆中永远的神") &&
    steleContent.text.includes("`#include`") &&
    steleContent.text.includes("他是在替这个宇宙维护正确性。"),
    JSON.stringify({ title: steleContent.title, length: steleContent.text.length })
  );
  await cdp.screenshot(join(shotDir, "browser-stele.png"));
  await cdp.evaluate("document.getElementById('closeStele').click(); true");
  await delay(100);

  // A short click opens the object; a long press mines it back into a drop.
  await cdp.evaluate("wildsGame.drops = []; true");
  await holdTile(steleTile.tx, steleTile.ty, 2850);
  const steleMined = await cdp.evaluate(STATE_EXPRESSION);
  check(
    "long-pressing a placed stele mines it instead of opening it",
    !steleMined.placedObjects.some((object) => object.type === "stele") &&
    steleMined.drops.some((drop) => drop.itemId === "stele") &&
    steleMined.steleHidden === true,
    JSON.stringify({ objects: steleMined.placedObjects, drops: steleMined.drops })
  );

  await cdp.evaluate("wildsGame.drops = []; true");
  await holdTile(workbenchTile.tx, workbenchTile.ty, 2850);
  const benchMined = await cdp.evaluate(STATE_EXPRESSION);
  check(
    "long-pressing a placed workbench mines it instead of opening it",
    !benchMined.placedObjects.some((object) => object.type === "workbench") &&
    benchMined.drops.some((drop) => drop.itemId === "workbench") &&
    benchMined.workbenchHidden === true,
    JSON.stringify({ objects: benchMined.placedObjects, drops: benchMined.drops })
  );

  // ---------- Respawn stele, maps and death ----------

  const respawnSetup = await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.closeMap();
    g.closeWorkbench();
    g.closeStele();
    if (g.backpackOpen) g.closeBackpack();
    g.placedObjects.clear();
    g.drops = [];
    g.inventory.equipment.fill(null);
    g.inventory.backpack.fill(null);
    g.selectedSlot = null;
    g.lastSlotClick = null;
    g.syncHeldStats();
    g.inventory.addItem("respawn_stele", 1);
    g.renderInventory();
    const index = g.inventory.equipment.findIndex((stack) => stack && stack.itemId === "respawn_stele");
    document.querySelectorAll("#hotbar .inv-slot")[index].click();
    g.clock.setTimeOfDay(0);
    return { index };
  })()`);

  const respawnTile = await findPlaceTile();
  check("a nearby ground tile is available for the respawn stele", Boolean(respawnTile), JSON.stringify(respawnTile));
  if (!respawnTile) throw new Error("no respawn stele placement tile");

  await clickTile(respawnTile.tx, respawnTile.ty);
  const respawnPlaced = await cdp.evaluate(STATE_EXPRESSION);
  check(
    "the respawn stele can be placed and starts inactive",
    respawnPlaced.placedObjects.some((object) =>
      object.type === "respawn_stele" &&
      object.tx === respawnTile.tx &&
      object.ty === respawnTile.ty &&
      object.active === false
    ),
    JSON.stringify(respawnPlaced.placedObjects)
  );
  check("placing the respawn stele consumes the item", respawnPlaced.equipmentItems.every((slot) => slot === null));

  await delay(180);
  const respawnDarkLuma = await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    const cx = Math.round((${respawnTile.tx} + 0.5) * 20 - g.renderer.cameraX);
    const cy = Math.round((${respawnTile.ty} + 0.5) * 20 - g.renderer.cameraY);
    const ctx = g.canvas.getContext("2d");
    const data = ctx.getImageData(0, 0, g.canvas.width, g.canvas.height).data;
    let total = 0;
    let samples = 0;
    for (let dy = -28; dy <= 28; dy += 2) {
      for (let dx = -28; dx <= 28; dx += 2) {
        const radius = Math.hypot(dx, dy);
        if (radius < 8 || radius > 28) continue;
        const x = Math.round((cx + dx) * g.renderer.renderScale);
        const y = Math.round((cy + dy) * g.renderer.renderScale);
        if (x < 0 || y < 0 || x >= g.canvas.width || y >= g.canvas.height) continue;
        const index = (y * g.canvas.width + x) * 4;
        total += data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
        samples += 1;
      }
    }
    return samples > 0 ? total / samples : 0;
  })()`);

  await clickTile(respawnTile.tx, respawnTile.ty);
  await delay(220);
  const respawnActive = await cdp.evaluate(STATE_EXPRESSION);
  check(
    "clicking the respawn stele activates it",
    respawnActive.placedObjects.some((object) =>
      object.type === "respawn_stele" &&
      object.tx === respawnTile.tx &&
      object.ty === respawnTile.ty &&
      object.active === true
    ),
    JSON.stringify(respawnActive.placedObjects)
  );
  check(
    "the activated respawn stele becomes the new respawn point",
    respawnActive.respawn && respawnActive.respawn.tx === respawnTile.tx && respawnActive.respawn.ty === respawnTile.ty,
    JSON.stringify(respawnActive.respawn)
  );
  check(
    "dig, mining, chopping, crafting, placement and stele activation have sounds",
    respawnActive.actionSounds &&
    Object.values(respawnActive.actionSounds).every((count) => count > 0),
    JSON.stringify(respawnActive.actionSounds)
  );
  await cdp.screenshot(join(shotDir, "browser-respawn-stele-night.png"));

  const respawnLightLuma = await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    const cx = Math.round((${respawnTile.tx} + 0.5) * 20 - g.renderer.cameraX);
    const cy = Math.round((${respawnTile.ty} + 0.5) * 20 - g.renderer.cameraY);
    const ctx = g.canvas.getContext("2d");
    const data = ctx.getImageData(0, 0, g.canvas.width, g.canvas.height).data;
    let total = 0;
    let samples = 0;
    for (let dy = -28; dy <= 28; dy += 2) {
      for (let dx = -28; dx <= 28; dx += 2) {
        const radius = Math.hypot(dx, dy);
        if (radius < 8 || radius > 28) continue;
        const x = Math.round((cx + dx) * g.renderer.renderScale);
        const y = Math.round((cy + dy) * g.renderer.renderScale);
        if (x < 0 || y < 0 || x >= g.canvas.width || y >= g.canvas.height) continue;
        const index = (y * g.canvas.width + x) * 4;
        total += data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
        samples += 1;
      }
    }
    return samples > 0 ? total / samples : 0;
  })()`);
  check(
    "the activated respawn stele lights a small area at night",
    respawnLightLuma > respawnDarkLuma + 0.5,
    JSON.stringify({ inactive: respawnDarkLuma, active: respawnLightLuma })
  );

  const minimapAria = await cdp.evaluate("document.getElementById('minimap').getAttribute('aria-label')");
  check("the minimap tracks the current respawn point", minimapAria.includes("复活点"), minimapAria);

  // ---------- Big map ----------

  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "m",
    code: "KeyM",
    windowsVirtualKeyCode: 77,
    nativeVirtualKeyCode: 77,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "m",
    code: "KeyM",
    windowsVirtualKeyCode: 77,
    nativeVirtualKeyCode: 77,
  });
  await delay(180);

  const mapOpened = await cdp.evaluate(STATE_EXPRESSION);
  check("pressing M opens the dedicated world map", mapOpened.mapOpen === true && mapOpened.mapHidden === false);
  check("the world map shows the respawn point", mapOpened.mapRespawnText.includes("复活点") && !mapOpened.mapRespawnText.includes("—"), mapOpened.mapRespawnText);
  check("the world map records explored terrain", mapOpened.exploredCount >= initial.exploredCount, JSON.stringify({ before: initial.exploredCount, after: mapOpened.exploredCount }));
  await cdp.screenshot(join(shotDir, "browser-world-map.png"));

  const mapBeforeDrag = await cdp.evaluate("wildsGame.mapCamX");
  const mapPoint = await cdp.evaluate(`(() => {
    const rect = wildsGame.worldMapCanvas.getBoundingClientRect();
    return { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.5 };
  })()`);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x: mapPoint.x, y: mapPoint.y, button: "left", buttons: 1, clickCount: 1,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved", x: mapPoint.x + 90, y: mapPoint.y + 55, button: "left", buttons: 1,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: mapPoint.x + 90, y: mapPoint.y + 55, button: "left", buttons: 0, clickCount: 1,
  });
  await delay(120);
  const mapAfterDrag = await cdp.evaluate("wildsGame.mapCamX");
  check("the world map can be dragged to see more explored area", Math.abs(mapAfterDrag - mapBeforeDrag) > 1, JSON.stringify({ before: mapBeforeDrag, after: mapAfterDrag }));

  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown", key: "m", code: "KeyM", windowsVirtualKeyCode: 77, nativeVirtualKeyCode: 77,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp", key: "m", code: "KeyM", windowsVirtualKeyCode: 77, nativeVirtualKeyCode: 77,
  });
  await delay(120);
  const mapClosed = await cdp.evaluate(STATE_EXPRESSION);
  check("pressing M again closes the world map", mapClosed.mapOpen === false && mapClosed.mapHidden === true);

  // ---------- Death and respawn ----------

  const deathSetup = await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.closeMap();
    g.closeWorkbench();
    g.closeStele();
    if (g.backpackOpen) g.closeBackpack();
    g.drops = [];
    g.inventory.equipment.fill(null);
    g.inventory.backpack.fill(null);
    g.inventory.setSlot("equipment", 0, { itemId: "workbench", count: 1 });
    g.inventory.setSlot("equipment", 1, { itemId: "stone_axe", count: 1, durability: 20 });
    g.inventory.setSlot("equipment", 2, { itemId: "stone_sword", count: 1, durability: 40 });
    g.inventory.setSlot("backpack", 0, { itemId: "rock", count: 5 });
    g.inventory.setSlot("backpack", 1, { itemId: "wood", count: 3 });
    g.selectedSlot = null;
    g.lastSlotClick = null;
    g.syncHeldStats();
    g.renderInventory();
    g.player.x = (${respawnTile.tx + 4} + 0.5) * 20;
    g.player.y = (${respawnTile.ty + 3} + 0.5) * 20;
    g.player.health = 0;
    g.clock.setTimeOfDay(12);
    return { tx: g.player.tileX, ty: g.player.tileY };
  })()`);
  await delay(320);

  const dead = await cdp.evaluate(STATE_EXPRESSION);
  check("zero health opens the death page", dead.deathHidden === false && dead.deathTitle === "你死了");
  check(
    "death drops every equipment and backpack item at the death position",
    dead.equipmentItems.every((slot) => slot === null) &&
    dead.backpackItems.every((slot) => slot === null) &&
    dead.drops.length === 5 &&
    dead.drops.every((drop) => drop.tx === deathSetup.tx && drop.ty === deathSetup.ty) &&
    dead.drops.some((drop) => drop.itemId === "stone_axe" && drop.durability === 20) &&
    dead.drops.some((drop) => drop.itemId === "rock" && drop.count === 5),
    JSON.stringify({ drops: dead.drops, equipment: dead.equipmentItems, backpack: dead.backpackItems })
  );
  await cdp.screenshot(join(shotDir, "browser-death.png"));

  await cdp.evaluate("document.getElementById('respawnButton').click(); true");
  await delay(200);
  const revived = await cdp.evaluate(STATE_EXPRESSION);
  check("clicking revive closes the death page", revived.deathHidden === true);
  check(
    "revive places the player beside the respawn stele",
    (revived.tileX !== respawnTile.tx || revived.tileY !== respawnTile.ty) &&
    Math.abs(revived.tileX - respawnTile.tx) <= 1 &&
    Math.abs(revived.tileY - respawnTile.ty) <= 1 &&
    revived.underfoot !== 0,
    JSON.stringify({ tile: [revived.tileX, revived.tileY], stele: respawnTile })
  );
  check("revive restores full health and oxygen", revived.health === 100 && revived.oxygen === 10, JSON.stringify({ health: revived.health, oxygen: revived.oxygen }));
  check("the death drops remain at the death position", revived.drops.length === 5, String(revived.drops.length));

  // ---------- Food, bed and combat ----------
  const foodSlotIndex = await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.inventory.equipment.fill(null);
    g.inventory.backpack.fill(null);
    g.selectedSlot = null;
    g.player.satiety = 50;
    g.player.health = 100;
    g.player.poisonRemainingHours = 0;
    g.player.poisonDamageRemaining = 0;
    g.clock.day = 1;
    g.clock.time = 12 * 3600;
    g.inventory.addItem("raw_mutton", 1);
    g.renderInventory();
    window.__oldRandom = Math.random;
    Math.random = () => 0;
    return g.inventory.equipment.findIndex((stack) => stack && stack.itemId === "raw_mutton");
  })()`);
  await cdp.evaluate(`(() => {
    const slot = document.querySelectorAll("#hotbar .inv-slot")[${foodSlotIndex}];
    slot.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerId: 1 }));
    return true;
  })()`);
  await delay(760);
  await cdp.evaluate(`(() => {
    document.querySelectorAll("#hotbar .inv-slot")[${foodSlotIndex}].dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1 }));
    Math.random = window.__oldRandom;
    return true;
  })()`);
  const ateMutton = await cdp.evaluate(STATE_EXPRESSION);
  check("long-pressing a food item eats it and restores satiety", ateMutton.satiety === 80 && ateMutton.equipmentItems.every((slot) => slot === null), JSON.stringify({ satiety: ateMutton.satiety, equipment: ateMutton.equipmentItems }));
  check("raw meat can poison the player", ateMutton.poisonHours > 0, String(ateMutton.poisonHours));

  const bedSlotIndex = await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.inventory.equipment.fill(null);
    g.inventory.backpack.fill(null);
    g.selectedSlot = null;
    g.suppressSlotClickUntil = 0;
    g.player.poisonRemainingHours = 0;
    g.player.poisonDamageRemaining = 0;
    g.inventory.addItem("comfortable_bed", 1);
    g.renderInventory();
    const index = g.inventory.equipment.findIndex((stack) => stack && stack.itemId === "comfortable_bed");
    document.querySelectorAll("#hotbar .inv-slot")[index].click();
    g.clock.day = 1;
    g.clock.time = 12 * 3600;
    return { index };
  })()`);
  const bedTile = await findPlaceTile();
  await clickTile(bedTile.tx, bedTile.ty);
  await clickTile(bedTile.tx, bedTile.ty);
  const daytimeBed = await cdp.evaluate(STATE_EXPRESSION);
  check("beds cannot be slept in during the day", daytimeBed.sleeping === false, JSON.stringify(daytimeBed.sleeping));

  await cdp.evaluate(`(() => {
    wildsGame.clock.day = 1;
    wildsGame.clock.time = 22 * 3600;
    return true;
  })()`);
  await clickTile(bedTile.tx, bedTile.ty);
  const sleeping = await cdp.evaluate(STATE_EXPRESSION);
  check("using a bed at night starts the three-second sleep", sleeping.sleeping === true);
  await cdp.screenshot(join(shotDir, "browser-bed.png"));
  await delay(3300);
  const woke = await cdp.evaluate(STATE_EXPRESSION);
  check("sleeping jumps to the next day at 06:00", woke.sleeping === false && woke.clockDay === 2 && woke.clockHours >= 6 && woke.clockHours < 6.1, JSON.stringify({ day: woke.clockDay, hours: woke.clockHours }));

  const meleeSpot = await findPlaceTile();
  await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.mobs = [];
    g.projectiles = [];
    g.player.health = 100;
    g.clock.day = 1;
    g.clock.time = 12 * 3600;
    g.inventory.equipment.fill(null);
    g.inventory.backpack.fill(null);
    g.inventory.addEquipment("stone_sword", 60);
    g.renderInventory();
    const idx = g.inventory.equipment.findIndex((s) => s && s.itemId === "stone_sword");
    g.selectedSlot = { area: "equipment", index: idx };
    g.syncHeldStats();
    g.renderSelection();
    g.spawnMob("sheep", ${meleeSpot.tx}, ${meleeSpot.ty});
    return true;
  })()`);
  const sheepTile = await cdp.evaluate(`(() => { const m = wildsGame.mobs[0]; return { tx: Math.floor(m.x / 20), ty: Math.floor(m.y / 20) }; })()`);
  await clickTile(sheepTile.tx, sheepTile.ty);
  await delay(120);
  const hitSheep = await cdp.evaluate(STATE_EXPRESSION);
  check("player melee attacks damage nearby mobs", hitSheep.mobs.some((mob) => mob.type === "sheep" && mob.health < mob.maxHealth), JSON.stringify(hitSheep.mobs));
  check("creature hits play the required chicken.wav cry", hitSheep.animalHurtCount > 0, String(hitSheep.animalHurtCount));

  await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.mobs = [];
    g.projectiles = [];
    g.drops = [];
    g.clock.day = 1;
    g.clock.time = 12 * 3600;
    g.player.health = 100;
    g.spawnMob("sheep", g.player.tileX + 8, g.player.tileY);
    const sheep = g.mobs.find((m) => m.type === "sheep");
    if (sheep) g.damageMob(sheep, 999);
    g.spawnMob("algorithm_chicken", g.player.tileX + 8, g.player.tileY);
    const chicken = g.mobs.find((m) => m.type === "algorithm_chicken");
    if (chicken) g.damageMob(chicken, 999);
    return true;
  })()`);
  await delay(1000);
  const mobDrops = await cdp.evaluate(STATE_EXPRESSION);
  check(
    "sheep and algorithm chickens drop their requested items",
    ["wool", "raw_mutton", "algorithm_chicken_leg"].every((itemId) => mobDrops.drops.some((drop) => drop.itemId === itemId)),
    JSON.stringify(mobDrops.drops.map((drop) => drop.itemId))
  );

  await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.mobs = [];
    g.projectiles = [];
    g.player.health = 100;
    g.clock.day = 1;
    g.clock.time = 22 * 3600;
    g.spawnMob("zombie", g.player.tileX + 1, g.player.tileY);
    return true;
  })()`);
  await delay(1200);
  const zombieHit = await cdp.evaluate(STATE_EXPRESSION);
  check("zombies chase and deal melee damage", zombieHit.health < 100, zombieHit.health.toFixed(1));
  check("player damage plays a distinct hurt sound", zombieHit.playerHurtCount > 0, String(zombieHit.playerHurtCount));

  await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.mobs = [];
    g.projectiles = [];
    g.player.health = 100;
    g.clock.day = 1;
    g.clock.time = 22 * 3600;
    for (let dx = 1; dx <= 4; dx += 1) {
      const tx = g.player.tileX + dx;
      const ty = g.player.tileY;
      g.placedObjects.delete(tx + "," + ty);
      if (g.world.featureAt(tx, ty) === 1 || g.world.featureAt(tx, ty) === 2) {
        g.world.removeFeatureAt(tx, ty);
      }
    }
    g.spawnMob("savage_archer", g.player.tileX + 4, g.player.tileY);
    return true;
  })()`);
  await delay(1900);
  const archerAttack = await cdp.evaluate(STATE_EXPRESSION);
  check("savage archers fire non-homing arrows", archerAttack.health < 100 || archerAttack.projectiles.some((p) => p.owner === "monster"), JSON.stringify({ health: archerAttack.health, projectiles: archerAttack.projectiles }));

  await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.mobs = [];
    g.projectiles = [];
    g.drops = [];
    g.clock.day = 1;
    g.clock.time = 22 * 3600;
    g.spawnMob("zombie", g.player.tileX + 5, g.player.tileY);
    g.clock.time = 6 * 3600;
    return true;
  })()`);
  await delay(1100);
  const daylightMobs = await cdp.evaluate(STATE_EXPRESSION);
  const daylightZombie = daylightMobs.mobs.find((mob) => mob.type === "zombie");
  check(
    "morning light drains monster health by 10 points per real second",
    daylightZombie && daylightZombie.health < 70 && daylightZombie.health > 0 && !daylightZombie.dying,
    JSON.stringify(daylightZombie)
  );

  await cdp.evaluate(`(() => {
    const mob = window.wildsGame.mobs.find((entry) => entry.type === "zombie");
    if (mob) mob.health = 5;
    return true;
  })()`);
  await delay(700);
  const daylightDying = await cdp.evaluate(STATE_EXPRESSION);
  const dyingZombie = daylightDying.mobs.find((mob) => mob.type === "zombie");
  check(
    "daylight-killed monsters play a death animation before disappearing",
    dyingZombie && dyingZombie.dying === true,
    JSON.stringify(dyingZombie)
  );
  await delay(900);
  const daylightGone = await cdp.evaluate(STATE_EXPRESSION);
  check(
    "monster death animation finishes and removes the mob",
    daylightGone.mobs.filter((mob) => mob.type === "zombie").length === 0,
    JSON.stringify(daylightGone.mobs)
  );
  check(
    "sunlight-killed zombies do not drop loot",
    !daylightGone.drops.some((drop) => drop.itemId === "zombie_elbow"),
    JSON.stringify(daylightGone.drops.map((drop) => drop.itemId))
  );

  await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.mobs = [];
    g.drops = [];
    const zombie = g.spawnMob("zombie", g.player.tileX + 3, g.player.tileY);
    g.damageMob(zombie, 999, "player");
    return true;
  })()`);
  await delay(1000);
  const playerKilledZombie = await cdp.evaluate(STATE_EXPRESSION);
  check(
    "player-killed zombies do drop loot",
    playerKilledZombie.drops.some((drop) => drop.itemId === "zombie_elbow"),
    JSON.stringify(playerKilledZombie.drops.map((drop) => drop.itemId))
  );

  await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.mobs = [];
    const sheep = g.spawnMob("sheep", g.player.tileX + 3, g.player.tileY);
    g.damageMob(sheep, 999);
    return true;
  })()`);
  await delay(150);
  const animalDying = await cdp.evaluate(STATE_EXPRESSION);
  check(
    "killed animals also play a death animation",
    animalDying.mobs.some((mob) => mob.type === "sheep" && mob.dying),
    JSON.stringify(animalDying.mobs)
  );
  await delay(900);
  const animalGone = await cdp.evaluate(STATE_EXPRESSION);
  check(
    "animal death animation finishes and removes the animal",
    animalGone.mobs.filter((mob) => mob.type === "sheep").length === 0,
    JSON.stringify(animalGone.mobs)
  );

  const bowSpot = await findPlaceTile();
  await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.mobs = [];
    g.projectiles = [];
    g.clock.day = 1;
    g.clock.time = 12 * 3600;
    g.inventory.equipment.fill(null);
    g.inventory.backpack.fill(null);
    g.inventory.addEquipment("wood_bow", 30);
    g.renderInventory();
    const idx = g.inventory.equipment.findIndex((s) => s && s.itemId === "wood_bow");
    g.selectedSlot = { area: "equipment", index: idx };
    g.syncHeldStats();
    g.spawnMob("sheep", ${bowSpot.tx}, ${bowSpot.ty});
    return true;
  })()`);
  const bowSheepTile = await cdp.evaluate(`(() => { const m = wildsGame.mobs[0]; return { tx: Math.floor(m.x / 20), ty: Math.floor(m.y / 20) }; })()`);
  await clickTile(bowSheepTile.tx, bowSheepTile.ty);
  await delay(500);
  const bowResult = await cdp.evaluate(STATE_EXPRESSION);
  check(
    "the bow fires a projectile, damages at range and consumes durability",
    bowResult.mobs.some((mob) => mob.type === "sheep" && mob.health < mob.maxHealth) &&
    bowResult.equipmentItems.some((slot) => slot && slot.itemId === "wood_bow" && slot.durability === 29),
    JSON.stringify({ mobs: bowResult.mobs, equipment: bowResult.equipmentItems })
  );
  await cdp.screenshot(join(shotDir, "browser-mobs.png"));

  const projectileBlockSetup = await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.mobs = [];
    g.projectiles = [];
    let spot = null;
    for (let radius = 2; radius <= 9 && !spot; radius += 1) {
      for (let dy = -radius; dy <= radius && !spot; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const tx = g.player.tileX + dx;
          const ty = g.player.tileY + dy;
          if (g.world.terrainAt(tx, ty) === 0) continue;
          if (g.world.featureAt(tx, ty) !== 0) continue;
          if (g.placedObjects.has(tx + "," + ty)) continue;
          spot = { tx, ty };
          break;
        }
      }
    }
    if (!spot) return null;
    const key = spot.tx + "," + spot.ty;
    g.placedObjects.set(key, {
      id: 99001,
      type: "storage_chest",
      itemId: "storage_chest",
      tx: spot.tx,
      ty: spot.ty,
      storage: new Array(32).fill(null)
    });
    const cx = (spot.tx + 0.5) * 20;
    const cy = (spot.ty + 0.5) * 20;
    g.spawnProjectile("arrow", "player", cx - 16, cy, cx + 30, cy, 40, 2000, 90);
    g.updateProjectiles(0.05);
    let treeBlocked = false;
    for (let dy = -12; dy <= 12 && !treeBlocked; dy += 1) {
      for (let dx = -12; dx <= 12; dx += 1) {
        const tx = g.player.tileX + dx;
        const ty = g.player.tileY + dy;
        if (g.world.featureAt(tx, ty) === 1) {
          treeBlocked = g.isProjectileBlocked(tx, ty);
          break;
        }
      }
    }
    return {
      key,
      spot,
      objectBlocked: g.isProjectileBlocked(spot.tx, spot.ty),
      treeBlocked
    };
  })()`);
  await delay(350);
  const blockedProjectile = await cdp.evaluate(STATE_EXPRESSION);
  check(
    "arrows are destroyed by trees and placed ground objects",
    projectileBlockSetup &&
    projectileBlockSetup.objectBlocked &&
    projectileBlockSetup.treeBlocked &&
    projectileBlockSetup.key &&
    blockedProjectile.projectiles.length === 0,
    JSON.stringify({ setup: projectileBlockSetup, projectiles: blockedProjectile.projectiles })
  );

  const invariantResult = await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    const object = g.placedObjects.values().next().value;
    const original = { x: g.player.x, y: g.player.y };
    const blocked = {
      x: (object.tx + 0.5) * 20,
      y: (object.ty + 0.5) * 20
    };
    g.player.x = blocked.x;
    g.player.y = blocked.y;
    g.enforceGroundObstacleInvariant();
    const playerSafe = g.player.canOccupy(g.player.x, g.player.y);
    g.player.x = original.x;
    g.player.y = original.y;
    g.enforceGroundObstacleInvariant();

    const mob = g.spawnMob(
      "sheep",
      Math.floor(original.x / 20),
      Math.floor(original.y / 20)
    );
    mob.x = blocked.x;
    mob.y = blocked.y;
    g.enforceGroundObstacleInvariant();
    const mobSafe = g.mobCanOccupy(mob.x, mob.y);
    g.mobs = [];
    return { playerSafe, mobSafe };
  })()`);
  check(
    "the final position invariant restores creatures that enter a fixed object",
    invariantResult.playerSafe && invariantResult.mobSafe,
    JSON.stringify(invariantResult)
  );

  await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.placedObjects.delete(${JSON.stringify(projectileBlockSetup.key)});
    g.mobs = [];
    g.projectiles = [];
    g.clock.day = 1;
    g.clock.time = 22 * 3600;
    const tx = ${projectileBlockSetup.spot.tx};
    const ty = ${projectileBlockSetup.spot.ty};
    const archer = g.spawnMob("savage_archer", tx, ty);
    const zombie = g.spawnMob("zombie", tx, ty);
    g.spawnProjectile("enemy_arrow", "monster", archer.x, archer.y, zombie.x + 8, zombie.y, 25, 220, 120, archer.id);
    return true;
  })()`);
  await delay(160);
  const friendlyFire = await cdp.evaluate(STATE_EXPRESSION);
  const archerState = friendlyFire.mobs.find((mob) => mob.type === "savage_archer");
  const zombieState = friendlyFire.mobs.find((mob) => mob.type === "zombie");
  check(
    "monster arrows damage animals and other monsters but not their shooter",
    archerState && zombieState &&
    archerState.health === archerState.maxHealth &&
    zombieState.health < zombieState.maxHealth &&
    friendlyFire.projectiles.length === 0,
    JSON.stringify({ archer: archerState, zombie: zombieState, projectiles: friendlyFire.projectiles })
  );

  await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.mobs = [];
    g.projectiles = [];
    return true;
  })()`);

  await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.mobs = [];
    g.projectiles = [];
    g.clock.day = 1;
    g.clock.time = 12 * 3600;
    return true;
  })()`);

  // ---------- Creation scroll, storage, furnace and no-respawn death ----------
  const scrollShort = await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.inventory.equipment.fill(null);
    g.inventory.backpack.fill(null);
    g.selectedSlot = null;
    g.inventory.addEquipment("creation_scroll");
    g.renderInventory();
    const idx = g.inventory.equipment.findIndex((s) => s && s.itemId === "creation_scroll");
    g.selectedSlot = { area: "equipment", index: idx };
    g.syncHeldStats();
    g.canvas.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    return true;
  })()`);
  await delay(80);
  const scrollInsufficient = await cdp.evaluate(STATE_EXPRESSION);
  check("the creation scroll needs three wood", scrollInsufficient.toastText === "需要三个木材", scrollInsufficient.toastText);

  await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.addToBackpack("wood", 3);
    g.renderInventory();
    g.canvas.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    return true;
  })()`);
  await delay(80);
  const scrollUsed = await cdp.evaluate(STATE_EXPRESSION);
  check(
    "the creation scroll consumes three wood and puts the workbench in the first free equipment slot",
    scrollUsed.equipmentItems.some((slot) => slot && slot.itemId === "creation_scroll") &&
    scrollUsed.equipmentItems.some((slot) => slot && slot.itemId === "workbench") &&
    !scrollUsed.backpackItems.some((slot) => slot && slot.itemId === "workbench") &&
    scrollUsed.toastText === "获得工具箱",
    JSON.stringify({ equipment: scrollUsed.equipmentItems, backpack: scrollUsed.backpackItems, toast: scrollUsed.toastText })
  );

  const chestTile = await findPlaceTile();
  const chestPlacement = await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.inventory.equipment.fill(null);
    g.inventory.backpack.fill(null);
    g.selectedSlot = null;
    g.inventory.addItem("storage_chest", 1);
    g.renderInventory();
    const idx = g.inventory.equipment.findIndex((s) => s && s.itemId === "storage_chest");
    g.selectedSlot = { area: "equipment", index: idx };
    g.syncHeldStats();
    const terrain = g.world.terrainAt(${chestTile.tx}, ${chestTile.ty});
    const feature = g.world.featureAt(${chestTile.tx}, ${chestTile.ty});
    const existing = g.placedObjectAt(${chestTile.tx}, ${chestTile.ty});
    const placed = g.placeSelectedObject(${chestTile.tx}, ${chestTile.ty});
    const after = g.placedObjectAt(${chestTile.tx}, ${chestTile.ty});
    g.openPlacedObject(${chestTile.tx}, ${chestTile.ty});
    return { idx, terrain, feature, existing: Boolean(existing), placed, after: after ? after.type : null, hidden: g.storageOverlay.hidden, selected: g.selectedSlot };
  })()`);
  const chestOpened = await cdp.evaluate(STATE_EXPRESSION);
  check("the storage chest opens a 4 × 8 interface", chestOpened.storageHidden === false && chestOpened.chestSlotCount === 32, JSON.stringify({ hidden: chestOpened.storageHidden, slots: chestOpened.chestSlotCount, placement: chestPlacement }));
  await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.inventory.setSlot("backpack", 0, { itemId: "wood", count: 3 });
    g.renderStorage();
    g.renderInventory();
    const index = g.inventory.backpack.findIndex((s) => s && s.itemId === "wood");
    document.querySelectorAll("#chestBackpackGrid .inv-slot")[index]?.click();
    return true;
  })()`);
  await delay(80);
  const chestStored = await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    return {
      chest: g.storageObject.storage.filter(Boolean).map((s) => ({ itemId: s.itemId, count: s.count })),
      chestSlots: document.querySelectorAll("#chestGrid .inv-slot").length
    };
  })()`);
  check("backpack items can be placed into the storage chest", chestStored.chest.some((s) => s.itemId === "wood" && s.count === 3), JSON.stringify(chestStored));
  await cdp.screenshot(join(shotDir, "browser-storage.png"));
  await cdp.evaluate(`(() => { document.getElementById("closeStorage").click(); return true; })()`);

  const rangeCheck = await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    const original = { x: g.player.x, y: g.player.y };
    g.player.x = (${chestTile.tx} + 5.5) * 20;
    g.player.y = (${chestTile.ty} + 0.5) * 20;
    const opened = g.openPlacedObject(${chestTile.tx}, ${chestTile.ty});
    const result = {
      opened,
      hidden: document.getElementById("storageOverlay").hidden,
      toast: document.getElementById("gameToast").textContent
    };
    g.player.x = original.x;
    g.player.y = original.y;
    return result;
  })()`);
  check(
    "placed objects cannot be interacted with from farther than two tiles",
    rangeCheck.opened === false && rangeCheck.hidden === true && rangeCheck.toast.includes("距离太远"),
    JSON.stringify(rangeCheck)
  );

  const furnaceTile = await findPlaceTile();
  await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.inventory.equipment.fill(null);
    g.inventory.backpack.fill(null);
    g.selectedSlot = null;
    g.inventory.addItem("furnace", 1);
    g.renderInventory();
    const idx = g.inventory.equipment.findIndex((s) => s && s.itemId === "furnace");
    g.selectedSlot = { area: "equipment", index: idx };
    g.syncHeldStats();
    g.placeSelectedObject(${furnaceTile.tx}, ${furnaceTile.ty});
    g.openPlacedObject(${furnaceTile.tx}, ${furnaceTile.ty});
    return true;
  })()`);
  await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.addToBackpack("coal", 3);
    g.addToBackpack("raw_mutton", 1);
    g.addToBackpack("algorithm_chicken_leg", 1);
    g.addToBackpack("wood", 1);
    g.renderFurnace();
    const clickItem = (itemId) => {
      for (const area of ["equipment", "backpack"]) {
        const idx = g.inventory[area].findIndex((s) => s && s.itemId === itemId);
        if (idx >= 0) {
          const grid = area === "equipment" ? g.furnaceEquipmentGrid : g.furnaceBackpackGrid;
          grid.querySelectorAll(".inv-slot")[idx].click();
          return;
        }
      }
    };
    clickItem("coal");
    clickItem("coal");
    clickItem("coal");
    clickItem("raw_mutton");
    clickItem("algorithm_chicken_leg");
    clickItem("wood");
    return true;
  })()`);
  await delay(100);
  const smelted = await cdp.evaluate(STATE_EXPRESSION);
  check(
    "the furnace accepts fuel and food from the equipment bar",
    smelted.furnaceHidden === false &&
    smelted.furnaceFuel === 0 &&
    ["cooked_mutton", "cooked_algorithm_chicken_leg", "strange_waste"].every((itemId) =>
      smelted.equipmentItems.some((slot) => slot && slot.itemId === itemId) ||
      smelted.backpackItems.some((slot) => slot && slot.itemId === itemId)
    ),
    JSON.stringify({ fuel: smelted.furnaceFuel, equipment: smelted.equipmentItems, backpack: smelted.backpackItems })
  );
  await cdp.screenshot(join(shotDir, "browser-furnace.png"));
  await cdp.evaluate(`(() => { document.getElementById("closeFurnace").click(); return true; })()`);

  const blockingObjects = await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    const objects = Array.from(g.placedObjects.values());
    return {
      types: objects.map((object) => object.type),
      blocked: objects.filter(window.Wilds.Buildings.isBlocking).every((object) =>
        !g.player.canOccupy((object.tx + 0.5) * 20, (object.ty + 0.5) * 20)
      ),
      mobBlocked: objects.filter(window.Wilds.Buildings.isBlocking).every((object) =>
        !g.mobCanOccupy((object.tx + 0.5) * 20, (object.ty + 0.5) * 20)
      ),
      treeBlocked: (() => {
        for (let dy = -20; dy <= 20; dy += 1) {
          for (let dx = -20; dx <= 20; dx += 1) {
            const tx = g.player.tileX + dx;
            const ty = g.player.tileY + dy;
            if (g.world.featureAt(tx, ty) === 1) {
              return !g.mobCanOccupy((tx + 0.5) * 20, (ty + 0.5) * 20);
            }
          }
        }
        return false;
      })()
    };
  })()`);
  check(
    "blocking placed objects and trees block animal and monster movement",
    blockingObjects.types.length > 0 &&
    blockingObjects.blocked &&
    blockingObjects.mobBlocked &&
    blockingObjects.treeBlocked,
    JSON.stringify(blockingObjects)
  );

  await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.activeRespawnSteles.clear();
    g.player.health = 0;
    return true;
  })()`);
  await delay(120);
  const noRespawnDeath = await cdp.evaluate(STATE_EXPRESSION);
  check(
    "death without a respawn point is game over",
    noRespawnDeath.deathHidden === false &&
    noRespawnDeath.respawnButtonHidden === true &&
    noRespawnDeath.deathNoRespawnHidden === false &&
    noRespawnDeath.deathNewGameHidden === false &&
    noRespawnDeath.lastDeath !== null,
    JSON.stringify({ respawnHidden: noRespawnDeath.respawnButtonHidden, noRespawnHidden: noRespawnDeath.deathNoRespawnHidden, lastDeath: noRespawnDeath.lastDeath })
  );
  await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.closeDeath();
    g.player.health = 100;
    g.inventory.equipment.fill(null);
    g.inventory.backpack.fill(null);
    g.renderInventory();
    return true;
  })()`);

  // ---------- Tool and durability showcase ----------

  await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.inventory.equipment.fill(null);
    g.inventory.backpack.fill(null);
    g.selectedSlot = null;
    g.syncHeldStats();
    const put = (area, index, itemId, durability) => {
      const stack = { itemId, count: 1 };
      if (durability !== undefined) stack.durability = durability;
      g.inventory.setSlot(area, index, stack);
    };
    put("equipment", 0, "wood_axe", 12);
    put("equipment", 1, "stone_axe", 8);
    put("equipment", 2, "wood_pickaxe", 15);
    put("equipment", 3, "stone_pickaxe", 5);
    put("equipment", 4, "wood_shovel", 14);
    put("equipment", 5, "stone_shovel", 30);
    put("equipment", 6, "torch");
    put("equipment", 7, "stele");
    put("backpack", 0, "wood_sword", 20);
    put("backpack", 1, "stone_sword", 60);
    put("backpack", 2, "workbench");
    put("backpack", 3, "wood");
    put("backpack", 4, "rock");
    g.renderInventory();
    document.getElementById("bagButton").click();
    return true;
  })()`);
  await delay(140);
  await cdp.screenshot(join(shotDir, "browser-tool-durability.png"));
  await cdp.evaluate("document.getElementById('closeBackpack').click(); true");
  await delay(100);

  // ---------- Icon showcase (visual verification) ----------

  await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.closeWorkbench();
    g.closeStele();
    g.placedObjects.clear();
    g.drops = [];
    g.clock.setTimeOfDay(12);
    g.inventory.equipment.fill(null);
    g.inventory.backpack.fill(null);
    const place = (area, index, itemId, count) => {
      g.inventory.setSlot(area, index, { itemId, count });
    };
    place("equipment", 0, "coal", 10);
    place("equipment", 1, "dirt", 7);
    place("equipment", 2, "wood", 4);
    place("equipment", 3, "rock", 3);
    place("backpack", 0, "coal", 2);
    place("backpack", 1, "dirt", 5);
    place("backpack", 2, "wood", 1);
    place("backpack", 3, "rock", 8);
    g.renderInventory();
    return true;
  })()`);

  const iconKinds = await cdp.evaluate(`(() => {
    return Array.from(document.querySelectorAll("#hotbar .inv-slot[data-item]"))
      .map((slot) => slot.dataset.item)
      .filter(Boolean);
  })()`);
  check(
    "all four materials use distinct slot icon styles",
    iconKinds.includes("coal") && iconKinds.includes("dirt") && iconKinds.includes("wood") && iconKinds.includes("rock"),
    JSON.stringify(iconKinds)
  );

  await cdp.evaluate("document.getElementById('bagButton').click(); true");
  await delay(120);
  await cdp.screenshot(join(shotDir, "browser-icon-showcase.png"));
  await cdp.evaluate("document.getElementById('closeBackpack').click(); true");
  await delay(100);

  await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    g.drops = [];
    const x = g.player.tileX;
    const y = g.player.tileY;
    g.spawnDrop("coal", 1, x - 2, y - 1);
    g.spawnDrop("dirt", 1, x + 2, y - 1);
    g.spawnDrop("wood", 3, x - 2, y + 1);
    g.spawnDrop("rock", 1, x + 2, y + 1);
    return true;
  })()`);
  await delay(180);
  await cdp.screenshot(join(shotDir, "browser-drop-showcase.png"));

  // ---------- Mobile layout ----------

  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await delay(300);
  const mobile = await cdp.evaluate(STATE_EXPRESSION);
  check("mobile layout does not overflow horizontally", mobile.pageScrollWidth <= mobile.pageWidth + 1, mobile.pageScrollWidth + " > " + mobile.pageWidth);
  check(
    "vitals panel fits inside the mobile viewport",
    mobile.vitalsLayout.left + mobile.vitalsLayout.width <= mobile.vitalsLayout.viewportWidth,
    JSON.stringify(mobile.vitalsLayout)
  );
  check("game clock remains centred on mobile", Math.abs(mobile.clockLayout.centerOffset) < 2, JSON.stringify(mobile.clockLayout));
  await cdp.screenshot(join(shotDir, "browser-mobile.png"));

  await cdp.evaluate("document.getElementById('bagButton').click(); true");
  await delay(120);
  const mobileBag = await cdp.evaluate(STATE_EXPRESSION);
  const mobileBagLayout = await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    const panel = document.querySelector(".backpack-panel").getBoundingClientRect();
    const viewport = g.viewport.getBoundingClientRect();
    const hotbar = g.hotbar.getBoundingClientRect();
    return {
      panelTop: panel.top,
      panelBottom: panel.bottom,
      panelLeft: panel.left,
      panelRight: panel.right,
      viewportTop: viewport.top,
      viewportBottom: viewport.bottom,
      viewportLeft: viewport.left,
      viewportRight: viewport.right,
      hotbarTop: hotbar.top,
      fits: panel.top >= viewport.top - 1 &&
        panel.bottom <= hotbar.top + 1 &&
        panel.left >= viewport.left - 1 &&
        panel.right <= viewport.right + 1
    };
  })()`);
  check("the backpack opens on mobile", mobileBag.backpackHidden === false);
  check("the mobile backpack fits above the equipment bar", mobileBagLayout.fits === true, JSON.stringify(mobileBagLayout));
  await cdp.screenshot(join(shotDir, "browser-mobile-backpack.png"));
  await cdp.evaluate("document.getElementById('closeBackpack').click(); true");
  await delay(100);

  await cdp.evaluate("wildsGame.openWorkbench(); true");
  await delay(150);
  const mobileWorkbenchLayout = await cdp.evaluate(`(() => {
    const g = window.wildsGame;
    const panel = document.querySelector(".workbench-panel").getBoundingClientRect();
    const viewport = g.viewport.getBoundingClientRect();
    const hotbar = g.hotbar.getBoundingClientRect();
    const cards = Array.from(document.querySelectorAll("#recipeList .recipe-card"));
    return {
      hidden: document.getElementById("workbenchOverlay").hidden,
      fits: panel.top >= viewport.top - 1 &&
        panel.bottom <= hotbar.top + 1 &&
        panel.left >= viewport.left - 1 &&
        panel.right <= viewport.right + 1,
      recipes: cards.length,
      available: cards.filter((card) => card.classList.contains("is-available")).length,
      unavailableDisabled: cards
        .filter((card) => card.classList.contains("is-unavailable"))
        .every((card) => card.querySelector(".craft-button").disabled),
      panelTop: panel.top,
      panelBottom: panel.bottom,
      panelLeft: panel.left,
      panelRight: panel.right,
      hotbarTop: hotbar.top,
      viewportTop: viewport.top,
      viewportLeft: viewport.left,
      viewportRight: viewport.right
    };
  })()`);
  check("the workbench opens on mobile", mobileWorkbenchLayout.hidden === false);
  check("the mobile workbench fits above the equipment bar", mobileWorkbenchLayout.fits === true, JSON.stringify(mobileWorkbenchLayout));
  check(
    "the mobile workbench shows held-material recipes and disables unavailable ones",
    mobileWorkbenchLayout.recipes > 0 &&
    mobileWorkbenchLayout.available > 0 &&
    mobileWorkbenchLayout.unavailableDisabled,
    JSON.stringify(mobileWorkbenchLayout)
  );
  await cdp.screenshot(join(shotDir, "browser-mobile-workbench.png"));
  await cdp.evaluate("document.getElementById('closeWorkbench').click(); true");
  await delay(100);

  await cdp.send("Emulation.clearDeviceMetricsOverride");

  // An empty seed field must generate a random seed.
  const randomSeedUrl = new URL(gameUrl);
  randomSeedUrl.searchParams.delete("seed");
  await cdp.send("Page.navigate", { url: randomSeedUrl.href });
  const randomPageReady = await waitForGame(cdp);
  check("a fresh page without a seed boots", randomPageReady);
  await delay(260);
  const emptySeedInput = await cdp.evaluate("document.getElementById('seedInput').value");
  check("the seed input is optional and empty when no seed is supplied", emptySeedInput === "", emptySeedInput);
  await cdp.evaluate("document.getElementById('startGameBtn').click(); true");
  await delay(700);
  const randomStarted = await cdp.evaluate(STATE_EXPRESSION);
  check(
    "starting without a seed generates one automatically",
    randomStarted.seedCode.length > 0 && Number.isFinite(randomStarted.seed) && randomStarted.urlSeed === randomStarted.seedCode,
    JSON.stringify({ seedCode: randomStarted.seedCode, urlSeed: randomStarted.urlSeed })
  );

  // Arbitrary Chinese/English/numeric seeds are accepted without a length cap.
  const longSeed = "中文World123_" + "超长种子ABC".repeat(18);
  const seedUrl = new URL(gameUrl);
  seedUrl.searchParams.set("seed", longSeed);
  await cdp.send("Page.navigate", { url: seedUrl.href });
  const seedPageReady = await waitForGame(cdp);
  check("a fresh page with a long text seed boots", seedPageReady);
  await delay(260);
  const longSeedStart = await cdp.evaluate(`(() => ({
    hidden: document.getElementById("startScreen").hidden,
    value: document.getElementById("seedInput").value,
    maxLength: document.getElementById("seedInput").maxLength
  }))()`);
  check(
    "the start screen accepts the full Chinese/English/numeric seed",
    longSeedStart.hidden === false && longSeedStart.value === longSeed && longSeedStart.maxLength === -1,
    JSON.stringify({ length: longSeedStart.value.length, expected: longSeed.length, maxLength: longSeedStart.maxLength })
  );
  await cdp.evaluate("document.getElementById('startGameBtn').click(); true");
  await delay(700);
  const longSeedStarted = await cdp.evaluate(STATE_EXPRESSION);
  check(
    "the long text seed is displayed and kept in the URL",
    longSeedStarted.seedCode === longSeed &&
    longSeedStarted.urlSeed === longSeed &&
    Number.isFinite(longSeedStarted.seed),
    JSON.stringify({ seedCodeLength: longSeedStarted.seedCode.length, expected: longSeed.length })
  );

  check("no uncaught JavaScript errors", cdp.consoleErrors.length === 0, cdp.consoleErrors.join(" | "));

  ws.close();
  console.log("\n  " + passed + " passed, " + failed + " failed\n");
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("\nBrowser check crashed:", error.stack || error.message);
  process.exitCode = 1;
});
