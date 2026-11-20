/* =========================================================
   Game bootstrap: input, camera-locked loop, HUD, inventory,
   surface-resource mining and world reset.
   ========================================================= */

(function () {
  "use strict";

  const { CONFIG, FEATURE, TERRAIN, TERRAIN_META } = Wilds;

  const MINING_RANGE = 2;
  const PICKUP_RADIUS = CONFIG.TILE_SIZE * 0.8;
  const BASE_MINING_DURATION_MS = 650;
  const HAND_MINING_MULTIPLIER = 4;
  const ITEM_DETAIL_TIMEOUT_MS = 7000;
  const MOB_DEATH_ANIMATION_MS = 800;
  const MINIMAP_SCALE = 4;
  const MAP_SCALE = 8;
  const MAP_COLORS = Object.freeze({
    ocean: "#2d6470",
    grass: "#5c7f47",
    rock: "#6c6a5f",
    unknown: "#0a130d",
  });

  const MOB_TYPES = Object.freeze({
    small_fish:Object.freeze({name:"小鱼",maxHealth:30,speed:34,monster:false,aquatic:true,drops:[["raw_fish",1]]}),
    shark:Object.freeze({name:"鲨鱼",maxHealth:120,speed:44,monster:false,aquatic:true,damage:25,drops:[["deep_sea_gills",1]]}),
    sheep: Object.freeze({ name: "羊", maxHealth: 80, speed: 22, monster: false, drops: [["wool", 1], ["raw_mutton", 1]] }),
    algorithm_chicken: Object.freeze({ name: "算法鸡", maxHealth: 50, speed: 30, monster: false, drops: [["algorithm_chicken_leg", 1]] }),
    pig: Object.freeze({ name: "猪", maxHealth: 100, speed: 22, monster: false, drops: [["raw_pork", 1]] }),
    spider: Object.freeze({ name: "蜘蛛", maxHealth: 100, speed: 28, monster: true, attack: "melee", damage: 15, drops: [["spider_leg", 1]] }),
    dark_lucian: Object.freeze({name:"黑化卢锡安",maxHealth:100,speed:26,monster:true,attack:"culling",damage:10,drops:[["lucian_holy_gun",1]]}),
    enderman: Object.freeze({ name: "末影人", maxHealth: 90, speed: 30, monster: true, attack: "melee", damage: 30, drops: [["enderman_portal_fragment", 1]] }),
    zombie: Object.freeze({ name: "僵尸", maxHealth: 70, speed: 28, monster: true, attack: "melee", damage: 15, drops: [["zombie_elbow", 1]] }),
    savage_archer: Object.freeze({ name: "野人射手", maxHealth: 55, speed: 22, monster: true, attack: "ranged", damage: 25, drops: [["silk", 1]] }),
  });

  const MOVEMENT_CODES = new Set([
    "KeyW",
    "KeyA",
    "KeyS",
    "KeyD",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "ShiftLeft",
    "ShiftRight",
  ]);

  const PREVENT_SCROLL_CODES = new Set([
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Space",
  ]);

  const SKILL_KEY_ROWS = [
    ["Escape", ..."1234567890".split("").map(key => "Digit" + key)],
    ["Tab", ..."QWERTYUIOP".split("").map(key => "Key" + key)],
    [..."ASDFGHJKL".split("").map(key => "Key" + key)],
    ["ShiftLeft", ..."ZXCVBNM".split("").map(key => "Key" + key), "ShiftRight"],
    ["Space", "ArrowLeft", "ArrowUp", "ArrowDown", "ArrowRight"],
  ];
  const SKILL_KEY_LABELS = {
    Escape: "Esc", Tab: "Tab", ShiftLeft: "Shift", ShiftRight: "Shift", Space: "空格",
    ArrowLeft: "←", ArrowUp: "↑", ArrowDown: "↓", ArrowRight: "→",
  };
  const FIXED_KEYS = {
    Escape: "退出", Tab: "按键切换", Space: "暂停",
    KeyW: "向上", KeyA: "向左", KeyS: "向下", KeyD: "向右",
    ArrowUp: "向上", ArrowLeft: "向左", ArrowDown: "向下", ArrowRight: "向右",
    ShiftLeft: "奔跑", ShiftRight: "奔跑", KeyM: "地图",
  };

  // Higher overlays come first. Gameplay state and audio don't depend on this list.
  const GAME_PANELS = {
    exitConfirmation: { overlay: "exitConfirmOverlay", layered: true },
    skillKeyboard: { overlay: "skillKeyboard", layered: true },
    summoner: { overlay: "summonerOverlay" },
    map: {
      overlay: "mapOverlay",
      onClose(game) {
        game.mapPortalTarget = null;
        game.mapDragging = false;
        game.worldMapCanvas.classList.remove("is-dragging");
      },
    },
    backpack: {
      overlay: "backpackOverlay",
      onClose(game) {
        game.swapSelection = null;
        game.creativePick = null;
        game.bagButton.setAttribute("aria-expanded", "false");
        game.selectedSlot = null;
        game.renderInventory();
        game.syncHeldStats();
      },
    },
    workbench: {
      overlay: "workbenchOverlay",
      onClose(game) { game.workbenchFeedback.textContent = ""; },
    },
    storage: {
      overlay: "storageOverlay",
      onClose(game) { game.panelSelection = null; game.storageObject = null; },
    },
    furnace: {
      overlay: "furnaceOverlay",
      onClose(game) { game.panelSelection = null; game.furnaceObject = null; },
    },
    stele: { overlay: "steleOverlay" },
  };
  const GAME_PANEL_NAMES = Object.keys(GAME_PANELS);

  function skillKeyLabel(code) {
    return SKILL_KEY_LABELS[code] || code.replace(/^(Key|Digit)/, "");
  }

  function randomUint32() {
    if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function") {
      const buffer = new Uint32Array(1);
      globalThis.crypto.getRandomValues(buffer);
      return buffer[0];
    }

    return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  }

  function randomSeedText() {
    return (randomUint32() >>> 0).toString(16).toUpperCase().padStart(8, "0");
  }

  function seedNumberFromText(text) {
    // Keep the original short hexadecimal seeds compatible, then support
    // any Chinese/English/numeric text seed by hashing it deterministically.
    if (/^[0-9a-fA-F]{1,8}$/.test(text)) {
      return parseInt(text, 16) >>> 0;
    }

    let hash = 0x811c9dc5;
    for (const character of text) {
      const code = character.codePointAt(0);
      hash ^= code;
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }

  function formatCoordinate(value) {
    const sign = value < 0 ? "−" : "+";
    return sign + String(Math.abs(value)).padStart(4, "0");
  }

  function seedFromLocation() {
    try {
      const raw = new URLSearchParams(window.location.search).get("seed");
      if (raw && raw.length > 0) return raw;
    } catch (error) {
      // A restrictive file:// environment can reject URL parsing.
    }

    return null;
  }

  function storeSeedInLocation(seedText) {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("seed", seedText);
      window.history.replaceState(null, "", url);
    } catch (error) {
      // The seed still lives in memory if history is unavailable.
    }
  }

  class Game {
    constructor() {
      this.canvas = document.getElementById("game");
      this.viewport = document.getElementById("viewport");
      this.startScreen = document.getElementById("startScreen");
      this.seedInput = document.getElementById("seedInput");
      this.startGameButton = document.getElementById("startGameBtn");
      this.minimapCanvas = document.getElementById("minimap");
      this.minimapCtx = this.minimapCanvas.getContext("2d");
      this.minimapCtx.imageSmoothingEnabled = false;
      this.seedCode = document.getElementById("seedCode");
      this.newWorldBtn = document.getElementById("newWorldBtn");
      this.terrainChip = document.getElementById("terrainChip");
      this.terrainName = document.getElementById("terrainName");
      this.coordReadout = document.getElementById("coordReadout");
      this.startHint = document.getElementById("startHint");
      this.sceneFlash = document.getElementById("sceneFlash");

      this.mapOverlay = document.getElementById("mapOverlay");
      this.closeMapButton = document.getElementById("closeMap");
      this.worldMapCanvas = document.getElementById("worldMap");
      this.worldMapCtx = this.worldMapCanvas.getContext("2d");
      this.worldMapCtx.imageSmoothingEnabled = false;
      this.mapRespawnCoords = document.getElementById("mapRespawnCoords");
      this.mapExploredCount = document.getElementById("mapExploredCount");
      this.creativeFlightHint = document.getElementById("creativeFlightHint");
      this.switchGameModeButton = document.getElementById("switchGameMode");
      this.exitConfirmOverlay = document.getElementById("exitConfirmOverlay");
      this.returnCreativeAfterDeathButton = document.getElementById("returnCreativeAfterDeath");
      this.mapActionHint = document.getElementById("mapActionHint");
      this.deathOverlay = document.getElementById("deathOverlay");
      this.respawnButton = document.getElementById("respawnButton");
      this.deathNewGameBtn = document.getElementById("deathNewGameBtn");
      this.deathHint = document.getElementById("deathHint");
      this.deathTitle = document.getElementById("deathTitle");
      this.deathNoRespawn = document.getElementById("deathNoRespawn");

      this.gameClockBox = document.getElementById("gameClockBox");
      this.gameClock = document.getElementById("gameClock");
      this.dayCount = document.getElementById("dayCount");
      this.phaseLabel = document.getElementById("phaseLabel");

      this.vitalsPanel = document.getElementById("vitalsPanel");
      this.statePill = document.getElementById("statePill");
      this.stateLabel = document.getElementById("stateLabel");
      this.healthValue = document.getElementById("healthValue");
      this.oxygenValue = document.getElementById("oxygenValue");
      this.satietyValue = document.getElementById("satietyValue");
      this.healthFill = document.getElementById("healthFill");
      this.oxygenFill = document.getElementById("oxygenFill");
      this.satietyFill = document.getElementById("satietyFill");
      this.healthTrack = document.getElementById("healthTrack");
      this.oxygenTrack = document.getElementById("oxygenTrack");
      this.satietyTrack = document.getElementById("satietyTrack");
      this.gameToast = document.getElementById("gameToast");
      this.foodRestriction = document.getElementById("foodRestriction");
      this.sleepOverlay = document.getElementById("sleepOverlay");

      this.hotbar = document.getElementById("hotbar");
      this.bagButton = document.getElementById("bagButton");
      this.backpackOverlay = document.getElementById("backpackOverlay");
      this.backpackGrid = document.getElementById("backpackGrid");
      this.creativeCatalogue = document.getElementById("creativeCatalogue");
      this.creativeItemGrid = document.getElementById("creativeItemGrid");
      this.creativeCategories = document.getElementById("creativeCategories");
      this.closeBackpackButton = document.getElementById("closeBackpack");
      this.sortBackpackButton = document.getElementById("sortBackpack");
      this.workbenchOverlay = document.getElementById("workbenchOverlay");
      this.closeWorkbenchButton = document.getElementById("closeWorkbench");
      this.recipeList = document.getElementById("recipeList");
      this.workbenchFeedback = document.getElementById("workbenchFeedback");
      this.steleOverlay = document.getElementById("steleOverlay");
      this.storageOverlay = document.getElementById("storageOverlay");
      this.chestGrid = document.getElementById("chestGrid");
      this.chestEquipmentGrid = document.getElementById("chestEquipmentGrid");
      this.chestBackpackGrid = document.getElementById("chestBackpackGrid");
      this.closeStorageButton = document.getElementById("closeStorage");
      this.furnaceOverlay = document.getElementById("furnaceOverlay");
      this.furnaceBackpackGrid = document.getElementById("furnaceBackpackGrid");
      this.furnaceEquipmentGrid = document.getElementById("furnaceEquipmentGrid");
      this.furnaceFuel = document.getElementById("furnaceFuel");
      this.furnaceFeedback = document.getElementById("furnaceFeedback");
      this.closeFurnaceButton = document.getElementById("closeFurnace");
      this.closeSteleButton = document.getElementById("closeStele");
      this.steleTitle = document.getElementById("steleTitle");
      this.steleText = document.getElementById("steleText");
      this.itemDetail = document.getElementById("itemDetail");
      this.itemDetailName = document.getElementById("itemDetailName");
      this.itemDetailType = document.getElementById("itemDetailType");
      this.itemDetailDescription = document.getElementById("itemDetailDescription");
      this.itemDetailCount = document.getElementById("itemDetailCount");
      this.itemDetailMax = document.getElementById("itemDetailMax");
      this.itemDetailDurabilityRow = document.getElementById("itemDetailDurabilityRow");
      this.itemDetailDurability = document.getElementById("itemDetailDurability");
      this.itemDetailDurabilityMax = document.getElementById("itemDetailDurabilityMax");

      this.keys = new Set();
      this.started = false;
      this.elapsed = 0;
      this.lastFrameTime = 0;
      this.lastTileX = null;
      this.lastTileY = null;
      this.lastTerrain = null;
      this.lastHealthText = null;
      this.lastOxygenText = null;
      this.lastSatietyText = null;
      this.lastDiving = null;
      this.lastClockText = null;
      this.lastClockDay = null;
      this.lastClockPhase = null;
      this.hintHidden = false;
      this.satietyGraceRemaining = CONFIG.SATIETY_GRACE_HOURS;
      this.running = true;
      this.paused = false;
      this.pauseOverlay = document.getElementById("pauseOverlay");
      this.skillKeyboard = document.getElementById("skillKeyboard");
      this.skillKeyboardGrid = document.getElementById("skillKeyboardGrid");
      this.summonerOverlay = document.getElementById("summonerOverlay");
      this.summonerStatus = document.getElementById("summonerStatus");
      this.summonerSpells = document.getElementById("summonerSpells");
      document.getElementById("closeSummoner").addEventListener("click", () => this.closeGamePanel("summoner"));
      this.summonerSpells.addEventListener("click", event => {
        const spell = event.target.closest("[data-spell]");
        if (spell && this.summoner?.select(spell.dataset.spell)) this.renderInventory();
      });
      document.getElementById("closeSkillKeyboard").addEventListener("click", () => this.toggleSkillKeyboard());
      document.getElementById("resumeGame").addEventListener("click",()=>this.togglePause());

      this.inventory = new Wilds.Inventory();
      this.sessionMode = "survival";
      this.gameMode = "survival";
      this.creativeCategory = "tools";
      this.creativePick = null;
      // Keep the first held slot empty; the starting scroll belongs in slot two.
      this.inventory.addEquipment("creation_scroll");
      this.inventory.swap({ area: "equipment", index: 0 }, { area: "equipment", index: 1 });
      this.inventoryButtons = { equipment: [], backpack: [] };
      this.heldSlotIndex = 0;
      this.swapSelection = null;
      this.panelSelection = null;
      Object.defineProperty(this,"selectedSlot",{
        get:()=>({area:"equipment",index:this.heldSlotIndex}),
        set:value=>{if(value?.area==="equipment" && Number.isInteger(value.index) && value.index>=0 && value.index<8)this.heldSlotIndex=value.index;},
      });
      this.lastSlotClick = null;
      this.backpackOpen = false;
      this.workbenchOpen = false;
      this.steleOpen = false;
      this.storageOpen = false;
      this.furnaceOpen = false;
      this.storageObject = null;
      this.furnaceObject = null;
      this.itemDetailTimer = 0;

      this.drops = [];
      this.dropSequence = 0;
      this.mobs = [];
      this.mobSequence = 0;
      this.projectiles = [];
      this.giftEffects = [];
      this.mobSpawnTimer = 0;
      this.animalTarget = 3;
      this.monsterTarget = 3;
      this.nextAttackAt = 0;
      this.sleeping = false;
      this.sleepTimer = 0;
      this.sleepTimeout = 0;
      this.toastTimer = 0;
      this.foodPress = null;
      this.suppressSlotClickUntil = 0;
      this.combatMusicUntil = 0;
      this.audio = new Wilds.AudioDirector();
      this.placedObjects = new Map();
      this.placedObjectTiles = new Map();
      this.activeRespawnSteles = new Set();
      this.placedObjectSequence = 0;
      this.lastPlayerSafe = null;
      this.explored = new Set();
      this.exploredRadius = 18;
      this.lastExploredTileX = null;
      this.lastExploredTileY = null;
      this.baseRespawn = null;
      // The destination selected for the current death.
      this.respawn = null;
      this.lastDeath = null;
      this.mapOpen = false;
      this.mapPortalTarget = null;
      this.isDead = false;
      this.mapCamX = 0;
      this.mapCamY = 0;
      this.mapDragging = false;
      this.mapDragLastX = 0;
      this.mapDragLastY = 0;
      this.minimapAccumulator = 0;
      this.pointerTile = null;
      this.pointerClientX = 0;
      this.pointerClientY = 0;
      this.pointerInside = false;
      this.pointerId = null;
      this.hoverTarget = null;
      this.mining = null;
      this.objectClickCandidate = null;

      this.clock = new Wilds.GameClock();
      this.renderer = new Wilds.Renderer(this.canvas);
      this.world = null;
      this.player = null;
      this.seed = null;
      this.seedText = "";
      this.requestedSeed = seedFromLocation();
      this.seedInput.value = this.requestedSeed || "";

      this.buildInventory();
      this.buildRecipes();
      this.bindEvents();
      this.bindInventoryEvents();
      this.bindMiningEvents();
      this.bindMapEvents();
      this.bindStartScreen();
      this.regenerate(true, this.requestedSeed);

      this.loop = this.loop.bind(this);
      requestAnimationFrame(this.loop);

      // Exposed for debugging and for the project's browser checks.
      globalThis.wildsGame = this;
    }

    /* ---------------- Death and respawn ---------------- */

    deathReasonText(cause = this.player?.deathCause) {
      if (cause?.type === "drowning") return "你淹死了";
      if (cause?.type === "starvation") return "你饿死了";
      if (cause?.type === "monster" && cause.skill === "culling") return "你被黑化卢锡安的圣枪洗礼打死了。";
      if (cause?.type === "monster") return "你被【" + (cause.name || "未知怪物") + "】击败了";
      if (cause?.type === "food") return cause.name ? "你吃【" + cause.name + "】食物中毒死了" : "你食物中毒死了";
      return "你死了";
    }

    die() {
      if (this.isCreative()) return;
      if (this.isDead || !this.player) return;

      this.isDead = true;
      this.summoner?.onDeath();
      if (this.deathTitle) this.deathTitle.textContent = this.deathReasonText();
      this.player.health = 0;
      this.keys.clear();
      this.combatMusicUntil = 0;
      this.closeSleep();
      this.holyGunCasts=[];
      this.clearPortalEffects();
      this.clearFoodPress();
      this.closeGamePanels();
      this.releaseMiningPointer();
      this.cancelMining();
      this.pointerInside = false;
      this.pointerTile = null;
      this.hoverTarget = null;
      this.selectedSlot = null;
      this.lastSlotClick = null;
      this.hideItemDetails();
      this.syncHeldStats();

      const tx = this.player.tileX;
      const ty = this.player.tileY;
      for (const area of ["equipment", "backpack"]) {
        const slots = this.inventory.getSlots(area);
        for (let i = 0; i < slots.length; i += 1) {
          const stack = slots[i];
          if (!stack) continue;
          this.spawnDrop(stack.itemId, stack.count, tx, ty, stack.durability, stack.skillReadyAt);
          slots[i] = null;
        }
      }
      this.renderInventory();
      this.lastDeath = { tx, ty };
      this.respawn = this.nearestRespawnStele(this.player.x, this.player.y);
      const canRespawn = Boolean(this.respawn);
      this.deathHint.hidden = !canRespawn;
      this.respawnButton.hidden = !canRespawn;
      this.deathNoRespawn.hidden = canRespawn;
      this.deathNewGameBtn.hidden = canRespawn;
      this.deathOverlay.hidden = false;
      this.bagButton.disabled = true;
      this.player.moving = false;
      this.player.speed = 0;
      this.syncHud(true);
      this.drawMinimap();
    }

    closeDeath() {
      this.isDead = false;
      this.respawn = null;
      this.deathOverlay.hidden = true;
      this.deathHint.hidden = false;
      this.respawnButton.hidden = false;
      this.deathNoRespawn.hidden = true;
      this.deathNewGameBtn.hidden = true;
      this.bagButton.disabled = Boolean(this.activeGamePanel());
    }

    findRespawnPosition(tx, ty) {
      const offsets = [
        [1, 0], [-1, 0], [0, 1], [0, -1],
        [1, 1], [1, -1], [-1, 1], [-1, -1],
      ];
      for (const [dx, dy] of offsets) {
        const x = tx + dx;
        const y = ty + dy;
        const terrain = this.world.terrainAt(x, y);
        if (terrain === TERRAIN.OCEAN && !this.hasWaterSupport(x, y)) continue;
        if (this.isGroundBlockedForCreature(x, y)) continue;
        return { tx: x, ty: y };
      }
      return { tx, ty };
    }

    nearestRespawnStele(x, y) {
      let nearest = null;
      let nearestDistanceSquared = Infinity;
      for (const stele of this.activeRespawnSteles) {
        const dx = (stele.tx + 0.5) * CONFIG.TILE_SIZE - x;
        const dy = (stele.ty + 0.5) * CONFIG.TILE_SIZE - y;
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared < nearestDistanceSquared) {
          nearest = stele;
          nearestDistanceSquared = distanceSquared;
        }
      }
      return nearest;
    }

    respawnPlayer() {
      if (!this.isDead || !this.respawn) return;
      const point = this.respawn;
      const spot = this.findRespawnPosition(point.tx, point.ty);
      const tx = spot.tx;
      const ty = spot.ty;

      this.isDead = false;
      this.respawn = null;
      this.deathOverlay.hidden = true;
      this.player.x = (tx + 0.5) * CONFIG.TILE_SIZE;
      this.player.y = (ty + 0.5) * CONFIG.TILE_SIZE;
      this.lastPlayerSafe = { x: this.player.x, y: this.player.y };
      this.player.facing = "down";
      this.player.moving = false;
      this.player.speed = 0;
      this.player.health = this.player.maxHealth;
      this.player.oxygen = this.player.maxOxygen;
      this.player.satiety = this.player.maxSatiety;
      this.satietyGraceRemaining = CONFIG.SATIETY_GRACE_HOURS;
      this.player.clearNegativeEffects();
      this.player.deathCause = null;
      this.player.isDiving = this.player.waterDepth === 2;
      this.player.isWading = this.player.waterDepth === 1;
      this.player.attackDamage = this.player.baseAttackDamage;
      this.keys.clear();
      this.releaseMiningPointer();
      this.cancelMining();
      this.pointerInside = false;
      this.pointerTile = null;
      this.hoverTarget = null;
      this.selectedSlot = {area:"equipment",index:0};
      this.swapSelection=null;
      this.lastSlotClick = null;
      this.hideItemDetails();
      this.syncHeldStats();
      this.bagButton.disabled = false;
      this.lastTileX = null;
      this.lastTileY = null;
      this.lastTerrain = null;
      this.lastHealthText = null;
      this.lastOxygenText = null;
      this.lastSatietyText = null;
      this.lastDiving = null;
      this.revealExplored(tx, ty);
      this.updateExplored();
      this.syncHud(true);
      this.drawMinimap();
    }


    togglePause() {
      if(!this.started || this.isDead)return;
      const now=performance.now();
      if(!this.paused) {
        if(this.sleeping && this.sleepTimeout){this.sleepRemainingMs=Math.max(0,this.sleepFinishAt-now);window.clearTimeout(this.sleepTimeout);this.sleepTimeout=0;}
        this.paused=true;this.pauseStartedAt=now;
        this.keys.clear();this.cancelMining();this.clearFoodPress();this.player.moving=false;
        this.audio?.ctx?.suspend?.();
      } else {
        const elapsed=now-this.pauseStartedAt;
        for(const drop of this.drops){drop.createdAt+=elapsed;drop.expiresAt+=elapsed;}
        for(const mob of this.mobs)for(const key of ["fleeUntil","attackAt","nextDecisionAt","hitFlashUntil","deathStartedAt"])if(mob[key]>0)mob[key]+=elapsed;
        for(const key of ["nextAttackAt","combatMusicUntil","nextStepSoundAt"])if(this[key]>0)this[key]+=elapsed;
        if(this.sleeping && this.finishSleep){this.sleepFinishAt=now+this.sleepRemainingMs;this.sleepTimeout=window.setTimeout(this.finishSleep,this.sleepRemainingMs);}
        this.paused=false;this.lastFrameTime=0;this.audio?.resume?.();
      }
      if(this.pauseOverlay)this.pauseOverlay.hidden=!this.paused;
    }

    bindEvents() {
      document.addEventListener("keydown", (event) => {
        if (!this.started) return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.code === "Escape") {
          if (!event.repeat && this.closeGamePanel()) event.preventDefault();
          return;
        }
        if (this.exitConfirmationOpen) return;
        if(event.target?.matches?.("input,textarea,[contenteditable=true]"))return;
        if (event.code === "Tab" && !this.isDead && !this.sleeping) {
          event.preventDefault();
          if (!event.repeat) this.toggleSkillKeyboard();
          return;
        }
        const panel = this.activeGamePanel();
        if (panel === "skillKeyboard") return;
        if(event.code === "Space") {event.preventDefault();if(!event.repeat)this.togglePause();return;}
        if(this.paused)return;
        if(event.code === "KeyF" && !event.repeat && this.isCreative() && this.canSwitchHeldSlot()) {
          event.preventDefault(); this.player.fastTravel = !this.player.fastTravel; this.updateModeUI(); return;
        }
        const code = event.code.replace(/^Numpad([0-9])$/, "Digit$1");
        const skill = this.skillBindings.get(code);
        if (skill) {
          event.preventDefault();
          const mapCast = panel === "map" && (skill.item.skill === "portal" ||
            skill.item.skill === "summoner" && this.summoner?.selection === "teleport");
          if (!event.repeat && (this.canSwitchHeldSlot() || mapCast)) {
            if (skill.item.skill === "portal") this.startPortal(mapCast, skill);
            if (skill.item.skill === "culling") this.startHolyGun(skill);
            if (skill.item.skill === "summoner") this.summoner.start(skill, mapCast);
          }
          return;
        }

        if (this.canUseWorldInput() && MOVEMENT_CODES.has(event.code)) {
          this.keys.add(event.code);
          if (PREVENT_SCROLL_CODES.has(event.code)) {
            event.preventDefault();
          }
        }

        if (event.code === "KeyM" && !event.repeat) {
          event.preventDefault();
          this.toggleMap();
        }
      });

      document.addEventListener("keyup", (event) => {
        this.keys.delete(event.code);
      });

      document.addEventListener("wheel", (event) => {
        if (!this.canSwitchHeldSlot()) return;
        event.preventDefault();
        this.cycleHeldSlot(event.deltaY > 0 ? 1 : -1);
      }, { passive: false });

      window.addEventListener("blur", () => {
        this.keys.clear();
        this.lastFrameTime = 0;
        this.releaseMiningPointer();
        this.cancelMining();
      });

      document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
          this.keys.clear();
          this.lastFrameTime = 0;
          this.releaseMiningPointer();
          this.cancelMining();
        }
      });

      this.newWorldBtn.addEventListener("click", () => {
        this.regenerate(false);
        this.newWorldBtn.blur();
      });

      this.respawnButton.addEventListener("click", () => {
        this.respawnPlayer();
      });
      this.deathNewGameBtn.addEventListener("click", () => {
        window.location.reload();
      });
    }

    bindStartScreen() {
      for (const id of ["exitGame","exitGameFromPause","exitGameFromDeath"])
        document.getElementById(id).addEventListener("click", () => this.requestExitGame());
      document.getElementById("cancelExitGame").addEventListener("click", () => this.cancelExitGame());
      document.getElementById("confirmExitGame").addEventListener("click", () => this.returnToStart());
      this.switchGameModeButton.addEventListener("click", () => this.toggleSimulationMode());
      this.returnCreativeAfterDeathButton.addEventListener("click", () => this.toggleSimulationMode());
      this.startGameButton.addEventListener("click", () => {
        this.beginGameFromStart();
      });

      this.seedInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        this.beginGameFromStart();
      });
    }

    beginGameFromStart() {
      if (this.started) return;

      const rawSeed = this.seedInput.value;
      this.sessionMode = document.querySelector('input[name="gameMode"]:checked')?.value === "creative" ? "creative" : "survival";
      this.gameMode = this.sessionMode;
      this.inventory = new Wilds.Inventory();
      this.inventory.creative = this.isCreative();
      if (!this.isCreative()) {
        this.inventory.addEquipment("creation_scroll");
        this.inventory.swap({ area: "equipment", index: 0 }, { area: "equipment", index: 1 });
      }
      this.started = true;
      this.startScreen.hidden = true;
      document.body.classList.remove("start-mode");
      document.body.classList.add("game-mode");
      this.startGameButton.blur();
      this.seedInput.blur();
      this.requestedSeed = rawSeed.length > 0 ? rawSeed : null;
      this.lastFrameTime = 0;
      this.keys.clear();
      this.regenerate(false, this.requestedSeed);
      this.audio.start();
      this.updateAudio(performance.now());
    }

    isCreative() { return this.gameMode === "creative"; }

    toggleSimulationMode() {
      if (this.sessionMode !== "creative" || this.paused || this.sleeping) return;
      if (this.isDead) { this.closeDeath(); this.isDead = false; this.player.health = this.player.maxHealth; this.bagButton.disabled = false; }
      this.setGameMode(this.isCreative() ? "survival" : "creative");
    }

    setGameMode(mode) {
      const creative = mode === "creative";
      this.gameMode = creative ? "creative" : "survival";
      this.inventory.creative = creative;
      this.player.creative = creative; this.player.fastTravel = false;
      if (creative) {
        this.player.health = this.player.maxHealth; this.player.satiety = this.player.maxSatiety; this.player.oxygen = this.player.maxOxygen;
        this.player.deathCause = null;
        this.player.clearNegativeEffects();
        for (const mob of this.mobs) { mob.aggro = false; mob.provoked = false; mob.fleeUntil = 0; }
        this.combatMusicUntil = 0;
      }
      this.creativePick = null; this.swapSelection = null;
      this.cancelMining(); this.hideItemDetails(); this.updateModeUI(); this.renderInventory(); this.syncHeldStats(); this.syncHud(true);
    }

    updateModeUI() {
      const creative = this.isCreative();
      document.body.classList.toggle("creative-mode", creative);
      if (this.vitalsPanel) this.vitalsPanel.hidden = creative;
      if (this.creativeCatalogue) this.creativeCatalogue.hidden = !creative;
      if (this.backpackGrid) this.backpackGrid.hidden = creative;
      if (this.sortBackpackButton) this.sortBackpackButton.hidden = creative;
      const title = document.getElementById("backpackTitle"); if (title) title.textContent = creative ? "全部物品" : "背包";
      const label = this.bagButton?.querySelector("span"); if (label) label.textContent = creative ? "全部物品" : "背包";
      this.bagButton?.setAttribute("aria-label", creative ? "打开全部物品" : "打开背包");
      if (this.switchGameModeButton) {
        this.switchGameModeButton.hidden = this.sessionMode !== "creative";
        this.switchGameModeButton.textContent = creative ? "切换模拟生存" : "切换创造模式";
      }
      if (this.returnCreativeAfterDeathButton) this.returnCreativeAfterDeathButton.hidden = this.sessionMode !== "creative";
      if (this.creativeFlightHint) {
        this.creativeFlightHint.hidden = !creative;
        this.creativeFlightHint.textContent = this.player?.fastTravel ? "疾行 ×5 · 按 F 恢复" : "按 F 快速疾行";
      }
      if (creative) this.renderCreativeCatalogue();
    }

    creativeItemCategory(item) {
      if (item.placeType) return "fixtures";
      if (item.maxDurability > 0 && !item.unbreakable)
        return ["axe", "pickaxe", "shovel", "hoe"].includes(item.toolType) ? "tools" : "equipment";
      return "materials";
    }

    renderCreativeCatalogue() {
      if (!this.creativeItemGrid || !this.creativeCategories) return;
      const picked = this.inventory.itemDefinition(this.creativePick);
      document.getElementById("creativeSelectionHint").textContent = picked
        ? "已选择「" + picked.name + "」，点击装备栏放入。" : "选择物品，再点击下方装备栏放入。";
      this.creativeCategories.replaceChildren();
      for (const [id, name] of [["tools","工具"],["equipment","装备"],["materials","耗材"],["fixtures","杂物"]]) {
        const button = document.createElement("button"); button.type = "button"; button.className = "exit-button";
        button.textContent = name; button.dataset.category = id; button.setAttribute("aria-pressed", String(this.creativeCategory === id));
        button.addEventListener("click", () => {this.creativeCategory = id; this.renderCreativeCatalogue();});
        this.creativeCategories.appendChild(button);
      }
      this.creativeItemGrid.replaceChildren();
      for (const item of Object.values(Wilds.ITEMS).filter(item => this.creativeItemCategory(item) === this.creativeCategory)) {
        const button = document.createElement("button"); button.type = "button"; button.className = "inv-slot creative-item";
        button.classList.toggle("is-selected", this.creativePick === item.id); button.dataset.item = item.id; button.setAttribute("aria-label", item.name);
        button.setAttribute("aria-pressed", String(this.creativePick === item.id));
        button.innerHTML = Wilds.itemIcon(item); const name = document.createElement("span"); name.className = "creative-item-name"; name.textContent = item.name; button.appendChild(name);
        const stack = {itemId:item.id,count:this.inventory.maxStackFor(item.id),durability:item.maxDurability};
        button.addEventListener("pointerenter", () => this.showItemDetails(stack, true));
        button.addEventListener("pointerleave", () => this.hideItemDetails());
        button.addEventListener("click", () => {
          this.creativePick = item.id;
          this.renderCreativeCatalogue();
        });
        this.creativeItemGrid.appendChild(button);
      }
    }

    requestExitGame() {
      if (this.started) this.openGamePanel("exitConfirmation");
    }

    cancelExitGame() {
      this.closeGamePanel("exitConfirmation");
    }

    returnToStart() {
      this.closeSleep(); this.clearPortalEffects(); this.clearFoodPress(); this.releaseMiningPointer(); this.cancelMining();
      this.closeGamePanels();
      this.closeDeath();
      this.started = false; this.paused = false; this.pauseOverlay.hidden = true; this.isDead = false;
      this.keys.clear(); this.mobs = []; this.projectiles = []; this.drops = []; this.giftEffects = []; this.waterEffects = [];
      this.placedObjects.clear(); this.placedObjectTiles.clear(); this.explored.clear(); this.farm?.clear(); this.farmVisited?.clear(); this.farmTrees?.clear();
      this.activeRespawnSteles.clear();
      this.roomIndex = null; this.world = null; this.player = null; this.renderer.setWorld(null);
      this.summoner = null;
      this.inventory = new Wilds.Inventory(); this.holyGunCasts = []; this.lucianSpawnNights = new Set();
      this.selectedSlot = {area:"equipment",index:0}; this.swapSelection = null; this.creativePick = null; this.gameMode = "survival";
      this.lastFrameTime = 0; this.elapsed = 0; this.seed = null; this.seedText = "";
      if (this.audio?.timer) window.clearInterval(this.audio.timer);
      this.audio?.animalSound?.pause(); this.audio?.ctx?.close()?.catch?.(() => {}); this.audio = new Wilds.AudioDirector();
      document.body.classList.remove("game-mode", "creative-mode"); document.body.classList.add("start-mode");
      this.startScreen.hidden = false; this.hintHidden = false; this.startHint.classList.remove("is-hidden"); this.hideItemDetails(); this.renderInventory();
    }

    updateAudio(now) {
      if (!this.audio || !this.started) return;
      const monsterVisible =
        !this.isDead &&
        this.mobs.some((mob) => mob.monster && !mob.dying && mob.aggro);
      if (monsterVisible) {
        this.combatMusicUntil = now + 4000;
      }
      if (this.player?.moving && this.canUseWorldInput()) {
        const last = this.lastStepPosition;
        if (last && Math.hypot(this.player.x-last.x,this.player.y-last.y)>0.05 && now >= (this.nextStepSoundAt || 0)) {
          const medium = this.player.waterDepth ? "water" : this.player.terrain === TERRAIN.ROCK ? "rock" : "grass";
          this.audio.playFootstep?.(medium); this.nextStepSoundAt=now+320;
        }
      }
      if (this.player) this.lastStepPosition={x:this.player.x,y:this.player.y};
      this.audio.update({
        phase: this.clock.phase.key,
        day: this.clock.day,
        combat: !this.isDead && now < this.combatMusicUntil,
      });
    }

    regenerate(initial, forcedSeed) {
      this.paused=false;if(this.pauseOverlay)this.pauseOverlay.hidden=true;
      const previousSeed = this.seed;
      const hasForcedSeed =
        (typeof forcedSeed === "string" && forcedSeed.length > 0) ||
        Number.isFinite(forcedSeed);
      let seedText;

      if (typeof forcedSeed === "string" && forcedSeed.length > 0) {
        seedText = forcedSeed;
      } else if (Number.isFinite(forcedSeed)) {
        seedText = (forcedSeed >>> 0).toString(16).toUpperCase().padStart(8, "0");
      } else {
        seedText = randomSeedText();
      }

      let nextSeed = seedNumberFromText(seedText);
      // A new random world should not repeat the current seed.
      let attempts = 0;
      while (!initial && !hasForcedSeed && nextSeed === previousSeed && attempts < 8) {
        seedText = randomSeedText();
        nextSeed = seedNumberFromText(seedText);
        attempts += 1;
      }

      this.seed = nextSeed;
      this.seedText = seedText;
      const testMap = this.started && seedText === Wilds.TestMap.seedText ? Wilds.TestMap : null;
      this.world = Wilds.World.createWorld(nextSeed, testMap?.layout);
      this.initFarming();
      this.firstNightLucianSpawned=false;
      this.firstNightLucianHour=20+Math.random()*3;
      this.nextFirstNightLucianAttempt=0;
      this.lucianSpawnNights=new Set();
      this.holyGunTime=0;this.holyGunCasts=[];
      this.summoner = new Wilds.SummonerBracelet(this);
      this.skillKeyPreferences = new Map();
      this.skillReadyAtByItem = new Map();
      this.portalEffects = []; this.portalSequence = 0;
      this.player = new Wilds.Player(this.world);
      this.player.creative = this.isCreative();
      this.player.isBlockedTile = (tx, ty) => this.isGroundBlockedForCreature(tx, ty);
      this.player.isSupportedTile = (tx, ty) => this.hasWaterSupport(tx, ty);
      this.player.isBlockedArea = (l, t, r, b) => this.groundAreaBlocked(l, t, r, b);
      this.lastPlayerSafe = { x: this.player.x, y: this.player.y };
      this.satietyGraceRemaining = CONFIG.SATIETY_GRACE_HOURS;
      this.renderer.setWorld(this.world);
      this.clock.reset();

      this.closeDeath();
      this.closeGamePanels();
      this.closeSleep();
      this.clearFoodPress();
      this.combatMusicUntil = 0;
      this.isDead = false;
      this.baseRespawn = null;
      this.lastDeath = null;
      this.explored.clear();
      this.lastExploredTileX = null;
      this.lastExploredTileY = null;
      this.revealExplored(this.player.tileX, this.player.tileY);
      this.minimapAccumulator = 0;

      this.drops = [];
      this.placedObjects.clear();
      this.placedObjectTiles.clear();
      this.activeRespawnSteles.clear();
      if (testMap) {
        testMap.populate(this.farm, (itemId, tx, ty) => {
          this.addPlacedObject(Wilds.ITEMS[itemId], tx, ty, [{ tx, ty }]);
        });
        this.clock.setTimeOfDay(testMap.startHour);
      }
      this.invalidateRooms();
      this.mobs = [];
      this.projectiles = [];
      this.giftEffects = [];
      this.releaseMiningPointer();
      this.cancelMining();
      this.pointerInside = false;
      this.pointerTile = null;
      this.hoverTarget = null;
      this.selectedSlot = {area:"equipment",index:0};
      this.swapSelection=null;
      this.hideItemDetails();
      this.renderInventory();
      this.syncHeldStats();

      this.lastTileX = null;
      this.lastTileY = null;
      this.lastTerrain = null;
      this.lastClockText = null;
      this.lastClockDay = null;
      this.lastClockPhase = null;
      this.seedCode.textContent = this.seedText;
      storeSeedInLocation(this.seedText);

      this.updateModeUI();
      this.syncHud(true);
      this.drawMinimap();

      if (!initial) {
        this.flashWorld();
      }
    }

    flashWorld() {
      this.sceneFlash.classList.remove("is-flashing");
      // Force a reflow so the animation can restart immediately.
      void this.sceneFlash.offsetWidth;
      this.sceneFlash.classList.add("is-flashing");
    }

    canSwitchHeldSlot() {
      return this.started && this.canUseWorldInput();
    }

    activeGamePanel() {
      return GAME_PANEL_NAMES.find(name => this[name + "Open"]);
    }

    canUseWorldInput() {
      return !this.paused && !this.isDead && !this.sleeping && !this.activeGamePanel();
    }

    openGamePanel(name) {
      const panel = GAME_PANELS[name];
      if (this[name + "Open"]) return false;
      if (!panel.layered) this.closeGamePanels();

      this.keys.clear();
      this.releaseMiningPointer();
      this.cancelMining();
      this.clearFoodPress();
      this.pointerInside = false;
      this.pointerTile = null;
      this.hoverTarget = null;
      this.hideItemDetails();
      this[name + "Open"] = true;
      this[panel.overlay].hidden = false;
      this.bagButton.disabled = true;
      return true;
    }

    closeGamePanel(name = this.activeGamePanel()) {
      if (!name || !this[name + "Open"]) return false;
      const panel = GAME_PANELS[name];
      this[name + "Open"] = false;
      this[panel.overlay].hidden = true;
      panel.onClose?.(this);
      this.clearFoodPress();
      this.hideItemDetails();
      this.bagButton.disabled = this.isDead || Boolean(this.activeGamePanel());
      return true;
    }

    closeGamePanels() {
      for (const name of GAME_PANEL_NAMES) this.closeGamePanel(name);
    }

    getEquippedSkills() {
      const skills = [];
      const seen = new Set();
      this.inventory.equipment.forEach((stack, index) => {
        const item = this.inventory.itemDefinition(stack?.itemId);
        if (!item?.skill || seen.has(item.id)) return;
        seen.add(item.id);
        skills.push({ area: "equipment", index, item, stack });
      });
      return skills;
    }

    fixedKeyAction(code) {
      if (code === "KeyF" && this.sessionMode === "creative") {
        return this.isCreative() ? "快速疾行" : "创造模式疾行";
      }
      return FIXED_KEYS[code];
    }

    updateSkillBindings() {
      const skills = this.getEquippedSkills();
      const bindings = new Map();
      const unassigned = [];
      for (const skill of skills) {
        const preferred = this.skillKeyPreferences?.get(skill.item.id);
        if (preferred && !this.fixedKeyAction(preferred) && !bindings.has(preferred)) {
          bindings.set(preferred, skill);
        } else {
          unassigned.push(skill);
        }
      }
      for (const skill of unassigned) {
        let code = "Digit" + (skill.index + 1);
        if (bindings.has(code)) {
          code = SKILL_KEY_ROWS[0].slice(1, 9).find(key => !bindings.has(key));
        }
        bindings.set(code, skill);
      }
      this.skillBindings = bindings;
    }

    toggleSkillKeyboard() {
      if (this.closeGamePanel("skillKeyboard")) return;
      this.openGamePanel("skillKeyboard");
      this.renderSkillKeyboard();
      document.getElementById("closeSkillKeyboard").focus();
    }

    renderSkillKeyboard() {
      this.skillKeyboardGrid.replaceChildren();
      for (const row of SKILL_KEY_ROWS) {
        const keys = document.createElement("div");
        keys.className = "skill-key-row";
        for (const code of row) {
          const key = document.createElement("div");
          key.className = "skill-key";
          key.dataset.code = code;
          const label = document.createElement("kbd");
          label.textContent = skillKeyLabel(code);
          key.appendChild(label);

          const action = this.fixedKeyAction(code);
          const skill = this.skillBindings.get(code);
          if (action) {
            key.classList.add("is-fixed");
            const caption = document.createElement("span");
            caption.textContent = action;
            key.appendChild(caption);
          } else {
            if (skill) {
              const icon = document.createElement("div");
              icon.className = "skill-key-icon";
              icon.draggable = true;
              icon.title = skill.item.name;
              icon.setAttribute("aria-label", skill.item.name);
              icon.innerHTML = Wilds.itemIcon(skill.item);
              icon.addEventListener("dragstart", event => {
                event.dataTransfer.setData("text/plain", code);
                event.dataTransfer.effectAllowed = "move";
              });
              key.appendChild(icon);
            }
            key.addEventListener("dragover", event => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            });
            key.addEventListener("drop", event => {
              event.preventDefault();
              this.moveSkillBinding(event.dataTransfer.getData("text/plain"), code);
            });
          }
          keys.appendChild(key);
        }
        this.skillKeyboardGrid.appendChild(keys);
      }
    }

    moveSkillBinding(from, to) {
      const skill = this.skillBindings.get(from);
      if (!skill || from === to || this.fixedKeyAction(to) || !SKILL_KEY_ROWS.some(row => row.includes(to))) return;
      const other = this.skillBindings.get(to);
      for (const [itemId, code] of this.skillKeyPreferences) {
        if (code === to || other && code === from) this.skillKeyPreferences.delete(itemId);
      }
      this.skillKeyPreferences.set(skill.item.id, to);
      if (other) this.skillKeyPreferences.set(other.item.id, from);
      this.renderInventory();
      this.renderSkillKeyboard();
    }

    cycleHeldSlot(direction) {
      const slots = this.inventory.getSlots("equipment");
      if (!slots || slots.length === 0) return false;

      let currentIndex = this.selectedSlot && this.selectedSlot.area === "equipment"
        ? this.selectedSlot.index
        : -1;
      for (let step = 1; step <= slots.length; step += 1) {
        const index = ((currentIndex + direction * step) % slots.length + slots.length) % slots.length;
        this.selectedSlot = { area: "equipment", index };
        this.lastSlotClick = null;
        this.cancelMining();
        this.hideItemDetails();
        this.renderSelection();
        this.syncHeldStats();
        return true;
      }
      return false;
    }

    readInput() {
      if (this.summoner?.channel) return { x: 0, y: 0, sprint: false };
      const keys = this.keys;

      const left = keys.has("KeyA") || keys.has("ArrowLeft");
      const right = keys.has("KeyD") || keys.has("ArrowRight");
      const up = keys.has("KeyW") || keys.has("ArrowUp");
      const down = keys.has("KeyS") || keys.has("ArrowDown");

      return {
        x: (right ? 1 : 0) - (left ? 1 : 0),
        y: (down ? 1 : 0) - (up ? 1 : 0),
        sprint: keys.has("ShiftLeft") || keys.has("ShiftRight"),
      };
    }

    /* ---------------- Exploration and maps ---------------- */

    tileKey(tx, ty) {
      return tx + "," + ty;
    }

    revealExplored(tx, ty) {
      const radius = this.exploredRadius;
      const radiusSq = radius * radius;
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (dx * dx + dy * dy <= radiusSq) {
            this.explored.add(this.tileKey(tx + dx, ty + dy));
          }
        }
      }
    }

    updateExplored() {
      if (!this.player) return;
      const tx = this.player.tileX;
      const ty = this.player.tileY;
      if (tx === this.lastExploredTileX && ty === this.lastExploredTileY) return;
      this.lastExploredTileX = tx;
      this.lastExploredTileY = ty;
      this.revealExplored(tx, ty);
    }

    mapColorAt(tx, ty) {
      const terrain = this.world.terrainAt(tx, ty);
      if (terrain === TERRAIN.OCEAN) return MAP_COLORS.ocean;
      if (terrain === TERRAIN.GRASS) return MAP_COLORS.grass;
      if (terrain === TERRAIN.ROCK) return MAP_COLORS.rock;
      return MAP_COLORS.unknown;
    }

    drawMapArrow(ctx, x, y, angle, color, size) {
      ctx.save();
      ctx.translate(Math.round(x), Math.round(y));
      ctx.rotate(angle);
      ctx.fillStyle = "rgba(7, 14, 9, 0.8)";
      ctx.beginPath();
      ctx.moveTo(size + 2, 0);
      ctx.lineTo(-size, -size + 1);
      ctx.lineTo(-size, size - 1);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(size, 0);
      ctx.lineTo(-size + 1, -size + 1);
      ctx.lineTo(-size + 1, size - 1);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    drawMinimap() {
      if (!this.player || !this.world) return;

      const ctx = this.minimapCtx;
      const width = this.minimapCanvas.width;
      const height = this.minimapCanvas.height;
      const scale = MINIMAP_SCALE;
      const cols = Math.floor(width / scale);
      const rows = Math.floor(height / scale);
      const originX = this.player.tileX - Math.floor(cols / 2);
      const originY = this.player.tileY - Math.floor(rows / 2);
      const centerX = width / 2;
      const centerY = height / 2;

      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = MAP_COLORS.unknown;
      ctx.fillRect(0, 0, width, height);

      for (let row = 0; row < rows; row += 1) {
        const ty = originY + row;
        for (let col = 0; col < cols; col += 1) {
          const tx = originX + col;
          if (!this.explored.has(this.tileKey(tx, ty))) continue;

          ctx.fillStyle = this.mapColorAt(tx, ty);
          const x = col * scale;
          const y = row * scale;
          ctx.fillRect(x, y, scale, scale);

          const feature = this.world.featureAt(tx, ty);
          if (feature === FEATURE.TREE) {
            ctx.fillStyle = "#2f5731";
            ctx.fillRect(x + 1, y + 1, 2, 2);
          } else if (feature === FEATURE.COAL) {
            ctx.fillStyle = "#151b1c";
            ctx.fillRect(x + 1, y + 1, 2, 2);
          }
        }
      }

      // Show all nearby steles, with just one direction arrow for the nearest.
      const respawn = this.isDead ? this.respawn : this.nearestRespawnStele(this.player.x, this.player.y);
      for (const stele of this.activeRespawnSteles) {
        const dx = stele.tx - this.player.tileX;
        const dy = stele.ty - this.player.tileY;
        const mapX = centerX + dx * scale;
        const mapY = centerY + dy * scale;

        if (mapX > 6 && mapX < width - 6 && mapY > 6 && mapY < height - 6) {
          ctx.fillStyle = "rgba(17, 20, 14, 0.88)";
          ctx.fillRect(Math.round(mapX) - 3, Math.round(mapY) - 3, 6, 6);
          ctx.fillStyle = "#e8bb62";
          ctx.fillRect(Math.round(mapX) - 2, Math.round(mapY) - 2, 4, 4);
          ctx.fillStyle = "#fff0ae";
          ctx.fillRect(Math.round(mapX), Math.round(mapY) - 3, 1, 1);
        } else if (stele === respawn) {
          const angle = Math.atan2(dy, dx);
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const halfW = width / 2 - 7;
          const halfH = height / 2 - 7;
          const factor = Math.min(
            Math.abs(cos) > 0.0001 ? halfW / Math.abs(cos) : Infinity,
            Math.abs(sin) > 0.0001 ? halfH / Math.abs(sin) : Infinity
          );
          this.drawMapArrow(
            ctx,
            centerX + cos * factor,
            centerY + sin * factor,
            angle,
            "#e8bb62",
            3
          );
        }
      }

      // Last death marker.
      if (this.lastDeath) {
        const deathDx = this.lastDeath.tx - this.player.tileX;
        const deathDy = this.lastDeath.ty - this.player.tileY;
        const deathX = centerX + deathDx * scale;
        const deathY = centerY + deathDy * scale;
        if (deathX > 6 && deathX < width - 6 && deathY > 6 && deathY < height - 6) {
          ctx.strokeStyle = "#d56a55";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(deathX - 2.5, deathY - 2.5);
          ctx.lineTo(deathX + 2.5, deathY + 2.5);
          ctx.moveTo(deathX + 2.5, deathY - 2.5);
          ctx.lineTo(deathX - 2.5, deathY + 2.5);
          ctx.stroke();
        } else {
          const angle = Math.atan2(deathDy, deathDx);
          this.drawMapArrow(
            ctx,
            centerX + Math.cos(angle) * (width / 2 - 7),
            centerY + Math.sin(angle) * (height / 2 - 7),
            angle,
            "#d56a55",
            3
          );
        }
      }

      // Player marker.
      ctx.fillStyle = "rgba(14, 18, 13, 0.9)";
      ctx.beginPath();
      ctx.moveTo(centerX, centerY - 4);
      ctx.lineTo(centerX - 3, centerY + 3);
      ctx.lineTo(centerX + 3, centerY + 3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#f3ecd3";
      ctx.beginPath();
      ctx.moveTo(centerX, centerY - 3);
      ctx.lineTo(centerX - 2, centerY + 2);
      ctx.lineTo(centerX + 2, centerY + 2);
      ctx.closePath();
      ctx.fill();

      this.minimapCanvas.setAttribute(
        "aria-label",
        "附近小地图" +
        (respawn ? "，最近复活点在 " + formatCoordinate(respawn.tx) + "，" + formatCoordinate(respawn.ty) : "，尚未设置复活点") +
        (this.lastDeath ? "，上次死亡点在 " + formatCoordinate(this.lastDeath.tx) + "，" + formatCoordinate(this.lastDeath.ty) : "")
      );
    }

    openMap() {
      if (!this.world || this.isDead || this.sleeping || !this.openGamePanel("map")) return;
      this.mapPortalTarget = null;
      this.mapCamX = this.player.tileX - this.worldMapCanvas.width / (2 * MAP_SCALE);
      this.mapCamY = this.player.tileY - this.worldMapCanvas.height / (2 * MAP_SCALE);
      this.drawBigMap();
    }

    closeMap() {
      this.closeGamePanel("map");
    }

    toggleMap() {
      if (this.isDead) return;
      if (this.mapOpen) this.closeMap();
      else this.openMap();
    }

    drawBigMap() {
      if (!this.world) return;

      const ctx = this.worldMapCtx;
      const width = this.worldMapCanvas.width;
      const height = this.worldMapCanvas.height;
      const scale = MAP_SCALE;

      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = MAP_COLORS.unknown;
      ctx.fillRect(0, 0, width, height);

      const firstX = Math.floor(this.mapCamX);
      const firstY = Math.floor(this.mapCamY);
      const cols = Math.ceil(width / scale) + 1;
      const rows = Math.ceil(height / scale) + 1;

      for (let row = 0; row < rows; row += 1) {
        const ty = firstY + row;
        for (let col = 0; col < cols; col += 1) {
          const tx = firstX + col;
          if (!this.explored.has(this.tileKey(tx, ty))) continue;

          ctx.fillStyle = this.mapColorAt(tx, ty);
          ctx.fillRect(
            Math.round((tx - this.mapCamX) * scale),
            Math.round((ty - this.mapCamY) * scale),
            scale,
            scale
          );
        }
      }

      this.drawMapPortalPreview();
      const playerX = (this.player.x / CONFIG.TILE_SIZE - this.mapCamX) * scale;
      const playerY = (this.player.y / CONFIG.TILE_SIZE - this.mapCamY) * scale;
      if (playerX >= -10 && playerX <= width + 10 && playerY >= -10 && playerY <= height + 10) {
        ctx.fillStyle = "rgba(11, 17, 12, 0.9)";
        ctx.beginPath();
        ctx.arc(playerX, playerY, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#f3ecd3";
        ctx.beginPath();
        ctx.arc(playerX, playerY, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#283128";
        ctx.beginPath();
        ctx.arc(playerX, playerY, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }

      const respawn = this.nearestRespawnStele(this.player.x, this.player.y);
      for (const stele of this.activeRespawnSteles) {
        const respawnX = (stele.tx + 0.5 - this.mapCamX) * scale;
        const respawnY = (stele.ty + 0.5 - this.mapCamY) * scale;
        if (respawnX > 12 && respawnX < width - 12 && respawnY > 12 && respawnY < height - 12) {
          ctx.save();
          ctx.translate(respawnX, respawnY);
          ctx.rotate(Math.PI / 4);
          ctx.fillStyle = "rgba(13, 18, 12, 0.9)";
          ctx.fillRect(-6, -6, 12, 12);
          ctx.fillStyle = "#e8bb62";
          ctx.fillRect(-4, -4, 8, 8);
          ctx.fillStyle = "#fff0ae";
          ctx.fillRect(-2, -2, 4, 4);
          ctx.restore();
        } else if (stele === respawn) {
          const angle = Math.atan2(respawnY - height / 2, respawnX - width / 2);
          this.drawMapArrow(
            ctx,
            width / 2 + Math.cos(angle) * (width / 2 - 24),
            height / 2 + Math.sin(angle) * (height / 2 - 24),
            angle,
            "#e8bb62",
            10
          );
        }
      }

      if (this.lastDeath) {
        const deathX = (this.lastDeath.tx + 0.5 - this.mapCamX) * scale;
        const deathY = (this.lastDeath.ty + 0.5 - this.mapCamY) * scale;
        if (deathX > 12 && deathX < width - 12 && deathY > 12 && deathY < height - 12) {
          ctx.strokeStyle = "#d56a55";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(deathX - 5, deathY - 5);
          ctx.lineTo(deathX + 5, deathY + 5);
          ctx.moveTo(deathX + 5, deathY - 5);
          ctx.lineTo(deathX - 5, deathY + 5);
          ctx.stroke();
        } else {
          const angle = Math.atan2(deathY - height / 2, deathX - width / 2);
          this.drawMapArrow(
            ctx,
            width / 2 + Math.cos(angle) * (width / 2 - 28),
            height / 2 + Math.sin(angle) * (height / 2 - 28),
            angle,
            "#d56a55",
            10
          );
        }
      }

      this.mapRespawnCoords.textContent = respawn
        ? "最近复活点（共 " + this.activeRespawnSteles.size + " 处）：" +
          formatCoordinate(respawn.tx) + " · " + formatCoordinate(respawn.ty)
        : "复活点：尚未设置";
      this.mapExploredCount.textContent =
        (this.lastDeath
          ? "上次死亡点：" + formatCoordinate(this.lastDeath.tx) + " · " + formatCoordinate(this.lastDeath.ty) + " · "
          : "") +
        "已探索 " + this.explored.size + " 格";
    }

    updateMapPortalTarget(clientX, clientY) {
      if (!this.mapOpen) return;
      const rect = this.worldMapCanvas.getBoundingClientRect();
      const x = (clientX - rect.left) * this.worldMapCanvas.width / Math.max(1, rect.width);
      const y = (clientY - rect.top) * this.worldMapCanvas.height / Math.max(1, rect.height);
      if (x < 0 || y < 0 || x >= this.worldMapCanvas.width || y >= this.worldMapCanvas.height) return;
      this.mapPortalTarget = { x: (this.mapCamX + x / MAP_SCALE) * CONFIG.TILE_SIZE,
        y: (this.mapCamY + y / MAP_SCALE) * CONFIG.TILE_SIZE };
    }

    drawMapPortalPreview() {
      const portal = this.getEquippedSkills().find(skill => skill.item.skill === "portal");
      const key = portal && this.skillBindingLabel(portal.item.id);
      const bracelet = this.summoner?.selection === "teleport" && this.summoner.equipped();
      const braceletKey = bracelet && this.skillBindingLabel(bracelet.item.id);
      const hints = [];
      if (key) hints.push(`${key} 虫洞 ${CONFIG.MAP_PORTAL_RANGE}格`);
      if (braceletKey) hints.push(`${braceletKey} 手环传送 120格`);
      if (this.mapActionHint) this.mapActionHint.textContent = hints.length
        ? `拖动地图 · 鼠标选点 · ${hints.join(" · ")} · 仅限已探索区域` : "按住拖动地图";
      const preview = braceletKey && this.summoner.teleportPreview(this.mapPortalTarget, true);
      if (preview) {
        const x = (preview.x / CONFIG.TILE_SIZE - this.mapCamX) * MAP_SCALE;
        const y = (preview.y / CONFIG.TILE_SIZE - this.mapCamY) * MAP_SCALE;
        this.renderer.drawSummonerTarget(this.worldMapCtx, x, y, preview.valid, 8);
      }
      if (!portal || !this.mapPortalTarget) return;
      const target = this.portalPlan(this.mapPortalTarget.x, this.mapPortalTarget.y, true);
      const ctx = this.worldMapCtx, previous = this.renderer.ctx;
      const valid = target.valid && this.holyGunRemaining(portal.stack) <= 0;
      ctx.save();
      try {
        this.renderer.ctx = ctx;
        for (const end of [target.origin, target]) {
          const x = (end.x / CONFIG.TILE_SIZE - this.mapCamX) * MAP_SCALE;
          const y = (end.y / CONFIG.TILE_SIZE - this.mapCamY) * MAP_SCALE;
          const radius = target.radius / CONFIG.TILE_SIZE * MAP_SCALE;
          ctx.globalAlpha = 0.4;
          this.renderer.drawPortalDisc(x, y, radius, this.elapsed, false);
          ctx.globalAlpha = 1; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
          ctx.strokeStyle = valid ? "#7df7a1" : "#ff646f";
          ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();
        }
      } finally { this.renderer.ctx = previous; ctx.restore(); }
    }

    bindMapEvents() {
      this.closeMapButton.addEventListener("click", () => {
        this.closeMap();
      });

      this.worldMapCanvas.addEventListener("pointerdown", (event) => {
        if (!this.mapOpen || event.button !== 0) return;
        event.preventDefault();
        this.updateMapPortalTarget(event.clientX, event.clientY);
        this.drawBigMap();
        this.mapDragging = true;
        this.mapDragLastX = event.clientX;
        this.mapDragLastY = event.clientY;
        this.worldMapCanvas.classList.add("is-dragging");
        try {
          this.worldMapCanvas.setPointerCapture(event.pointerId);
        } catch (error) {
          // Pointer capture is optional.
        }
      });

      this.worldMapCanvas.addEventListener("pointermove", (event) => {
        if (!this.mapOpen) return;
        if (!this.mapDragging) {
          this.updateMapPortalTarget(event.clientX, event.clientY);
          if (this.getEquippedSkills().some(gear => gear.item.skill === "portal") ||
              this.summoner?.selection === "teleport" && this.summoner.equipped()) this.drawBigMap();
          return;
        }
        event.preventDefault();
        const rect = this.worldMapCanvas.getBoundingClientRect();
        const dx = (event.clientX - this.mapDragLastX) * (this.worldMapCanvas.width / Math.max(1, rect.width));
        const dy = (event.clientY - this.mapDragLastY) * (this.worldMapCanvas.height / Math.max(1, rect.height));
        this.mapDragLastX = event.clientX;
        this.mapDragLastY = event.clientY;
        this.mapCamX -= dx / MAP_SCALE;
        this.mapCamY -= dy / MAP_SCALE;
        this.updateMapPortalTarget(event.clientX, event.clientY);
        this.drawBigMap();
      });

      const endDrag = () => {
        if (!this.mapDragging) return;
        this.mapDragging = false;
        this.worldMapCanvas.classList.remove("is-dragging");
      };

      this.worldMapCanvas.addEventListener("pointerup", endDrag);
      this.worldMapCanvas.addEventListener("pointercancel", endDrag);
      this.worldMapCanvas.addEventListener("pointerleave", () => {
        endDrag();
        this.mapPortalTarget = null;
        if (this.mapOpen) this.drawBigMap();
      });
    }

    loop(timestamp) {
      if (!this.running) return;
      if(this.paused){requestAnimationFrame(this.loop);return;}
      if (!this.started) {
        requestAnimationFrame(this.loop);
        return;
      }

      if (this.lastFrameTime === 0) {
        this.lastFrameTime = timestamp;
      }

      const delta = Math.min(0.05, Math.max(0, (timestamp - this.lastFrameTime) / 1000));
      this.lastFrameTime = timestamp;
      this.elapsed += delta;
      this.updateGiftEffects(delta);
      const now = performance.now();

      if (!this.isDead && !this.sleeping) {
        this.clock.update(delta);
        this.updateFarming(delta);
        this.updateHolyGun(delta);
        this.updatePortalEffects(delta);
        this.summoner.update(delta);
        this.spawnFirstNightLucian();
        const gameHoursDelta = (delta * Wilds.TIME_SCALE) / 3600;
        this.updateSurvival(gameHoursDelta);

        const input = this.readInput();
        if (this.player.canOccupy(this.player.x, this.player.y)) {
          this.lastPlayerSafe = { x: this.player.x, y: this.player.y };
        }
        this.player.update(delta, input.x, input.y, input.sprint);
        this.updatePortalCamera(delta);
        this.player.updateVitals(delta);
        this.updateExplored();

        if (this.player.health <= 0) {
          this.die();
        }

        if (!this.isDead) {
          this.refreshPointerTile();
          this.updatePointerTarget();
          this.updateMining(now);
          this.collectNearbyDrops(now);
          this.updateMobs(delta, now);
          this.capturePortalEntrants();
          this.updateProjectiles(delta);
          this.enforceGroundObstacleInvariant();
          if (this.player.health <= 0) this.die();
        } else {
          this.expireDrops(now);
        }
      } else {
        this.expireDrops(now);
      }

      const target = this.renderTarget();
      this.updateAudio(now);
      this.renderer.render(
        this.player,
        this.elapsed,
        this.clock.lighting,
        this.drops,
        target,
        Array.from(this.placedObjects.values()),
        this.mobs,
        this.projectiles,
        this.getRoomIndex(),
        this.giftEffects, this.farm, this.waterEffects, this.portalEffects,
        this.summoner, this.summoner.worldPreview()
      );
      this.syncHud(false);

      this.minimapAccumulator += delta;
      if (this.minimapAccumulator >= 0.1) {
        this.minimapAccumulator = 0;
        this.drawMinimap();
        if (this.activeGamePanel() === "map") this.drawBigMap();
      }

      if (this.player.moving && !this.hintHidden) {
        this.hintHidden = true;
        this.startHint.classList.add("is-hidden");
      }

      requestAnimationFrame(this.loop);
    }

    /* ---------------- Inventory rendering ---------------- */

    buildInventory() {
      for (let i = 0; i < Wilds.INVENTORY_LAYOUT.equipment; i += 1) {
        const button = this.createInventorySlot("equipment", i);
        this.inventoryButtons.equipment.push(button);
        this.hotbar.appendChild(button);
      }

      for (let i = 0; i < Wilds.INVENTORY_LAYOUT.backpack; i += 1) {
        const button = this.createInventorySlot("backpack", i);
        this.inventoryButtons.backpack.push(button);
        this.backpackGrid.appendChild(button);
      }

      this.renderInventory();
    }

    createInventorySlot(area, index) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "inv-slot is-empty";
      button.dataset.area = area;
      button.dataset.index = String(index);
      button.addEventListener("pointerenter",()=>{this.showItemDetails(this.inventory.getSlot(area,index),true,{area,index});window.clearTimeout(this.itemDetailTimer);this.itemDetailTimer=0;});
      button.addEventListener("pointerleave",()=>this.hideItemDetails());
      button.setAttribute("aria-label", "空槽位");
      return button;
    }

    bindInventoryEvents() {
      const handleClick = (event) => {
        if (performance.now() < this.suppressSlotClickUntil) return;
        const button = event.target.closest(".inv-slot");
        if (!button) return;
        this.handleSlotClick(button.dataset.area, Number(button.dataset.index));
      };

      const handleDoubleClick = (event) => {
        const button = event.target.closest(".inv-slot");
        if (!button) return;
        event.preventDefault();
        this.handleSlotDoubleClick(button.dataset.area, Number(button.dataset.index));
      };

      this.hotbar.addEventListener("click", handleClick);
      this.backpackGrid.addEventListener("click", handleClick);
      this.hotbar.addEventListener("dblclick", handleDoubleClick);
      this.backpackGrid.addEventListener("dblclick", handleDoubleClick);

      const handleContextMenu = (event) => {
        const button = event.target.closest(".inv-slot");
        if (!button) return;
        event.preventDefault();
        const area = button.dataset.area;
        const index = Number(button.dataset.index);
        const stack = this.inventory.getSlot(area, index);
        if (
          stack &&
          stack.itemId === "creation_scroll" &&
          this.selectedSlot &&
          this.selectedSlot.area === area &&
          this.selectedSlot.index === index
        ) {
          this.useCreationScroll();
          return;
        }
        this.dropInventoryStack(area, index);
      };

      this.hotbar.addEventListener("contextmenu", handleContextMenu);
      this.backpackGrid.addEventListener("contextmenu", handleContextMenu);

      const startFoodPress = (event) => {
        if (event.button !== 0) return;
        const button = event.target.closest(".inv-slot");
        if (!button) return;
        const area = button.dataset.area;
        const index = Number(button.dataset.index);
        const stack = this.inventory.getSlot(area, index);
        if (!stack) return;
        const item = this.inventory.itemDefinition(stack.itemId);
        if (!item || !item.edible) return;

        this.clearFoodPress();
        this.foodPress = {
          area,
          index,
          pointerId: event.pointerId,
          timer: window.setTimeout(() => {
            this.foodPress = null;
            this.eatFood(area, index);
          }, 620)
        };
      };

      const endFoodPress = () => {
        this.clearFoodPress();
      };

      for (const grid of [this.hotbar, this.backpackGrid]) {
        grid.addEventListener("pointerdown", startFoodPress);
        grid.addEventListener("pointerup", endFoodPress);
        grid.addEventListener("pointercancel", endFoodPress);
        grid.addEventListener("pointerleave", endFoodPress);
      }

      this.bagButton.addEventListener("click", () => {
        this.openBackpack();
      });

      this.sortBackpackButton.addEventListener("click",()=>this.sortBackpack());
      this.closeBackpackButton.addEventListener("click", () => {
        this.closeBackpack();
      });

      this.closeWorkbenchButton.addEventListener("click", () => {
        this.closeWorkbench();
      });

      this.closeSteleButton.addEventListener("click", () => {
        this.closeStele();
      });

      this.closeStorageButton.addEventListener("click", () => {
        this.closeStorage();
      });

      this.closeFurnaceButton.addEventListener("click", () => {
        this.closeFurnace();
      });

      this.recipeList.addEventListener("click", (event) => {
        const button = event.target.closest(".craft-button");
        if (button) {
          if (button.disabled) return;
          this.craftRecipe(button.dataset.recipe);
          return;
        }

        const card = event.target.closest(".recipe-card");
        if (card) {
          this.showRecipeDetails(card.dataset.recipe);
        }
      });
    }

    renderInventory() {
      this.updateSkillBindings();
      for (const area of ["equipment", "backpack"]) {
        const buttons = this.inventoryButtons[area];
        for (let i = 0; i < buttons.length; i += 1) {
          this.renderInventorySlot(buttons[i], area, i);
        }
      }

      if (this.workbenchOpen) {
        this.renderRecipes();
      }
      if (this.summonerOpen) this.renderSummonerPanel();
    }

    renderSelection() {
      for (const area of ["equipment", "backpack"]) {
        const buttons = this.inventoryButtons[area];
        for (let i = 0; i < buttons.length; i += 1) {
          const selected = Boolean(
            this.selectedSlot &&
            this.selectedSlot.area === area &&
            this.selectedSlot.index === i
          );
          buttons[i].classList.toggle("is-selected", selected || (this.swapSelection?.area===area && this.swapSelection.index===i));
        }
      }
    }

    renderInventorySlot(button, area, index) {
      const stack = this.inventory.getSlot(area, index);
      const selected = Boolean(
        this.selectedSlot &&
        this.selectedSlot.area === area &&
        this.selectedSlot.index === index
      );
      const areaLabel = area === "equipment" ? "装备栏" : "背包";

      button.classList.toggle("is-selected", selected || (this.swapSelection?.area === area && this.swapSelection.index === index));
      button.classList.toggle("is-empty", !stack);
      button.dataset.item = stack ? stack.itemId : "";

      if (!stack) {
        button.innerHTML = "";
        button.setAttribute("aria-label", areaLabel + "第 " + (index + 1) + " 格，空");
        return;
      }

      const item = this.inventory.itemDefinition(stack.itemId);
      if (!item) {
        button.innerHTML = "";
        button.dataset.item = "";
        button.classList.add("is-empty");
        button.setAttribute("aria-label", areaLabel + "第 " + (index + 1) + " 格，未知物品");
        return;
      }

      let html = Wilds.itemIcon(item);
      const skillKey = area === "equipment" && item.skill ? this.skillBindingLabel(item.id) : null;
      if (skillKey) {
        const remaining = Math.ceil(this.holyGunRemaining(stack));
        if (item.skill === "summoner") {
          html += `<span class="skill-name">${this.summoner.spell.name}</span>`;
          const state = this.summoner.channel ? "引导" : remaining ? `${remaining}s` : "就绪";
          html += `<span class="skill-cooldown">${state}</span>`;
        } else if (remaining) html += `<span class="skill-cooldown">${remaining}s</span>`;
        html += `<span class="skill-durability">${this.isCreative() ? "∞" : (stack.durability ?? item.maxDurability) + "/" + item.maxDurability}</span>`;
        html += `<span class="skill-binding">${skillKey}</span>`;
      }
      if (this.isCreative() && item.maxDurability > 0) {
        if (!skillKey) html += '<span class="item-count">∞</span>';
      } else if (item.kind === "equipment" && item.maxDurability > 0) {
        const maximum = item.maxDurability;
        const current = Math.max(0, Math.min(maximum, Number.isFinite(stack.durability) ? stack.durability : maximum));
        const percent = maximum > 0 ? (current / maximum) * 100 : 0;
        const colorClass = percent > 70 ? "is-good" : percent >= 30 ? "is-warn" : "is-bad";

        html +=
          '<span class="durability-bar" aria-hidden="true">' +
          '<i class="durability-fill ' + colorClass + '" style="width:' + percent.toFixed(1) + '%"></i>' +
          "</span>";
      } else if (stack.count > 1) {
        html += '<span class="item-count">' + stack.count + "</span>";
      }

      button.innerHTML = html;

      let aria = areaLabel + "第 " + (index + 1) + " 格，" + item.name;
      if (item.kind === "equipment") {
        const maximum = item.maxDurability || 1;
        const current = Math.round(Number.isFinite(stack.durability) ? stack.durability : maximum);
        aria += this.isCreative() ? "，无限耐久" : "，耐久 " + current + " / " + maximum;
      } else {
        aria += "，数量 " + stack.count;
      }
      if (skillKey) aria += "，技能键 " + skillKey;
      if (skillKey && item.skill === "summoner") aria += "，当前技能 " + this.summoner.spell.name + "，点击选择技能";
      aria += "，双击查看说明";
      button.setAttribute("aria-label", aria);
    }

    getHeldEquipment() {
      if (!this.selectedSlot || this.selectedSlot.area !== "equipment") return null;
      const stack = this.inventory.getSlot("equipment", this.selectedSlot.index);
      if (!stack) return null;
      const item = this.inventory.itemDefinition(stack.itemId);
      if (!item || item.kind !== "equipment") return null;
      return { ...this.selectedSlot, stack, item };
    }

    skillBindingLabel(itemId) {
      for (const [code, skill] of this.skillBindings || []) {
        if (skill.item.id === itemId) return skillKeyLabel(code);
      }
      return null;
    }

    syncHeldStats() {
      if (!this.player) return;
      const held = this.getHeldEquipment();
      const bonus = held && Number.isFinite(held.item.attackBonus) ? held.item.attackBonus : 0;
      this.player.attackDamage = this.player.baseAttackDamage + bonus;
    }

    handleSlotClick(area, index) {
      if(this.paused)return;
      if (area === "equipment" && this.canUseWorldInput() &&
          this.inventory.getSlot(area, index)?.itemId === "summoner_bracelet") {
        this.selectedSlot = { area, index };
        this.openGamePanel("summoner");
        this.renderInventory();
        this.syncHeldStats();
        return;
      }
      if (this.isCreative()) {
        if (area !== "equipment") return;
        if (this.creativePick) {
          const item = this.inventory.itemDefinition(this.creativePick);
          if (item) this.inventory.setSlot(area,index,{itemId:item.id,count:this.inventory.maxStackFor(item.id),
            ...(item.maxDurability > 0 ? {durability:item.maxDurability} : {})});
        }
        this.selectedSlot = {area,index}; this.swapSelection = null;
        this.renderInventory(); this.syncHeldStats(); this.hideItemDetails(); return;
      }
      const slots=this.inventory.getSlots(area);
      if(!slots || index<0 || index>=slots.length)return;
      this.cancelMining();this.hideItemDetails();this.lastSlotClick=null;
      const to={area,index},from=this.swapSelection;
      if(area==="equipment") {
        if(from?.area==="backpack") {this.inventory.swap(from,to);this.swapSelection=null;}
        else this.swapSelection=this.backpackOpen?to:null;
        this.selectedSlot=to;
      } else {
        if(from && (from.area!==area || from.index!==index)) {this.inventory.swap(from,to);this.swapSelection=null;}
        else this.swapSelection=from?null:to;
      }
      this.renderInventory();this.syncHeldStats();
      const stack=this.inventory.getSlot(area,index);
      if(stack)this.showItemDetails(stack,true,to);
    }

    renderSummonerPanel() {
      const bracelet = this.summoner.equipped();
      const cooldown = Math.ceil(this.summoner.remaining(bracelet));
      const locked = !bracelet || cooldown > 0 || Boolean(this.summoner.channel);
      const key = bracelet && this.skillBindingLabel(bracelet.item.id);
      this.summonerStatus.textContent = this.summoner.channel ? "引导中，结束后可更改技能"
        : cooldown ? `冷却剩余 ${cooldown} 秒 · 技能选择已锁定`
        : key ? `按 ${key} 施放 · 按 Tab 更改键位` : "将手环放入装备栏即可使用";
      if (!this.summonerSpells.childElementCount) {
        for (const [id, spell] of Object.entries(Wilds.SUMMONER_SPELLS)) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "summoner-spell";
          button.dataset.spell = id;
          button.style.setProperty("--spell-color", spell.color);
          const title = document.createElement("strong");
          title.textContent = spell.name;
          const description = document.createElement("span");
          description.textContent = spell.description;
          button.append(title, description);
          this.summonerSpells.appendChild(button);
        }
      }
      for (const button of this.summonerSpells.children) {
        button.setAttribute("aria-pressed", String(button.dataset.spell === this.summoner.selection));
        button.disabled = locked;
      }
    }

    sortBackpack() {
      this.inventory.sortBackpack();this.swapSelection=null;
      this.hideItemDetails();this.renderInventory();this.syncHeldStats();
    }

    handleSlotDoubleClick(area, index) {
      this.lastSlotClick = null;
      this.showItemDetails(this.inventory.getSlot(area, index), false, { area, index });
    }

    positionItemDetail(anchor) {
      if (!anchor || !this.itemDetail) return;
      const viewport = this.viewport.getBoundingClientRect();
      const target = anchor.area === "equipment"
        ? this.hotbar.getBoundingClientRect()
        : document.querySelector(".backpack-panel")?.getBoundingClientRect();
      if (!target || target.width === 0) return;

      const center = target.left + target.width / 2 - viewport.left;
      const halfWidth = Math.min(150, (viewport.width - 28) / 2);
      const left = Math.max(halfWidth + 14, Math.min(viewport.width - halfWidth - 14, center));
      const bottom = Math.max(8, viewport.bottom - target.top + 8);
      this.itemDetail.style.left = left + "px";
      this.itemDetail.style.transform = "translateX(-50%)";
      this.itemDetail.style.bottom = bottom + "px";
      this.itemDetail.style.top = "auto";

      // If the inventory panel is too tall or starts too near the top,
      // keep the description visible instead of pushing it off-screen.
      if (viewport.height - bottom - this.itemDetail.offsetHeight < 6) {
        this.itemDetail.style.bottom = "auto";
        this.itemDetail.style.top = "8px";
      }
    }

    resetItemDetailPosition() {
      if (!this.itemDetail) return;
      this.itemDetail.style.left = "";
      this.itemDetail.style.transform = "";
      this.itemDetail.style.bottom = "";
      this.itemDetail.style.top = "";
    }

    showItemDetails(stack, preserveSelection = false, anchor = null) {
      if (!stack) {
        this.hideItemDetails();
        return;
      }

      const item = this.inventory.itemDefinition(stack.itemId);
      if (!item) return;

      this.itemDetailName.textContent = item.name;
      this.itemDetailType.textContent = Wilds.itemTypeLabel(item);
      this.itemDetailDescription.textContent = item.description;
      this.itemDetailCount.textContent = String(stack.count);
      this.itemDetailMax.textContent = String(this.inventory.maxStackFor(stack.itemId));

      if (item.kind === "equipment" && (item.unbreakable || this.isCreative())) {
        this.itemDetailDurability.textContent = "∞";
        this.itemDetailDurabilityMax.textContent = "∞";
        this.itemDetailDurabilityRow.hidden = false;
      } else if (item.kind === "equipment") {
        const maximum = item.maxDurability || 1;
        const current = Math.round(Number.isFinite(stack.durability) ? stack.durability : maximum);
        this.itemDetailDurability.textContent = String(current);
        this.itemDetailDurabilityMax.textContent = String(maximum);
        this.itemDetailDurabilityRow.hidden = false;
      } else {
        this.itemDetailDurabilityRow.hidden = true;
      }

      this.itemDetail.hidden = false;
      if (anchor) {
        this.positionItemDetail(anchor);
      } else {
        this.resetItemDetailPosition();
      }

      if (!preserveSelection) {
        // Inspecting an item from the workbench is not the start of a swap.
        this.selectedSlot = null;
        this.renderInventory();
        this.syncHeldStats();
      }

      if (this.itemDetailTimer) {
        window.clearTimeout(this.itemDetailTimer);
      }
      this.itemDetailTimer = window.setTimeout(() => {
        this.itemDetail.hidden = true;
        this.itemDetailTimer = 0;
      }, ITEM_DETAIL_TIMEOUT_MS);
    }

    clearFoodPress() {
      if (!this.foodPress) return;
      window.clearTimeout(this.foodPress.timer);
      this.foodPress = null;
    }

    eatFood(area, index) {
      if (this.isCreative()) return;
      const stack = this.inventory.getSlot(area, index);
      if (!stack) return;
      const item = this.inventory.itemDefinition(stack.itemId);
      if (!item || !item.edible) return;

      if (this.player.manureDietHours > 0 && item.id !== "animal_manure") {
        this.showToast("异食状态：现在只能食用动物粪便"); return;
      }
      const edible = item.edible;
      if (edible.manureDietHours) this.player.manureDietHours = edible.manureDietHours;
      stack.count -= 1;
      if (stack.count <= 0) {
        this.inventory.removeSlot(area, index);
        if (
          this.selectedSlot &&
          this.selectedSlot.area === area &&
          this.selectedSlot.index === index
        ) {
          this.selectedSlot = null;
        }
      }

      if(edible.returnItem && !this.inventory.addItem(edible.returnItem,1))this.spawnDrop(edible.returnItem,1,this.player.tileX,this.player.tileY);
      const previousSatiety = this.player.satiety;
      this.player.satiety = Math.min(this.player.maxSatiety, this.player.satiety + (edible.satiety || 0));
      if (previousSatiety < this.player.maxSatiety && this.player.satiety >= this.player.maxSatiety) {
        this.satietyGraceRemaining = CONFIG.SATIETY_GRACE_HOURS;
      }
      let poisoned = false;
      let slowed = false;

      if (edible.poisonChance && Math.random() < edible.poisonChance) {
        if (edible.poisonDamage) {
          this.player.applyPoison(edible.poisonDamage, edible.poisonHours || 1, item);
          poisoned = true;
        }
        if (edible.slowFactor) {
          this.player.applySlow(edible.slowHours || 1, edible.slowFactor);
          slowed = true;
        }
      }

      if (edible.manureDietHours) {
        this.showToast("异食状态：未来一天只能食用动物粪便");
      } else if (slowed) {
        this.showToast(edible.indigestion ? "消化不良：移动速度降低50%，持续2小时" : "食物中毒：速度大幅降低");
      } else if (poisoned) {
        this.showToast("食物中毒了");
      } else if (edible.healthDamage) {
        this.showToast("食用" + item.name + "：生命 -" + edible.healthDamage);
      } else if (edible.kills) {
        this.showToast("真的可以吃吗…");
      } else {
        this.showToast("饱食度 +" + edible.satiety);
      }

      if (edible.healthDamage) {
        this.player.takeDamage(edible.healthDamage, { type: "food", name: item.name, itemId: item.id });
        if (this.audio) this.audio.playPlayerHurt();
      }
      if (edible.kills) this.player.takeDamage(this.player.health, { type: "food", name: item.name, itemId: item.id });
      if (this.player.health <= 0) this.die();

      this.suppressSlotClickUntil = performance.now() + 500;
      this.renderInventory();
      this.syncHeldStats();
      this.hideItemDetails();
    }

    showToast(text, duration = 2200) {
      if (!this.gameToast) return;
      this.gameToast.textContent = text;
      this.gameToast.hidden = false;
      if (this.toastTimer) window.clearTimeout(this.toastTimer);
      this.toastTimer = window.setTimeout(() => {
        this.gameToast.hidden = true;
        this.toastTimer = 0;
      }, duration);
    }

    hideItemDetails() {
      if (!this.itemDetail) return;
      this.itemDetail.hidden = true;
      if (this.itemDetailTimer) {
        window.clearTimeout(this.itemDetailTimer);
        this.itemDetailTimer = 0;
      }
    }

    /* ---------------- Workbench crafting ---------------- */

    buildRecipes() {
      if (!this.recipeList) return;
      this.renderRecipes();
    }

    renderRecipes() {
      if (!this.recipeList) return;
      this.recipeList.innerHTML = "";

      const visibleRecipes = Wilds.RECIPES.filter((recipe) =>
        Object.keys(recipe.costs).some((itemId) => this.inventory.countItem(itemId) > 0)
      );

      if (visibleRecipes.length === 0) {
        const empty = document.createElement("p");
        empty.className = "recipe-empty";
        empty.textContent = "没有持有相关材料的配方";
        this.recipeList.appendChild(empty);
        return;
      }

      for (const recipe of visibleRecipes) {
        const output = this.inventory.itemDefinition(recipe.output);
        if (!output) continue;
        const craftable = this.inventory.hasMaterials(recipe.costs);

        const card = document.createElement("div");
        card.className = "recipe-card " + (craftable ? "is-available" : "is-unavailable");
        card.dataset.recipe = recipe.id;

        const icon = document.createElement("div");
        icon.className = "recipe-icon";
        icon.innerHTML = Wilds.itemIcon(output);

        const main = document.createElement("div");
        main.className = "recipe-main";

        const name = document.createElement("div");
        name.className = "recipe-name";
        name.textContent = output.name;

        const costs = document.createElement("div");
        costs.className = "recipe-costs";
        for (const [itemId, count] of Object.entries(recipe.costs)) {
          const costItem = this.inventory.itemDefinition(itemId);
          const cost = document.createElement("span");
          cost.textContent = (costItem ? costItem.name : itemId) + " ×" + count;
          if (this.inventory.countItem(itemId) < count) {
            cost.className = "is-missing";
          }
          costs.appendChild(cost);
        }

        main.appendChild(name);
        main.appendChild(costs);

        const button = document.createElement("button");
        button.type = "button";
        button.className = "craft-button";
        button.dataset.recipe = recipe.id;
        button.textContent = craftable ? "制作" : "材料不足";
        button.disabled = !craftable;

        card.appendChild(icon);
        card.appendChild(main);
        card.appendChild(button);
        this.recipeList.appendChild(card);
      }
    }

    showRecipeDetails(recipeId) {
      const recipe = Wilds.RECIPES.find((entry) => entry.id === recipeId);
      if (!recipe) return;
      const output = this.inventory.itemDefinition(recipe.output);
      if (!output) return;

      const stack = { itemId: output.id, count: 1 };
      if (output.kind === "equipment" && output.maxDurability) {
        stack.durability = output.maxDurability;
      }
      this.showItemDetails(stack);
    }

    craftRecipe(recipeId) {
      const recipe = Wilds.RECIPES.find((entry) => entry.id === recipeId);
      if (!recipe) return;
      const result = this.inventory.craft(recipe);
      const output = this.inventory.itemDefinition(recipe.output);

      if (result.ok) {
        if (this.audio) this.audio.playCraftSuccess();
        this.workbenchFeedback.textContent = "制作成功：" + (output ? output.name : recipe.output);
        this.renderInventory();
        this.syncHeldStats();
        this.hideItemDetails();
        return;
      }

      if (this.audio) this.audio.playCraftFail();
      if (result.reason === "space") {
        this.workbenchFeedback.textContent = "背包空间不足";
      } else {
        this.workbenchFeedback.textContent = "材料不足";
      }
      this.renderRecipes();
    }

    openWorkbench() {
      if (!this.openGamePanel("workbench")) return;
      this.workbenchFeedback.textContent = "";
      this.renderRecipes();
    }

    closeWorkbench() {
      this.closeGamePanel("workbench");
    }

    openStorage(object) {
      if (!this.openGamePanel("storage")) return;
      this.panelSelection = null;
      this.storageObject = object;
      this.renderStorage();
    }

    closeStorage() {
      this.closeGamePanel("storage");
    }

    createItemButton(stack, label, onClick, selection = null) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "inv-slot";
      button.setAttribute("aria-label", label);
      if (selection) {
        button.dataset.selectionKey = selection;
        button.classList.toggle("is-selected", this.panelSelection === selection);
        button.setAttribute("aria-pressed", String(this.panelSelection === selection));
      }
      if (!stack) return button;
      const item = this.inventory.itemDefinition(stack.itemId);
      if (!item) return button;
      button.innerHTML = item.icon;
      button.title = item.name + "：" + item.description;
      button.addEventListener("pointerenter",()=>{this.showItemDetails(stack,true);window.clearTimeout(this.itemDetailTimer);this.itemDetailTimer=0;});
      button.addEventListener("pointerleave",()=>this.hideItemDetails());
      button.setAttribute("aria-label", item.name + " × " + stack.count);
      if (stack.count > 1) {
        const count = document.createElement("span");
        count.className = "slot-count";
        count.textContent = String(stack.count);
        button.appendChild(count);
      }
      button.addEventListener("click", () => {
        if (selection) {
          this.panelSelection = selection;
          for (const grid of [this.chestGrid, this.chestEquipmentGrid, this.chestBackpackGrid, this.furnaceEquipmentGrid, this.furnaceBackpackGrid]) {
            if (!grid) continue;
            for (const slot of grid.children) {
              const active = slot.dataset.selectionKey === selection;
              slot.classList.toggle("is-selected", active);slot.setAttribute("aria-pressed", String(active));
            }
          }
        }
        onClick();
      });
      return button;
    }

    canAddToArray(array, itemId, amount) {
      const max = this.inventory.maxStackFor(itemId);
      let room = 0;
      for (const stack of array) {
        if (!stack) room += max;
        else if (stack.itemId === itemId) room += Math.max(0, max - stack.count);
        if (room >= amount) return true;
      }
      return room >= amount;
    }

    addToArray(array, stack) {
      if (!this.canAddToArray(array, stack.itemId, stack.count)) return false;
      const max = this.inventory.maxStackFor(stack.itemId);
      let remaining = stack.count;
      for (const target of array) {
        if (target && target.itemId === stack.itemId && target.count < max) {
          const added = Math.min(max - target.count, remaining);
          target.count += added;
          remaining -= added;
        }
        if (remaining <= 0) break;
      }
      for (let i = 0; i < array.length && remaining > 0; i += 1) {
        if (!array[i]) {
          const added = Math.min(max, remaining);
          array[i] = {
            itemId: stack.itemId,
            count: added,
            ...(stack.durability !== undefined ? { durability: stack.durability } : {}),
            ...(stack.skillReadyAt ? {skillReadyAt:stack.skillReadyAt} : {}),
          };
          remaining -= added;
        }
      }
      return remaining === 0;
    }

    renderStorage() {
      if (!this.storageObject || !this.storageObject.storage) return;
      this.chestGrid.replaceChildren();
      for (let i = 0; i < 32; i += 1) {
        const stack = this.storageObject.storage[i];
        this.chestGrid.appendChild(this.createItemButton(stack, "储物箱格子 " + (i + 1), () => {
          if (!stack) return;
          if (!this.canAddToBackpack(stack.itemId, stack.count)) {
            this.showToast("背包空间不足");
            return;
          }
          if(this.inventory.maxStackFor(stack.itemId)===1) this.inventory.addEquipment(stack.itemId,stack.durability,stack.skillReadyAt);
          else this.addToBackpack(stack.itemId, stack.count);
          this.storageObject.storage[i] = null;
          this.renderStorage();
          this.renderInventory();
        }, "storage:chest:" + i));
      }

      for(const [area,grid,label] of [["equipment",this.chestEquipmentGrid,"装备栏"],["backpack",this.chestBackpackGrid,"背包"]]) {
        grid.replaceChildren();
        const slots=this.inventory.getSlots(area);
        for(let i=0;i<slots.length;i++) {
          grid.appendChild(this.createItemButton(slots[i],label+"格子 "+(i+1),()=>this.storeInventorySlot(area,i),"storage:"+area+":"+i));
        }
      }
    }

    storeInventorySlot(area,index) {
      if(this.paused || !this.storageOpen || !this.storageObject?.storage)return false;
      const stack=this.inventory.getSlot(area,index);
      if(!stack)return false;
      if(!this.addToArray(this.storageObject.storage,stack)) {
        this.showToast("储物箱空间不足");return false;
      }
      this.inventory.removeSlot(area,index);
      this.swapSelection=null;
      this.hideItemDetails();this.renderStorage();this.renderInventory();this.syncHeldStats();
      return true;
    }

    openFurnace(object) {
      if (!this.openGamePanel("furnace")) return;
      this.panelSelection = null;
      this.furnaceObject = object;
      this.renderFurnace();
    }

    closeFurnace() {
      this.closeGamePanel("furnace");
    }

    renderFurnace() {
      if (!this.furnaceObject) return;
      this.furnaceFuel.textContent = String(this.furnaceObject.fuel || 0);
      this.furnaceBackpackGrid.replaceChildren();
      this.furnaceEquipmentGrid.replaceChildren();

      const renderArea = (area, grid) => {
        const slots = this.inventory.getSlots(area);
        for (let i = 0; i < slots.length; i += 1) {
          const stack = slots[i];
          const button = this.createItemButton(
            stack,
            "熔炼炉" + (area === "equipment" ? "装备栏" : "背包") + "格子 " + (i + 1),
            () => this.useFurnaceSlot(area, i), "furnace:" + area + ":" + i
          );
          grid.appendChild(button);
        }
      };

      renderArea("equipment", this.furnaceEquipmentGrid);
      renderArea("backpack", this.furnaceBackpackGrid);
    }

    useFurnaceSlot(area, index) {
      if (!this.furnaceObject) return;
      const stack = this.inventory.getSlot(area, index);
      if (!stack) return;

      if (stack.itemId === "coal") {
        stack.count -= 1;
        if (stack.count <= 0) this.inventory.removeSlot(area, index);
        this.furnaceObject.fuel = (this.furnaceObject.fuel || 0) + 1;
        this.furnaceFeedback.textContent = "小煤块 +1";
        this.renderFurnace();
        this.renderInventory();
        return;
      }

      if (!this.furnaceObject.fuel) {
        this.furnaceFeedback.textContent = "需要小煤块";
        return;
      }

      let output = "strange_waste";
      if (stack.itemId === "raw_mutton") output = "cooked_mutton";
      else if (stack.itemId === "raw_rice") output = "cooked_rice";
      else if (stack.itemId === "raw_fish") output = "cooked_fish";
      else if (stack.itemId === "fine_sand") output = "glass";
      else if (stack.itemId === "raw_pork") output = "cooked_pork";
      else if (stack.itemId === "algorithm_chicken_leg") output = "cooked_algorithm_chicken_leg";
      if (!this.canAddToBackpack(output, 1)) {
        this.furnaceFeedback.textContent = "背包空间不足";
        return;
      }

      stack.count -= 1;
      if (stack.count <= 0) this.inventory.removeSlot(area, index);
      this.furnaceObject.fuel -= 1;
      this.addToBackpack(output, 1);
      const item = this.inventory.itemDefinition(output);
      this.furnaceFeedback.textContent = "熔炼完成：" + item.name;
      this.audio?.playCraftSuccess();
      this.renderFurnace();
      this.renderInventory();
    }

    openStele() {
      if (!this.openGamePanel("stele")) return;
      this.steleTitle.textContent = "夸赞斌神的石碑";
      this.steleText.textContent = Wilds.STELE_TEXT;
    }

    closeStele() {
      this.closeGamePanel("stele");
    }

    tileInFront(distance) {
      const deltas = {
        up: [0, -1],
        down: [0, 1],
        left: [-1, 0],
        right: [1, 0],
      };
      const [dx, dy] = deltas[this.player.facing] || deltas.down;
      return {
        tx: this.player.tileX + dx * distance,
        ty: this.player.tileY + dy * distance,
      };
    }

    dropInventoryStack(area, index) {
      const stack = this.inventory.getSlot(area, index);
      if (!stack) return;

      if(stack.itemId==="lucian_holy_gun" && this.holyGunRemaining(stack)>0){this.showToast("圣枪冷却中，无法丢弃");return;}

      const dropTile = this.tileInFront(2);
      this.inventory.removeSlot(area, index);

      if (
        this.selectedSlot &&
        this.selectedSlot.area === area &&
        this.selectedSlot.index === index
      ) {
        this.selectedSlot = null;
      }

      this.spawnDrop(stack.itemId, stack.count, dropTile.tx, dropTile.ty, stack.durability, stack.skillReadyAt);
      this.renderInventory();
      this.syncHeldStats();
      this.hideItemDetails();
    }

    openBackpack() {
      if (!this.openGamePanel("backpack")) return;
      this.swapSelection = null;
      this.bagButton.setAttribute("aria-expanded", "true");
    }

    closeBackpack() {
      this.closeGamePanel("backpack");
    }

    /* ---------------- Mouse mining ---------------- */

    bindMiningEvents() {
      this.canvas.addEventListener("contextmenu", (event) => {
        if (!this.canUseWorldInput()) return;
        const held = this.getHeldEquipment();
        if (held && held.stack.itemId === "creation_scroll") {
          event.preventDefault();
          this.useCreationScroll();
        }
      });

      this.canvas.addEventListener("pointermove", (event) => {
        this.handlePointerMove(event);
      });

      this.canvas.addEventListener("pointerdown", (event) => {
        this.handlePointerDown(event);
      });

      this.canvas.addEventListener("pointerup", (event) => {
        this.handlePointerUp(event);
      });

      this.canvas.addEventListener("pointercancel", () => {
        this.releaseMiningPointer();
        this.cancelMining();
      });

      this.canvas.addEventListener("pointerleave", () => {
        if (this.mining) {
          this.releaseMiningPointer();
          this.cancelMining();
        }
        this.pointerInside = false;
        this.pointerTile = null;
        this.hoverTarget = null;
      });
    }

    getPointerWorldPosition(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      const scale = Math.max(rect.width / CONFIG.VIEW_WIDTH, rect.height / CONFIG.VIEW_HEIGHT);
      const cropX = (CONFIG.VIEW_WIDTH * scale - rect.width) / 2;
      const cropY = (CONFIG.VIEW_HEIGHT * scale - rect.height) / 2;
      const internalX = ((clientX - rect.left) + cropX) / scale;
      const internalY = ((clientY - rect.top) + cropY) / scale;
      return {
        x: this.player.x + (this.player.cameraOffset?.x || 0) - CONFIG.VIEW_WIDTH / 2 + internalX,
        y: this.player.y + (this.player.cameraOffset?.y || 0) - CONFIG.VIEW_HEIGHT / 2 + internalY,
      };
    }

    getPointerTileAt(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;

      // The canvas is displayed with object-fit: cover. Convert from the
      // visible cropped area back to 480×300 logical coordinates.
      const scale = Math.max(rect.width / CONFIG.VIEW_WIDTH, rect.height / CONFIG.VIEW_HEIGHT);
      const contentWidth = CONFIG.VIEW_WIDTH * scale;
      const contentHeight = CONFIG.VIEW_HEIGHT * scale;
      const cropX = (contentWidth - rect.width) / 2;
      const cropY = (contentHeight - rect.height) / 2;
      const internalX = ((clientX - rect.left) + cropX) / scale;
      const internalY = ((clientY - rect.top) + cropY) / scale;

      if (internalX < 0 || internalY < 0 || internalX >= CONFIG.VIEW_WIDTH || internalY >= CONFIG.VIEW_HEIGHT) {
        return null;
      }

      const camX = this.player.x + (this.player.cameraOffset?.x || 0) - CONFIG.VIEW_WIDTH / 2;
      const camY = this.player.y + (this.player.cameraOffset?.y || 0) - CONFIG.VIEW_HEIGHT / 2;
      const worldX = camX + internalX;
      const worldY = camY + internalY;

      return {
        tx: Math.floor(worldX / CONFIG.TILE_SIZE),
        ty: Math.floor(worldY / CONFIG.TILE_SIZE),
      };
    }

    withinRange(tx, ty, range) {
      return (
        Math.max(
          Math.abs(tx - this.player.tileX),
          Math.abs(ty - this.player.tileY)
        ) <= range
      );
    }

    /**
     * Core unified collision: a tile is blocked for creatures if it holds a
     * blocking surface feature (any FEATURE not in PASSABLE_FEATURES) or a
     * placed object (including every tile of a multi-tile footprint).
     */
    // Occupancy is a set per tile. Blocking objects reserve one slot even
    // when open; every nonblocking type has its own independent slot.
    objectsAt(tx, ty) {
      const key = tx + "," + ty;
      const indexed = this.placedObjectTiles.get(key);
      const candidates = indexed instanceof Set ? [...indexed] : indexed ? [indexed] : [];
      const anchor = this.placedObjects.get(key);
      if (anchor) candidates.push(anchor);
      return [...new Set(candidates)].filter(o => this.placedObjects.get(o.storageKey || Wilds.Buildings.key(o)) === o || this.placedObjects.get(o.tx + "," + o.ty) === o);
    }

    isGroundBlockedForCreature(tx, ty) {
      return Wilds.featureBlocksMovement(this.world.featureAt(tx, ty)) ||
        this.objectsAt(tx, ty).some(o => Wilds.Buildings.isBlocking(o) && !(Wilds.Buildings.isDoor(o) && o.open));
    }

    // Exact shared ground footprint, used for feet, mobs, leaps and arrows.
    groundAreaBlocked(left, top, right, bottom) {
      const T = CONFIG.TILE_SIZE;
      const seen = new Set();
      for (let ty = Math.floor(top / T); ty <= Math.floor(bottom / T); ty++) {
        for (let tx = Math.floor(left / T); tx <= Math.floor(right / T); tx++) {
          if (Wilds.featureBlocksMovement(this.world.featureAt(tx, ty))) return true;
          for (const object of this.objectsAt(tx, ty)) {
            if (seen.has(object)) continue;
            seen.add(object);
            for (const [x, y, w, h] of Wilds.Buildings.rectangles(object, (a, b) => this.objectsAt(a, b))) {
              if (right > x && left < x + w && bottom > y && top < y + h) return true;
            }
          }
        }
      }
      return false;
    }

    placedObjectAt(tx, ty) {
      return this.objectsAt(tx, ty).sort((a, b) => Wilds.Buildings.priority(a) - Wilds.Buildings.priority(b))[0] || null;
    }

    getSelectedStack() {
      if (!this.selectedSlot) return null;
      const stack = this.inventory.getSlot(this.selectedSlot.area, this.selectedSlot.index);
      if (!stack) return null;
      return { ...this.selectedSlot, stack, item: this.inventory.itemDefinition(stack.itemId) };
    }

    /**
     * Place a selected placeable item. `footprint` (default [[0,0]]) lets a
     * future multi-tile object claim several tiles; every tile is registered
     * in both `placedObjects` (anchor) and `placedObjectTiles` (occupancy).
     */
    giftPlan(x,y) {
      const radius=3*CONFIG.TILE_SIZE;
      if(!Number.isFinite(x)||!Number.isFinite(y)||Math.abs(x-this.player.x)>CONFIG.VIEW_WIDTH/2||Math.abs(y-this.player.y)>CONFIG.VIEW_HEIGHT/2)return {valid:false,x,y,radius};
      for(let ty=Math.floor((y-radius)/20);ty<=Math.floor((y+radius)/20);ty++)for(let tx=Math.floor((x-radius)/20);tx<=Math.floor((x+radius)/20);tx++) {
        const nearX=Math.max(tx*20,Math.min(x,(tx+1)*20)),nearY=Math.max(ty*20,Math.min(y,(ty+1)*20));
        if(Math.hypot(nearX-x,nearY-y)>radius)continue;
        if(this.farm?.get(tx+","+ty)?.crop || this.objectsAt(tx,ty).length || this.world.featureAt(tx,ty)!==FEATURE.NONE)return {valid:false,x,y,radius};
      }
      return {valid:true,x,y,radius};
    }

    throwGift(x,y) {
      const selected=this.getSelectedStack(),plan=this.giftPlan(x,y);
      if(this.paused || this.isDead || !selected || selected.item?.throwable!=="blg")return false;
      if(!plan.valid){this.showToast("范围内有固定物，或目标不在视野内");return false;}
      selected.stack.count--;if(selected.stack.count<=0)this.inventory.removeSlot(selected.area,selected.index);
      (this.giftEffects ||= []).push({x,y,radius:plan.radius,startX:this.player.x,startY:this.player.y,age:0,airTime:0.65});
      this.cancelMining();this.renderInventory();this.syncHeldStats();return true;
    }

    updateGiftEffects(dt) {
      if(!this.giftEffects)return;
      for(const effect of this.giftEffects) {
        const before=effect.age;effect.age+=dt;
        if(before<effect.airTime && effect.age>=effect.airTime)this.audio?.playGiftLand?.();
      }
      this.giftEffects=this.giftEffects.filter(effect=>effect.age<effect.airTime+5);
    }

    // Farming time is measured in game days; pause freezes all progression.
    initFarming() {
      this.farm=new Map();this.farmVisited=new Set();this.waterEffects=[];
      this.world={...this.world};
      const base=this.world.featureAt,remove=this.world.removeFeatureAt,trees=new Set();
      this.farmTrees=trees;
      this.world.featureAt=(x,y)=>trees.has(x+","+y)?FEATURE.TREE:base(x,y);
      this.world.removeFeatureAt=(x,y)=>{trees.delete(x+","+y);remove(x,y);};
    }

    useFarmItem(tx,ty) {
      const held=this.getSelectedStack();if(!held)return false;
      const item=held.item,key=tx+","+ty;
      if(item.toolType!=="hoe" && !item.plant && item.id!=="water_bottle" && item.id!=="animal_manure")return false;
      if(!this.withinRange(tx,ty,MINING_RANGE))return true;
      const soil=this.farm.get(key);
      if(item.id==="animal_manure") {
        if(!soil?.crop || soil.growth>=3)return true;
        soil.growth=Math.min(3,soil.growth+1);
        if(--held.stack.count<=0)this.inventory.removeSlot(held.area,held.index);
        this.matureFarmTree(key,soil);
        this.audio?.playDig?.();
      } else if(item.id==="water_bottle") {
        const result=this.inventory.craft({output:"glass_bottle",count:1,costs:{water_bottle:1}});
        if(!result.ok){this.showToast("背包空间不足");return true;}
        for(let y=ty-1;y<=ty+1;y++)for(let x=tx-1;x<=tx+1;x++) {
          const f=this.farm.get(x+","+y);if(f?.soil)f.wet=true;
        }
        this.waterEffects.push({tx,ty,age:0});this.audio?.playPourWater?.();
      } else if(item.toolType==="hoe") {
        if(this.world.terrainAt(tx,ty)!==TERRAIN.GRASS || this.world.isDug(tx,ty) || this.world.featureAt(tx,ty)!==FEATURE.NONE || this.objectsAt(tx,ty).length || soil)return true;
        this.farm.set(key,{tx,ty,soil:true,wet:false,dryAge:0});
        this.consumeToolDurability({area:held.area,index:held.index,itemId:item.id});this.audio?.playDig?.();
      } else {
        const water=item.plant==="rice";
        if(soil?.crop || this.objectsAt(tx,ty).length || this.world.featureAt(tx,ty)!==FEATURE.NONE || (water ? this.world.waterDepthAt(tx,ty)!==1 : !soil?.soil))return true;
        const f=soil||{tx,ty};f.crop=item.plant;f.growth=0;this.farm.set(key,f);
        if(--held.stack.count<=0)this.inventory.removeSlot(held.area,held.index);
        this.audio?.playDig?.();
      }
      this.cancelMining();this.hideItemDetails();this.renderInventory();this.syncHeldStats();return true;
    }

    updateFarming(dt) {
      if(!this.farm)return;
      // Deterministic isolated wild rice, generated once per explored tile.
      for(let y=this.player.tileY-9;y<=this.player.tileY+9;y++)for(let x=this.player.tileX-13;x<=this.player.tileX+13;x++) {
        const key=x+","+y;if(this.farmVisited.has(key))continue;this.farmVisited.add(key);
        if(!this.farm.has(key) && this.isWildRiceCandidate(x,y) && this.world.waterDepthAt(x,y)===1 && !this.objectsAt(x,y).length)this.farm.set(key,{tx:x,ty:y,crop:"rice",growth:3});
      }
      this.advanceFarmDays(dt/CONFIG.REAL_SECONDS_PER_GAME_DAY);
      for(const e of this.waterEffects){e.age+=dt;if(e.age>=1.2&&!e.drained){e.drained=true;this.audio?.playWaterDrain?.();}}
      this.waterEffects=this.waterEffects.filter(e=>e.age<1.8);
    }

    isWildRiceCandidate(x,y) {
      if(x%3!==0 || y%3!==0)return false;
      const roll=(Math.imul(x,73856093)^Math.imul(y,19349663)^this.world.seed)>>>0;
      // Keep old locations, plus half as many additional isolated locations.
      return roll%13===0 || roll%26===7;
    }

    advanceFarmDays(days,lit=(x,y)=>this.isPositionLit(x,y)) {
      if(!this.farm)return;
      for(const [key,f] of this.farm) {
        if(f.soil&&!f.wet){f.dryAge+=days;if(f.dryAge>=1-1e-9){this.farm.delete(key);continue;}}
        if(!f.crop)continue;
        if(f.crop==="sapling" || lit((f.tx+.5)*CONFIG.TILE_SIZE,(f.ty+.5)*CONFIG.TILE_SIZE))f.growth=Math.min(3,f.growth+days);
        this.matureFarmTree(key,f);
      }
    }

    advanceSleepingFarm(hours) {
      const original=this.clock.time;
      // Sample illumination along the skipped interval, rather than using dawn's light.
      for(let passed=0;passed<hours;) {
        const step=Math.min(0.25,hours-passed);
        this.clock.time=(original+(passed+step/2)*3600)%86400;
        this.advanceFarmDays(step/24,(x,y)=>this.clock.hours>=6 && this.clock.hours<18 ? this.isPositionLit(x,y) : this.isPositionLitBySource(x,y));passed+=step;
      }
      this.clock.time=original;
    }

    matureFarmTree(key,f) {
      if(f.crop==="sapling" && f.growth>=3){this.farm.delete(key);this.farmTrees.add(key);}
    }

    harvestCrop(tx,ty) {
      const f=this.farm.get(tx+","+ty);if(!f?.crop)return;
      const id=f.crop==="sapling"?"sapling":f.crop+"_seed";
      this.spawnDrop(id,f.growth>=3?2:1,tx,ty);
      if(f.growth>=3&&f.crop!=="sapling")this.spawnDrop(f.crop,1,tx,ty);
      delete f.crop;delete f.growth;if(!f.soil)this.farm.delete(tx+","+ty);
      this.audio?.playDig?.();
    }

    fillWaterBottle(tx, ty) {
      if (!this.withinRange(tx,ty,MINING_RANGE) || this.world.terrainAt(tx,ty) !== TERRAIN.OCEAN) return false;
      const result = this.inventory.craft({output:"water_bottle",count:1,costs:{glass_bottle:1}});
      if (!result.ok) { this.showToast("背包空间不足或没有玻璃瓶"); return false; }
      this.renderInventory(); this.syncHeldStats(); this.hideItemDetails(); this.audio?.playFillWater?.();
      this.showToast("获得装水玻璃瓶"); return true;
    }

    hasWaterSupport(tx, ty) { return this.objectsAt(tx, ty).some(o => o.type === "driftwood"); }

    placementPlan(item, tx, ty) {
      const footprint = Array.isArray(item.footprint) && item.footprint.length
        ? item.footprint
        : [[0, 0]];
      const tiles = footprint.map(([offsetX, offsetY]) => ({
        tx: tx + offsetX,
        ty: ty + offsetY,
      }));

      for (const tile of tiles) {
        if (!this.withinRange(tile.tx, tile.ty, MINING_RANGE)) return { valid: false, tiles };
        if(this.farm?.get(tile.tx+","+tile.ty)?.crop)return {valid:false,tiles};
        const existing = this.objectsAt(tile.tx, tile.ty);
        const blocking = Wilds.Buildings.isBlocking({ type: item.placeType });
        if (existing.some(o => blocking ? Wilds.Buildings.isBlocking(o) : o.type === item.placeType)) return { valid: false, tiles };
        if (blocking && (tile.tx === this.player.tileX && tile.ty === this.player.tileY)) return { valid: false, tiles };
        if (blocking && this.mobs.some(m => !m.dying && Math.floor(m.x / CONFIG.TILE_SIZE) === tile.tx && Math.floor(m.y / CONFIG.TILE_SIZE) === tile.ty)) return { valid: false, tiles };
        const terrain = this.world.terrainAt(tile.tx, tile.ty);
        const water = terrain === TERRAIN.OCEAN;
        if (item.placeType === "driftwood" ? !water : item.placeType === "wood_floor" ? water : water && !this.hasWaterSupport(tile.tx, tile.ty)) return { valid: false, tiles };
        if (Wilds.featureBlocksMovement(this.world.featureAt(tile.tx, tile.ty))) return { valid: false, tiles };
      }

      return { valid: true, tiles };
    }

    placeSelectedObject(tx, ty) {
      const held = this.getSelectedStack();
      if (!held || !held.item || !held.item.placeType) return false;
      const { valid, tiles } = this.placementPlan(held.item, tx, ty);
      if (!valid) return false;

      this.addPlacedObject(held.item, tx, ty, tiles);
      held.stack.count -= 1;
      if (held.stack.count <= 0) {
        this.inventory.removeSlot(held.area, held.index);
        if (
          this.selectedSlot &&
          this.selectedSlot.area === held.area &&
          this.selectedSlot.index === held.index
        ) {
          this.selectedSlot = null;
        }
      }

      this.renderInventory();
      this.syncHeldStats();
      this.hideItemDetails();
      if (this.audio) this.audio.playPlace();
      return true;
    }

    addPlacedObject(item, tx, ty, tiles) {
      const object = {
        id: ++this.placedObjectSequence,
        type: item.placeType,
        itemId: item.id,
        tx,
        ty,
        tiles,
        open: false,
        storage: item.placeType === "storage_chest" ? new Array(32).fill(null) : null,
        fuel: item.placeType === "furnace" ? 0 : null,
      };
      object.storageKey = Wilds.Buildings.key(object);
      this.placedObjects.set(object.storageKey, object);
      for (const tile of tiles) {
        const k = tile.tx + "," + tile.ty;
        const previous = this.placedObjectTiles.get(k);
        const occupants = previous instanceof Set ? previous : new Set(previous ? [previous] : []);
        occupants.add(object);
        this.placedObjectTiles.set(k, occupants);
      }

      this.invalidateRooms();
    }

    // Open/interact with a placed object based on its type. Called on a
    // short click; a long press instead mines the object (see updateMining).
    openPlacedObject(tx, ty) {
      if (!this.withinRange(tx, ty, MINING_RANGE)) {
        this.showToast("距离太远，靠近一点");
        return false;
      }
      const object = this.placedObjectAt(tx, ty);
      if (!object) return false;

      if (Wilds.Buildings.isDoor(object)) {
        const previous = object.open;
        object.open = !previous;
        // Do not close or swing a panel through a creature's footprint.
        const p = this.player;
        if (this.groundAreaBlocked(p.x - 4, p.y + 1, p.x + 4, p.y + 8) ||
            this.mobs.some(m => !m.dying && this.groundAreaBlocked(m.x - 5, m.y - 5, m.x + 5, m.y + 6))) {
          object.open = previous;
          this.showToast("门口有生物，无法开合");
        }
        this.invalidateRooms();
      } else if (object.type === "workbench") {
        this.openWorkbench();
      } else if (object.type === "stele") {
        this.openStele();
      } else if (object.type === "respawn_stele") {
        this.activateRespawnStele(object);
      } else if (object.type === "bed") {
        this.trySleep();
      } else if (object.type === "storage_chest") {
        this.openStorage(object);
      } else if (object.type === "furnace") {
        this.openFurnace(object);
      }

      // Torches are decorative/light-producing; clicking them simply
      // consumes the click so it does not become a mining action.
      return true;
    }

    activateRespawnStele(object) {
      object.active = true;
      object.activatedAt = performance.now();
      this.activeRespawnSteles.add(object);
      if (this.audio) this.audio.playRespawnStele();
      this.drawMinimap();
      if (this.mapOpen) this.drawBigMap();
    }

    trySleep() {
      if (this.sleeping) return;
      if (this.clock.phase.key !== "night") {
        this.showToast("现在无法睡觉");
        return;
      }

      if(!this.firstNightLucianSpawned && this.spawnFirstNightLucian(true)) {
        return;
      }

      this.sleeping = true;
      this.keys.clear();
      this.cancelMining();
      this.sleepOverlay.hidden = false;
      this.showToast("睡觉中…", 3000);

      this.finishSleep = () => {
        this.sleepTimeout = 0;
        const skippedHours = (24 - this.clock.hours + 6) % 24;
        this.advanceSleepingFarm(skippedHours);
        this.player.manureDietHours = Math.max(0,(this.player.manureDietHours||0)-skippedHours);
        if (this.clock.hours >= 20) {
          this.clock.day += 1;
        }
        this.clock.time = 6 * 3600;
        this.sleeping = false;
        this.sleepOverlay.hidden = true;
        this.keys.clear();
        this.lastTileX = null;
        this.lastClockText = null;
        this.lastClockDay = null;
        this.lastClockPhase = null;
        this.syncHud(true);
        this.showToast("天亮了");
      };
      this.sleepFinishAt=performance.now()+3000;
      this.sleepTimeout=window.setTimeout(this.finishSleep,3000);
    }

    closeSleep() {
      this.finishSleep=null;
      if (this.sleepTimeout) {
        window.clearTimeout(this.sleepTimeout);
        this.sleepTimeout = 0;
      }
      this.sleeping = false;
      if (this.sleepOverlay) this.sleepOverlay.hidden = true;
    }

    applyDaylightDamage(dt) {
      if (dt <= 0) return;
      const now = performance.now();
      for (const mob of this.mobs) {
        if (!mob.monster || mob.dying || mob.portalFrozen || this.closedRoomAtPosition(mob.x, mob.y)) continue;
        mob.health = Math.max(0, mob.health - 10 * dt * this.mobDamageMultiplier(mob));
        mob.hitFlashUntil = now + 120;
        if (mob.health <= 0) {
          this.beginMobDeath(mob, "sun");
        }
      }
    }

    miningTargetAt(tx, ty) {
      if (!this.world || !this.canUseWorldInput()) return null;
      if (this.placedObjectAt(tx, ty)) return null;
      if (!this.withinRange(tx, ty, MINING_RANGE)) return null;

      if(this.farm?.get(tx+","+ty)?.crop)return {tx,ty,kind:"crop"};
      const feature = this.world.featureAt(tx, ty);
      if (feature === FEATURE.TREE) return { tx, ty, kind: "tree" };
      if (feature === FEATURE.COAL) return { tx, ty, kind: "coal" };
      if (feature === FEATURE.SILICA) return { tx, ty, kind: "silica" };

      if (this.world.isDug(tx, ty)) return null;

      const terrain = this.world.terrainAt(tx, ty);
      if (terrain === TERRAIN.OCEAN) return { tx, ty, kind: "sand" };
      if (terrain === TERRAIN.GRASS) return { tx, ty, kind: "dirt" };
      if (terrain === TERRAIN.ROCK) return { tx, ty, kind: "rock" };

      return null;
    }

    /**
     * Which tile the held selection wants to target, and how fast it mines.
     * The matching tool (axe/shovel/pickaxe) sets normal speed; otherwise a
     * 4× "bare hand / wrong tool" penalty applies.
     */
    miningProfile(kind, objectType = null) {
      if (this.isCreative()) {
        const fastest = Math.max(1, ...Object.values(Wilds.ITEMS).map(item => Number(item.speedMultiplier) || 1));
        return {duration:BASE_MINING_DURATION_MS / fastest,tool:null};
      }
      if(kind==="crop")return {duration:BASE_MINING_DURATION_MS,tool:null};
      const requiredTool = kind === "placed"
        ? Wilds.Buildings.miningTool(objectType)
        : kind === "tree"
        ? "axe"
        : (kind === "dirt" || kind === "sand")
          ? "shovel"
          : kind === "rock" || kind === "coal" || kind === "silica"
            ? "pickaxe"
            : null;
      const held = this.getHeldEquipment();

      if (held && requiredTool && held.item.toolType === requiredTool) {
        const multiplier = Math.max(0.1, Number(held.item.speedMultiplier) || 1);
        return {
          duration: BASE_MINING_DURATION_MS / multiplier,
          tool: {
            area: held.area,
            index: held.index,
            itemId: held.stack.itemId,
          },
        };
      }

      return {
        duration: BASE_MINING_DURATION_MS * HAND_MINING_MULTIPLIER,
        tool: null,
      };
    }

    handlePointerMove(event) {
      if (!this.canUseWorldInput()) return;

      this.pointerClientX = event.clientX;
      this.pointerClientY = event.clientY;
      const tile = this.getPointerTileAt(event.clientX, event.clientY);
      if (!tile) return;

      this.pointerInside = true;
      this.pointerTile = tile;

      if ((this.mining || this.groundClickCandidate) && ((this.mining || this.groundClickCandidate).tx !== tile.tx || (this.mining || this.groundClickCandidate).ty !== tile.ty)) {
        this.cancelMining();
      }

      this.updatePointerTarget();
    }

    handlePointerDown(event) {
      if (!this.canUseWorldInput() || this.player.portalFrozen || event.button !== 0) return;

      this.pointerClientX = event.clientX;
      this.pointerClientY = event.clientY;
      const tile = this.getPointerTileAt(event.clientX, event.clientY);
      if (!tile) return;

      this.pointerInside = true;
      this.pointerTile = tile;

      const held = this.getHeldEquipment();
      const now = performance.now();
      const pointerWorld = this.getPointerWorldPosition(event.clientX, event.clientY);

      const object = this.placedObjectAt(tile.tx, tile.ty);
      const fixedFeature = Wilds.featureBlocksMovement(this.world.featureAt(tile.tx, tile.ty));
      const clickedMob = pointerWorld ? this.findMobAtPointer(pointerWorld.x, pointerWorld.y) : null;
      // Passable layers under a creature must not intercept its attack click.
      if (clickedMob && (!object || !Wilds.Buildings.isBlocking(object))) {
        event.preventDefault();
        this.cancelMining();
        if (held?.item.weaponType === "bow" && !fixedFeature) {this.performHeldClick(tile.tx,tile.ty,pointerWorld);return;}
        if (now < this.nextAttackAt) return;
        this.nextAttackAt = now + 360;
        this.damageMob(clickedMob, this.player.attackDamage);
        if (held && held.item.attackBonus > 0) {
          this.consumeToolDurability({ area: held.area, index: held.index, itemId: held.stack.itemId });
        }
        this.hideItemDetails();
        return;
      }

      // A placed object opens on a short click and is mined on a long press.
      if (object) {
        event.preventDefault();
        if (!this.withinRange(tile.tx, tile.ty, MINING_RANGE)) {
          this.hoverTarget = null;
          this.showToast("距离太远，靠近一点");
          return;
        }
        this.hideItemDetails();
        const objectTarget = {
          tx: tile.tx,
          ty: tile.ty,
          kind: "placed",
          objectType: object.type,
          itemId: object.itemId,
        };
        this.hoverTarget = objectTarget;
        const profile = this.miningProfile("placed", object.type);
        this.mining = {
          tx: tile.tx,
          ty: tile.ty,
          kind: "placed",
          objectType: object.type,
          itemId: object.itemId,
          start: performance.now(),
          duration: profile.duration,
          tool: profile.tool,
          progress: 0,
        };
        this.objectClickCandidate = { tx: tile.tx, ty: tile.ty };

        try {
          this.canvas.setPointerCapture(event.pointerId);
          this.pointerId = event.pointerId;
        } catch (error) {
          this.pointerId = null;
        }
        return;
      }

      // A short click uses the held item; holding always digs the target.
      const selected=this.getSelectedStack();
      if(!fixedFeature && this.hasHeldClickAction(selected?.item)) {
        this.groundClickCandidate={tx:tile.tx,ty:tile.ty,point:pointerWorld,startedAt:now};
        event.preventDefault();
        try {this.canvas.setPointerCapture(event.pointerId);this.pointerId=event.pointerId;}catch {this.pointerId=null;}
      }

      const target = this.miningTargetAt(tile.tx, tile.ty);
      if (!target) return;

      event.preventDefault();
      this.hideItemDetails();
      this.hoverTarget = target;
      const profile = this.miningProfile(target.kind);
      this.mining = {
        tx: target.tx,
        ty: target.ty,
        kind: target.kind,
        start: performance.now(),
        duration: profile.duration,
        tool: profile.tool,
        progress: 0,
      };

      try {
        this.canvas.setPointerCapture(event.pointerId);
        this.pointerId = event.pointerId;
      } catch (error) {
        this.pointerId = null;
      }
    }

    hasHeldClickAction(item) {
      return Boolean(item && (item.id==="creation_scroll" || item.weaponType==="bow" || item.toolType==="hoe" || item.plant || ["glass_bottle","water_bottle","animal_manure"].includes(item.id) || item.throwable || item.placeType));
    }

    performHeldClick(tx,ty,pointerWorld) {
      const held=this.getHeldEquipment(),now=performance.now();
      if (held && held.stack.itemId === "creation_scroll") {
        
        this.useCreationScroll();
        return;
      }

      if (held && held.item.weaponType === "bow" && pointerWorld) {
        
        if (now < this.nextAttackAt) return;
        this.nextAttackAt = now + 360;
        this.spawnProjectile(
          "arrow",
          "player",
          this.player.x,
          this.player.y,
          pointerWorld.x,
          pointerWorld.y,
          held.item.attackDamage || 40,
          280,
          12 * CONFIG.TILE_SIZE
        );
        this.consumeToolDurability({
          area: held.area,
          index: held.index,
          itemId: held.stack.itemId,
        });
        this.hideItemDetails();
        return;
      }

      if (this.useFarmItem(tx,ty)) {return;}

      if (this.getSelectedStack()?.stack.itemId === "glass_bottle" && this.world.terrainAt(tx,ty) === TERRAIN.OCEAN) {
         this.fillWaterBottle(tx,ty); return;
      }

      if(this.getSelectedStack()?.item?.throwable==="blg" && pointerWorld) {
        this.throwGift(pointerWorld.x,pointerWorld.y);return;
      }

      const selected = this.getSelectedStack();
      if (selected && selected.item && selected.item.placeType) {
        
        if (!this.withinRange(tx, ty, MINING_RANGE)) {
          this.showToast("距离太远，靠近一点");
          return;
        }
        this.hideItemDetails();
        this.placeSelectedObject(tx, ty);
        return;
      }

    }

    handlePointerUp() {
      this.releaseMiningPointer();
      if (!this.canUseWorldInput()) {
        this.cancelMining();
        return;
      }
      const candidate = this.objectClickCandidate;
      const groundClick=this.groundClickCandidate;
      const wasObjectPress = Boolean(
        this.mining &&
        this.mining.kind === "placed" &&
        this.mining.progress < 1
      );

      this.cancelMining();
      if (candidate && wasObjectPress) {
        const object=this.placedObjectAt(candidate.tx,candidate.ty);
        const interactive=object && ["workbench","stele","respawn_stele","bed","storage_chest","furnace"].includes(object.type);
        const held=this.getSelectedStack();
        // Decorative layers remain stackable on a short click. Holding always mines.
        if(!interactive && !Wilds.Buildings.isDoor(object) && held?.item?.placeType && this.placementPlan(held.item,candidate.tx,candidate.ty).valid) {
          this.placeSelectedObject(candidate.tx,candidate.ty);
        } else this.openPlacedObject(candidate.tx, candidate.ty);
      }
      if(groundClick && performance.now()-groundClick.startedAt<280 && !this.paused && !this.isDead) {
        this.performHeldClick(groundClick.tx,groundClick.ty,groundClick.point);
      }
      this.refreshPointerTile();
      this.updatePointerTarget();
    }

    releaseMiningPointer() {
      if (this.pointerId === null) return;
      try {
        this.canvas.releasePointerCapture(this.pointerId);
      } catch (error) {
        // The pointer may already have been released by the browser.
      }
      this.pointerId = null;
    }

    cancelMining() {
      this.mining = null;
      this.objectClickCandidate = null;
      this.groundClickCandidate = null;
    }

    refreshPointerTile() {
      if (!this.pointerInside || !this.canUseWorldInput()) return;

      const tile = this.getPointerTileAt(this.pointerClientX, this.pointerClientY);
      this.pointerTile = tile;

      if (!tile) {
        this.cancelMining();
        return;
      }

      if ((this.mining || this.groundClickCandidate) && ((this.mining || this.groundClickCandidate).tx !== tile.tx || (this.mining || this.groundClickCandidate).ty !== tile.ty)) {
        this.cancelMining();
      }
    }

    updatePointerTarget() {
      if (!this.pointerInside || !this.pointerTile || !this.canUseWorldInput()) {
        this.hoverTarget = null;
        return;
      }

      this.hoverTarget = this.miningTargetAt(this.pointerTile.tx, this.pointerTile.ty);
    }

    updateMining(now) {
      if (!this.mining) return;
      if (!this.canUseWorldInput()) {
        this.cancelMining();
        return;
      }

      if (this.mining.kind === "placed") {
        const object = this.placedObjectAt(this.mining.tx, this.mining.ty);
        if (!object || object.itemId !== this.mining.itemId) {
          this.cancelMining();
          return;
        }
        if (!this.withinRange(this.mining.tx, this.mining.ty, MINING_RANGE)) {
          this.cancelMining();
          return;
        }

        const progress = Math.min(1, (now - this.mining.start) / this.mining.duration);
        this.mining.progress = progress;
        if (progress < 1) return;

        const usedTool = this.mining.tool;
        this.finishObjectMining(this.mining);
        this.consumeToolDurability(usedTool);
        this.cancelMining();
        this.updatePointerTarget();
        return;
      }

      const target = this.miningTargetAt(this.mining.tx, this.mining.ty);
      if (!target || target.kind !== this.mining.kind) {
        this.cancelMining();
        return;
      }

      const progress = Math.min(1, (now - this.mining.start) / this.mining.duration);
      this.mining.progress = progress;

      if (progress < 1) return;

      const usedTool = this.mining.tool;
      this.finishMining(target);
      this.consumeToolDurability(usedTool);
      this.cancelMining();
      this.updatePointerTarget();
    }

    detachPlacedObject(object) {
      this.placedObjects.delete(object.storageKey || Wilds.Buildings.key(object));
      if (object.type === "respawn_stele") this.activeRespawnSteles.delete(object);
      for (const tile of object.tiles || [{ tx: object.tx, ty: object.ty }]) {
        const key = tile.tx + "," + tile.ty;
        const occupants = this.placedObjectTiles.get(key);
        if (occupants instanceof Set) {
          occupants.delete(object);
          if (!occupants.size) this.placedObjectTiles.delete(key);
        } else if (occupants === object) this.placedObjectTiles.delete(key);
      }
    }

    finishObjectMining(mining) {
      const object = this.placedObjectAt(mining.tx, mining.ty);
      if (!object) return;
      if (Wilds.Buildings.isBlocking(object)) {
        const torches = new Set((object.tiles || [object]).flatMap(tile => this.objectsAt(tile.tx, tile.ty).filter(o => o.type === "torch")));
        for (const torch of torches) {
          this.detachPlacedObject(torch);
          this.spawnDrop(torch.itemId, 1, torch.tx, torch.ty);
        }
      }
      this.detachPlacedObject(object);
      if (object.type === "storage_chest" && object.storage) {
        for (const stack of object.storage) {
          if (stack) this.spawnDrop(stack.itemId, stack.count, mining.tx, mining.ty, stack.durability, stack.skillReadyAt);
        }
      }
      this.invalidateRooms();
      this.spawnDrop(object.itemId, 1, mining.tx, mining.ty);
      this.drawMinimap();
      if (this.mapOpen) this.drawBigMap();
    }

    consumeToolDurability(tool) {
      if (!tool || this.isCreative()) return;

      const stack = this.inventory.getSlot(tool.area, tool.index);
      if (!stack || stack.itemId !== tool.itemId) return;

      const item = this.inventory.itemDefinition(stack.itemId);
      if (!item || item.kind !== "equipment" || item.unbreakable) return;

      const maximum = item.maxDurability || 1;
      const current = Number.isFinite(stack.durability) ? stack.durability : maximum;
      const next = Math.max(0, current - 1);

      if (next <= 0) {
        this.inventory.removeSlot(tool.area, tool.index);
        if(tool.area==="equipment") {
          for(const area of ["backpack","equipment"]) {
            const slots=this.inventory.getSlots(area);
            const replacement=slots.findIndex(s=>s?.itemId===tool.itemId && (s.durability??maximum)>0);
            if(replacement<0)continue;
            this.inventory.setSlot("equipment",tool.index,slots[replacement]);
            this.inventory.removeSlot(area,replacement);
            break;
          }
        }
      } else {
        stack.durability = next;
      }

      this.renderInventory();
      this.syncHeldStats();
    }

    finishMining(target) {
      if (target.kind === "crop") {this.harvestCrop(target.tx,target.ty);return;}
      if (target.kind === "sand") {
        if (this.world.isDug(target.tx, target.ty)) return;
        this.world.markDug(target.tx, target.ty); this.spawnDrop("fine_sand",1,target.tx,target.ty);
        this.audio?.playDig();
      } else if (target.kind === "silica") {
        this.world.removeFeatureAt(target.tx,target.ty); this.spawnDrop("silica",1,target.tx,target.ty);
        this.audio?.playMine();
      } else if (target.kind === "tree") {
        if (this.audio) this.audio.playChop();
        this.world.removeFeatureAt(target.tx, target.ty);
        this.spawnDrop("wood", 3, target.tx, target.ty);
        this.spawnDrop("sapling",1,target.tx,target.ty);
      } else if (target.kind === "coal") {
        if (this.audio) this.audio.playMine();
        this.world.removeFeatureAt(target.tx, target.ty);
        this.spawnDrop("coal", 1, target.tx, target.ty);
      } else if (target.kind === "dirt") {
        if (this.audio) this.audio.playDig();
        this.world.markDug(target.tx, target.ty);
        this.spawnDrop("dirt", 1, target.tx, target.ty);
        this.farm?.delete(target.tx+","+target.ty);
        if(Math.random()<0.25)this.spawnDrop("wheat_seed",1,target.tx,target.ty);
      } else if (target.kind === "rock") {
        if (this.audio) this.audio.playMine();
        this.world.markDug(target.tx, target.ty);
        this.spawnDrop("rock", 1, target.tx, target.ty);
      }
    }

    dropDistance(drop) {
      const centerX = (drop.tx + 0.5) * CONFIG.TILE_SIZE;
      const centerY = (drop.ty + 0.5) * CONFIG.TILE_SIZE;
      return Math.hypot(this.player.x - centerX, this.player.y - centerY);
    }

    spawnDrop(itemId, count, tx, ty, durability, skillReadyAt) {
      const now = performance.now();
      const distance = this.dropDistance({ tx, ty });

      this.drops.push({
        id: ++this.dropSequence,
        itemId,
        count,
        durability: Number.isFinite(durability) ? durability : undefined,
        skillReadyAt,
        tx,
        ty,
        createdAt: now,
        expiresAt: now + CONFIG.DROP_LIFETIME_MS,
        // A drop created on top of the player must be stepped away from
        // before it can be picked back up.
        armed: distance > PICKUP_RADIUS,
      });
    }

    expireDrops(now) {
      if (!this.drops.length) return;
      const time = Number.isFinite(now) ? now : performance.now();
      for (let i = this.drops.length - 1; i >= 0; i -= 1) {
        if (time >= this.drops[i].expiresAt) {
          this.drops.splice(i, 1);
        }
      }
    }

    collectNearbyDrops(now) {
      if (!this.drops.length || !this.player) return;

      const time = Number.isFinite(now) ? now : performance.now();
      let changed = false;

      for (let i = this.drops.length - 1; i >= 0; i -= 1) {
        const drop = this.drops[i];

        if (time >= drop.expiresAt) {
          this.drops.splice(i, 1);
          continue;
        }

        const distance = this.dropDistance(drop);

        if (!drop.armed) {
          if (distance > PICKUP_RADIUS) {
            drop.armed = true;
          }
          continue;
        }

        if (distance > PICKUP_RADIUS) continue;

        const item = this.inventory.itemDefinition(drop.itemId);
        let accepted = 0;
        if (item && item.kind === "equipment" && this.inventory.maxStackFor(drop.itemId)===1) {
          accepted = this.inventory.addEquipment(drop.itemId, drop.durability, drop.skillReadyAt) ? 1 : 0;
        } else {
          accepted = this.inventory.addItem(drop.itemId, drop.count);
        }
        if (accepted <= 0) continue;

        drop.count -= accepted;
        changed = true;

        if (drop.count <= 0) {
          this.drops.splice(i, 1);
        }
      }

      if (changed) {
        this.renderInventory();
        this.syncHeldStats();
      }
    }

    renderTarget() {
      if (!this.canUseWorldInput()) return null;
      const selected = this.getSelectedStack();
      if (selected?.item.skill === "portal" && this.pointerInside && !this.player.portalFrozen) {
        const point = this.getPointerWorldPosition(this.pointerClientX, this.pointerClientY);
        if (point) return { ...this.portalPlan(point.x, point.y), kind: "portal" };
      }
      if (!this.mining && selected?.item?.throwable === "blg" && this.pointerInside) {
        const point=this.getPointerWorldPosition(this.pointerClientX,this.pointerClientY);
        if(point)return {...this.giftPlan(point.x,point.y),kind:"gift"};
      }
      if (!this.mining && this.pointerInside && this.pointerTile && selected?.item?.placeType) {
        const { tx, ty } = this.pointerTile;
        const { valid, tiles } = this.placementPlan(selected.item, tx, ty);
        return { tx, ty, kind: "placement", valid, object: {
          tx, ty, type: selected.item.placeType, itemId: selected.item.id, id: 0, tiles, open: false,
        } };
      }
      if (!this.hoverTarget && !this.mining) return null;

      const target = this.mining || this.hoverTarget;
      if (!target) return null;

      return {
        tx: target.tx,
        ty: target.ty,
        kind: target.kind,
        progress: this.mining ? this.mining.progress : 0,
        active: Boolean(this.mining),
      };
    }

    /* ---------------- HUD ---------------- */

    updateSurvival(gameHoursDelta) {
      if (this.isCreative() || !this.player || this.isDead || gameHoursDelta <= 0) return;

      const player = this.player;
      const day = this.clock.day;
      const hours = this.clock.hours;
      const afterSecondDawn =
        day > 2 || (day === 2 && hours >= 6);

      if (afterSecondDawn) {
        const fullyFed = player.satiety >= player.maxSatiety - 0.0001;
        if (fullyFed && this.satietyGraceRemaining > 0) {
          this.satietyGraceRemaining = Math.max(
            0,
            this.satietyGraceRemaining - gameHoursDelta
          );
        } else {
          player.satiety = Math.max(
            0,
            player.satiety - gameHoursDelta * (CONFIG.SATIETY_DRAIN_PER_GAME_DAY / 24)
          );
        }
      }

      player.updateEffects(gameHoursDelta);

      if (
        player.satiety >= player.maxSatiety - 0.0001 &&
        player.health > 0 &&
        player.health < player.maxHealth
      ) {
        player.health = Math.min(
          player.maxHealth,
          player.health + gameHoursDelta * CONFIG.SATIETY_REGEN_HEALTH_PER_GAME_HOUR
        );
      }
    }

    /* ---------------- Mobs, spawning, combat and projectiles ---------------- */

    spawnMob(type, tx, ty) {
      const definition = MOB_TYPES[type];
      if (!definition) return null;
      const mob = {
        id: ++this.mobSequence,
        type,
        name: definition.name,
        monster: definition.monster,
        aquatic: Boolean(definition.aquatic),
        provoked: false,
        maxHealth: definition.maxHealth,
        health: definition.maxHealth,
        speed: definition.speed,
        x: (tx + 0.5) * CONFIG.TILE_SIZE,
        y: (ty + 0.5) * CONFIG.TILE_SIZE,
        lastSafeX: (tx + 0.5) * CONFIG.TILE_SIZE,
        lastSafeY: (ty + 0.5) * CONFIG.TILE_SIZE,
        dirX: Math.random() * 2 - 1,
        dirY: Math.random() * 2 - 1,
        nextDecisionAt: 0,
        fleeUntil: 0,
        attackAt: 0,
        aggro: false,
        // Pig timers use game hours; spiders use simulation time for their leap.
        manureHoursRemaining: type === "pig" ? 12 + Math.random() * 12 : null,
        jumpCooldown: 0,
        jump: null,
        blinkCooldown: 0,
        blinkRetry: 0,
        blinkFlash: 0,
        oxygen: CONFIG.OXYGEN_MAX,
        maxOxygen: CONFIG.OXYGEN_MAX,
        deepWaterEscape: false,
        portalLandEscape: false,
        beached: false,
        portalFrozen: false,
        portalOwner: null,
        waterDeathRemaining: null,
        hitFlashUntil: 0,
        dying: false,
        deathStartedAt: 0,
        deathDuration: MOB_DEATH_ANIMATION_MS,
      };
      this.mobs.push(mob);
      return mob;
    }

    invalidateRooms() { this.roomTopologyDirty = true; }

    getRoomIndex() {
      const count = this.placedObjects?.size || 0;
      if (!this.roomIndex || this.roomTopologyDirty || this.roomObjectCount !== count) {
        const objects = this.placedObjects ? [...this.placedObjects.values()] : [];
        this.roomIndex = new Wilds.Buildings.RoomIndex(objects, (tx, ty) => this.isGroundBlockedForCreature(tx, ty));
        this.roomObjectCount = count;
        this.roomTopologyDirty = false;
      }
      return this.roomIndex;
    }

    closedRoomAtPosition(x, y) {
      return this.getRoomIndex().at(Math.floor(x / CONFIG.TILE_SIZE), Math.floor(y / CONFIG.TILE_SIZE));
    }

    canMonsterAggro(mob) {
      if (this.isCreative()) return false;
      return Boolean(this.closedRoomAtPosition(mob.x, mob.y)) === Boolean(this.closedRoomAtPosition(this.player.x, this.player.y));
    }

    isRoomInView(room) {
      return (room.surfaceCells || room.cells).some(tile => Math.abs((tile.tx + 0.5) * CONFIG.TILE_SIZE - this.player.x) <= CONFIG.VIEW_WIDTH / 2 + CONFIG.TILE_SIZE / 2 &&
        Math.abs((tile.ty + 0.5) * CONFIG.TILE_SIZE - this.player.y) <= CONFIG.VIEW_HEIGHT / 2 + CONFIG.TILE_SIZE / 2);
    }

    monsterSpawnAllowed(tx, ty) {
      const x = (tx + 0.5) * CONFIG.TILE_SIZE, y = (ty + 0.5) * CONFIG.TILE_SIZE;
      const room = this.closedRoomAtPosition(x, y);
      if (room) return !this.isRoomInView(room) && !this.isPositionLitBySource(x, y);
      const hour = this.clock.hours;
      return (hour >= 20 || hour < 6) && !this.isPositionLitBySource(x, y);
    }

    isPositionLit(x, y) {
      if (this.closedRoomAtPosition(x, y)) return this.isPositionLitBySource(x, y);
      if (this.clock.lighting.darkness < 0.35) return true;
      return this.isPositionLitBySource(x, y);
    }

    isPositionLitBySource(x, y) {
      const room = this.closedRoomAtPosition(x, y);
      if (Wilds.portalLightSources(this.portalEffects).some(light =>
        this.closedRoomAtPosition(light.x, light.y) === room && Math.hypot(x - light.x, y - light.y) < light.radius)) return true;
      if (room) return this.getRoomIndex().torchesFor(room).some(torch =>
        Math.hypot(x - (torch.tx + 0.5) * CONFIG.TILE_SIZE, y - (torch.ty + 0.5) * CONFIG.TILE_SIZE) < CONFIG.VIEW_WIDTH * 0.25);
      for (const object of this.placedObjects.values()) {
        if (this.getRoomIndex().at(object.tx, object.ty)) continue;
        if (object.type === "torch") {
          if (Math.hypot(x - (object.tx + 0.5) * 20, y - (object.ty + 0.5) * 20) < 120) return true;
        } else if (object.type === "respawn_stele" && object.active) {
          if (Math.hypot(x - (object.tx + 0.5) * 20, y - (object.ty + 0.5) * 20) < 42) return true;
        }
      }
      return false;
    }

    findMobSpawnTile(monster) {
      const px = this.player.tileX;
      const py = this.player.tileY;
      if (monster) {
        const cells = this.getRoomIndex().closedRooms.filter(room => !this.isRoomInView(room)).flatMap(room => room.cells);
        for (let attempt = 0; attempt < Math.min(80, cells.length * 2); attempt++) {
          const tile = cells[Math.floor(Math.random() * cells.length)];
          const x = (tile.tx + 0.5) * CONFIG.TILE_SIZE, y = (tile.ty + 0.5) * CONFIG.TILE_SIZE;
          if (!this.isWithinMobRange(x, y)) continue;
          if (this.monsterSpawnAllowed(tile.tx, tile.ty) && this.mobCanOccupy(x, y) &&
              !this.mobs.some(m => !m.dying && Math.hypot(m.x - x, m.y - y) < CONFIG.TILE_SIZE)) return tile;
        }
      }
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const angle = Math.random() * Math.PI * 2;
        const distance = 13 + Math.random() * (CONFIG.MOB_ACTIVE_RADIUS - 13);
        const tx = px + Math.round(Math.cos(angle) * distance);
        const ty = py + Math.round(Math.sin(angle) * distance);
        if (!this.isWithinMobRange((tx + 0.5) * CONFIG.TILE_SIZE, (ty + 0.5) * CONFIG.TILE_SIZE)) continue;
        if (Math.abs(tx - px) <= 12 && Math.abs(ty - py) <= 7.5) continue;
        if (this.world.terrainAt(tx, ty) === TERRAIN.OCEAN && (this.world.waterDepthAt?.(tx,ty)===1 || !this.hasWaterSupport(tx, ty))) continue;
        if (this.isGroundBlockedForCreature(tx, ty)) continue;
        if (!this.mobCanOccupy((tx + 0.5) * CONFIG.TILE_SIZE, (ty + 0.5) * CONFIG.TILE_SIZE)) continue;
        const steps = Math.max(2, Math.ceil(distance * 2));
        let blocked = false;
        for (let i = 1; i < steps; i += 1) {
          const t = i / steps;
          const pathX = Math.floor(px + 0.5 + (tx - px) * t);
          const pathY = Math.floor(py + 0.5 + (ty - py) * t);
          if (this.world.terrainAt(pathX, pathY) === TERRAIN.OCEAN && !this.hasWaterSupport(pathX, pathY)) {
            blocked = true;
            break;
          }
        }
        if (blocked) continue;
        if (monster && this.monsterSpawnAllowed(tx, ty)) {
          return { tx, ty };
        }
        if (!monster) return { tx, ty };
      }
      return null;
    }

    spawnAquaticPopulation() {
      for (const [type,limit] of [["small_fish",6],["shark",2]]) {
        if(this.mobs.filter(m=>m.type===type&&!m.dying).length>=limit || Math.random()>0.55) continue;
        for(let attempt=0;attempt<40;attempt++) {
          const angle=Math.random()*Math.PI*2, radius=13+Math.random()*(CONFIG.MOB_ACTIVE_RADIUS-13);
          const tx=this.player.tileX+Math.round(Math.cos(angle)*radius),ty=this.player.tileY+Math.round(Math.sin(angle)*radius);
          if (!this.isWithinMobRange((tx + 0.5) * CONFIG.TILE_SIZE, (ty + 0.5) * CONFIG.TILE_SIZE)) continue;
          if(Math.abs((tx+0.5)*20-this.player.x)<=CONFIG.VIEW_WIDTH/2 && Math.abs((ty+0.5)*20-this.player.y)<=CONFIG.VIEW_HEIGHT/2)continue;
          if(this.mobCanOccupy((tx+0.5)*20,(ty+0.5)*20,{aquatic:true})) {this.spawnMob(type,tx,ty);break;}
        }
      }
    }

    updateSpawner(dt) {
      this.mobSpawnTimer -= dt;
      if (this.mobSpawnTimer > 0) return;
      this.mobSpawnTimer = 0.8;
      this.spawnAquaticPopulation();

      const visibleAnimals = this.mobs.filter((mob) =>
        !mob.monster && !mob.aquatic && this.isMobInView(mob)
      ).length;
      const visibleMonsters = this.mobs.filter((mob) =>
        mob.monster && this.isMobInView(mob)
      ).length;
      const totalAnimals = this.mobs.filter((mob) => !mob.monster && !mob.aquatic).length;
      const totalMonsters = this.mobs.filter((mob) => mob.monster).length;

      if (
        visibleAnimals < this.animalTarget &&
        totalAnimals < this.animalTarget * 2 &&
        Math.random() < 0.85
      ) {
        const spot = this.findMobSpawnTile(false);
        if (spot) {
          const types = ["sheep", "algorithm_chicken", "pig"];
          this.spawnMob(types[Math.floor(Math.random() * types.length)], spot.tx, spot.ty);
        }
      }

      if (
        visibleMonsters < this.monsterTarget &&
        totalMonsters < this.monsterTarget * 2 &&
        Math.random() < 0.8
      ) {
        const spot = this.findMobSpawnTile(true);
        if (spot) {
          this.spawnNaturalMonster(this.rollMonsterType(), spot.tx, spot.ty);
        }
      }
    }

    rollMonsterType() {
      const night=this.lucianNightKey();
      const available=!this.lucianSpawnNights?.has(night) && !(night===1 && !this.firstNightLucianSpawned);
      const roll=Math.random()*(available?28:27);
      return roll<10?"zombie":roll<18?"savage_archer":roll<23?"spider":roll<27?"enderman":"dark_lucian";
    }

    lucianNightKey() {
      // Midnight belongs to the same night; the next allowance starts at dawn.
      return this.clock.day-(this.clock.hours<6?1:0);
    }

    spawnNaturalMonster(type,tx,ty) {
      const night=this.lucianNightKey();
      if(type==="dark_lucian" && this.lucianSpawnNights?.has(night))return null;
      const mob=this.spawnMob(type,tx,ty);
      if(mob && type==="dark_lucian")(this.lucianSpawnNights ||= new Set()).add(night);
      return mob;
    }

    isWithinMobRange(x, y) {
      return Math.hypot(x - this.player.x, y - this.player.y) <= CONFIG.MOB_ACTIVE_RADIUS * CONFIG.TILE_SIZE;
    }

    isMobInView(mob) {
      return (
        Math.abs(mob.x - this.player.x) <= CONFIG.VIEW_WIDTH / 2 &&
        Math.abs(mob.y - this.player.y) <= CONFIG.VIEW_HEIGHT / 2
      );
    }

    findNearestUnblockedPosition(x, y, canOccupy) {
      const centerX = Math.floor(x / CONFIG.TILE_SIZE);
      const centerY = Math.floor(y / CONFIG.TILE_SIZE);
      for (let radius = 0; radius <= 16; radius += 1) {
        for (let dy = -radius; dy <= radius; dy += 1) {
          for (let dx = -radius; dx <= radius; dx += 1) {
            if (radius > 0 && Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
            const candidateX = (centerX + dx + 0.5) * CONFIG.TILE_SIZE;
            const candidateY = (centerY + dy + 0.5) * CONFIG.TILE_SIZE;
            if (canOccupy(candidateX, candidateY)) {
              return { x: candidateX, y: candidateY };
            }
          }
        }
      }
      return { x, y };
    }

    creaturePathClear(x1, y1, x2, y2, canOccupy) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const distance = Math.hypot(dx, dy);
      const steps = Math.max(1, Math.ceil(distance / 1));
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        if (!canOccupy(x1 + dx * t, y1 + dy * t)) return false;
      }
      return true;
    }

    // Walking and jumping must end on a legal tile with a clear path from
    // the last safe position. Intentional teleports validate their landing
    // and replace that safe position atomically before this check.
    enforceGroundObstacleInvariant() {
      const player = this.player;
      const playerLastSafe = this.lastPlayerSafe;
      const playerCurrentValid = player.portalFrozen || player.canOccupy(player.x, player.y);
      const playerPathClear = player.portalFrozen || !playerLastSafe || this.creaturePathClear(
        playerLastSafe.x,
        playerLastSafe.y,
        player.x,
        player.y,
        (x, y) => player.canOccupy(x, y)
      );
      if (!playerCurrentValid || !playerPathClear) {
        const safe = playerLastSafe && player.canOccupy(playerLastSafe.x, playerLastSafe.y)
          ? playerLastSafe
          : this.findNearestUnblockedPosition(
            player.x,
            player.y,
            (x, y) => player.canOccupy(x, y)
          );
        player.x = safe.x;
        player.y = safe.y;
      }
      if (player.canOccupy(player.x, player.y)) {
        this.lastPlayerSafe = { x: player.x, y: player.y };
      }

      for (const mob of this.mobs) {
        if (mob.portalFrozen) continue;
        const lastSafeValid = Number.isFinite(mob.lastSafeX) &&
          Number.isFinite(mob.lastSafeY) &&
          this.mobCanOccupy(mob.lastSafeX, mob.lastSafeY, mob);
        const currentValid = this.mobCanOccupy(mob.x, mob.y, mob);
        const pathClear = !lastSafeValid || this.creaturePathClear(
          mob.lastSafeX,
          mob.lastSafeY,
          mob.x,
          mob.y,
          (x, y) => this.mobCanOccupy(x, y, mob)
        );
        if (!currentValid || !pathClear) {
          const safe = lastSafeValid
            ? { x: mob.lastSafeX, y: mob.lastSafeY }
            : this.findNearestUnblockedPosition(
              mob.x,
              mob.y,
              (x, y) => this.mobCanOccupy(x, y, mob)
            );
          mob.x = safe.x;
          mob.y = safe.y;
        }
        if (this.mobCanOccupy(mob.x, mob.y, mob)) {
          mob.lastSafeX = mob.x;
          mob.lastSafeY = mob.y;
        }
      }
    }

    /**
     * Creature collision footprint. Land creatures cannot occupy ocean or
     * any blocked tile; this small box (not just the centre point) prevents
     * half-body overlap into trees/objects.
     */
    mobCanOccupy(x, y, mob = null) {
      if (this.groundAreaBlocked(x - 5, y - 5, x + 5, y + 6)) return false;
      // Once exposed, water is traversable during the fatal countdown. Normal
      // endermen still avoid it, but collision repair must not eject an arrival.
      const waterExposedEnderman = mob?.type === "enderman" && mob.waterDeathRemaining != null;
      const halfWidth = 5;
      const minTileX = Math.floor((x - halfWidth) / CONFIG.TILE_SIZE);
      const maxTileX = Math.floor((x + halfWidth) / CONFIG.TILE_SIZE);
      const minTileY = Math.floor((y - 5) / CONFIG.TILE_SIZE);
      const maxTileY = Math.floor((y + 6) / CONFIG.TILE_SIZE);
      for (let ty = minTileY; ty <= maxTileY; ty += 1) {
        for (let tx = minTileX; tx <= maxTileX; tx += 1) {
          const water=this.world.terrainAt(tx,ty)===TERRAIN.OCEAN;
          // Endermen fear both shallow and deep water, including supported water tiles.
          if (mob?.type === "enderman" && water && !waterExposedEnderman) return false;
          const depth=water?(this.world.waterDepthAt?.(tx,ty)??2):0;
          if(mob?.aquatic ? !mob.portalLandEscape && (depth!==2 || this.hasWaterSupport(tx,ty)) : depth===2 && !this.hasWaterSupport(tx,ty) && !mob?.deepWaterEscape && !waterExposedEnderman)return false;
          if (Wilds.featureBlocksMovement(this.world.featureAt(tx, ty))) return false;
        }
      }
      return true;
    }

    // Move a mob toward (dx,dy), sliding along an obstacle axis if the full
    // diagonal is blocked. Always routes through the collision system.
    moveMob(mob, dx, dy, dt) {
      if (mob.portalFrozen || mob.beached) return false;
      const length = Math.hypot(dx, dy) || 1;
      const stepX = (dx / length) * mob.speed * dt;
      const stepY = (dy / length) * mob.speed * dt;
      const nextX = mob.x + stepX;
      const nextY = mob.y + stepY;

      if (this.creaturePathClear(mob.x, mob.y, nextX, nextY, (x, y) => this.mobCanOccupy(x, y, mob))) {
        mob.x = nextX;
        mob.y = nextY;
        mob.lastSafeX = nextX;
        mob.lastSafeY = nextY;
        return true;
      }

      // Slide around obstacles instead of freezing against them.
      if (this.creaturePathClear(mob.x, mob.y, nextX, mob.y, (x, y) => this.mobCanOccupy(x, y, mob))) {
        mob.x = nextX;
        mob.lastSafeX = nextX;
        mob.lastSafeY = mob.y;
        return true;
      }
      if (this.creaturePathClear(mob.x, mob.y, mob.x, nextY, (x, y) => this.mobCanOccupy(x, y, mob))) {
        mob.y = nextY;
        mob.lastSafeX = mob.x;
        mob.lastSafeY = nextY;
        return true;
      }

      mob.dirX = -mob.dirX;
      mob.dirY = -mob.dirY;
      return false;
    }

    // A leap follows a ground path: both the full route and each frame use
    // the same footprint collision checks as walking. No jumping over fixtures.
    trySpiderJump(mob) {
      const dx = this.player.x - mob.x;
      const dy = this.player.y - mob.y;
      const distance = Math.hypot(dx, dy);
      if (mob.jump || mob.jumpCooldown > 0 || distance <= CONFIG.TILE_SIZE * 1.15 || distance > CONFIG.TILE_SIZE * 5) return false;
      const travel = distance - CONFIG.TILE_SIZE;
      const x = mob.x + dx / distance * travel;
      const y = mob.y + dy / distance * travel;
      if (!this.creaturePathClear(mob.x, mob.y, x, y, (px, py) => this.mobCanOccupy(px, py))) return false;
      mob.jump = { startX: mob.x, startY: mob.y, x, y, elapsed: 0, duration: 0.4 };
      mob.jumpCooldown = 3;
      return true;
    }

    updateSpiderJump(mob, dt) {
      const jump = mob.jump;
      jump.elapsed = Math.min(jump.duration, jump.elapsed + dt);
      const t = jump.elapsed / jump.duration;
      const x = jump.startX + (jump.x - jump.startX) * t;
      const y = jump.startY + (jump.y - jump.startY) * t;
      if (!this.creaturePathClear(mob.x, mob.y, x, y, (px, py) => this.mobCanOccupy(px, py))) {
        mob.jump = null;
        return;
      }
      mob.x = x;
      mob.y = y;
      mob.lastSafeX = x;
      mob.lastSafeY = y;
      if (t >= 1) mob.jump = null;
    }

    /* ---------------- Paired portals and involuntary immersion ---------------- */

    portalPlan(worldX, worldY, fromMap = false) {
      const tx = Math.floor(worldX / CONFIG.TILE_SIZE), ty = Math.floor(worldY / CONFIG.TILE_SIZE);
      const x = (tx + 0.5) * CONFIG.TILE_SIZE, y = (ty + 0.5) * CONFIG.TILE_SIZE;
      const tiles = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) tiles.push({ tx: tx + dx, ty: ty + dy });
      const cameraX = this.player.x + (this.player.cameraOffset?.x || 0), cameraY = this.player.y + (this.player.cameraOffset?.y || 0);
      const visible = Number.isFinite(worldX) && Number.isFinite(worldY) && Math.abs(x - cameraX) <= CONFIG.VIEW_WIDTH / 2 && Math.abs(y - cameraY) <= CONFIG.VIEW_HEIGHT / 2;
      const mapAllowed = Number.isFinite(worldX) && Number.isFinite(worldY) &&
        Math.hypot(x - this.player.x, y - this.player.y) <= CONFIG.MAP_PORTAL_RANGE * CONFIG.TILE_SIZE &&
        Boolean(this.explored?.has(this.tileKey(tx, ty)));
      return { tx, ty, x, y, tiles, origin: { x: this.player.x, y: this.player.y }, radius: CONFIG.TILE_SIZE * 1.5,
        valid: (fromMap ? mapAllowed : visible) && tiles.some(tile => !this.isGroundBlockedForCreature(tile.tx, tile.ty)) };
    }

    startPortal(fromMap = false, equipped = this.getEquippedSkills().find(skill => skill.item.skill === "portal")) {
      if (!equipped || this.isDead || this.paused || this.sleeping || this.player.portalFrozen ||
        (fromMap ? this.activeGamePanel() !== "map" : !this.canUseWorldInput() || !this.pointerInside)) return false;
      if (this.holyGunRemaining(equipped.stack) > 0) { this.showToast("传送法阵冷却中"); return false; }
      const point = fromMap ? this.mapPortalTarget : this.getPointerWorldPosition(this.pointerClientX, this.pointerClientY);
      if (!point) return false;
      const target = this.portalPlan(point.x, point.y, fromMap);
      if (!target.valid) { this.showToast("此处无法生成虫洞"); return false; }
      if (fromMap) this.closeMap();
      const cast = { id: (this.portalSequence = (this.portalSequence || 0) + 1), age: 0, radius: target.radius,
        ends: [{ x: this.player.x, y: this.player.y }, { x: target.x, y: target.y }], selected: [], captured: false, swapped: false, released: false };
      (this.portalEffects ||= []).push(cast);
      this.useEquippedSkill(equipped, 8);
      this.audio?.playPortalOpen?.();
      return true;
    }

    capturePortalUnits(cast) {
      if (cast.swapped) return;
      cast.captured = true;
      const selected = new Set(cast.selected.map(entry => entry.unit));
      // First-outline entrants share the cast's fixed exchange/release deadlines.
      for (const unit of [this.player, ...this.mobs]) {
        if (unit.health <= 0 || unit.dying || unit.portalFrozen || selected.has(unit)) continue;
        const distances = cast.ends.map(end => Math.hypot(unit.x - end.x, unit.y - end.y));
        let from = distances[0] <= distances[1] ? 0 : 1;
        if (distances[from] > cast.radius) continue;
        const origin = cast.ends[from];
        cast.selected.push({ unit, from, dx: unit.x - origin.x, dy: unit.y - origin.y, teleported: false, released: false });
        cast.released = false;
        unit.portalFrozen = true; unit.portalOwner = cast.id; unit.moving = false;
        if (unit === this.player) { this.cancelMining(); this.clearFoodPress(); }
        else unit.jump = null;
      }
    }

    portalGroundClear(unit, x, y) {
      return unit === this.player ? !this.groundAreaBlocked(x - 4, y + 1, x + 4, y + 8) :
        !this.groundAreaBlocked(x - 5, y - 5, x + 5, y + 6);
    }

    portalLanding(unit, desired, end, reserved) {
      const free = (x, y) => this.portalGroundClear(unit, x, y) &&
        !reserved.some(other => Math.hypot(other.x - x, other.y - y) < 10);
      // Preserve even very close original formations; only fixtures may displace an exact offset.
      if (this.portalGroundClear(unit, desired.x, desired.y)) return desired;
      const cx = Math.floor(end.x / CONFIG.TILE_SIZE), cy = Math.floor(end.y / CONFIG.TILE_SIZE);
      // The destination's nine cells and their immediate neighbours come first.
      // If construction changed during preparation, search further without walking through walls.
      for (let radius = 2; radius <= 16; radius++) {
        const candidates = [];
        for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
          if (radius > 2 && Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const x = (cx + dx + 0.5) * CONFIG.TILE_SIZE, y = (cy + dy + 0.5) * CONFIG.TILE_SIZE;
          candidates.push({ x, y, distance: Math.hypot(x - desired.x, y - desired.y) });
        }
        candidates.sort((a, b) => a.distance - b.distance);
        const candidate = candidates.find(p => free(p.x, p.y));
        if (candidate) return candidate;
      }
      return null;
    }

    swapPortalUnits(cast, entries = cast.selected.filter(entry => !entry.teleported)) {
      cast.swapped = true;
      this.audio?.playPortalSwap?.();
      for (const entry of entries) entry.teleported = true;
      const reserved = [];
      // Resolve both directions from the same snapshot before moving anybody.
      const moves = entries.filter(({ unit }) => unit.health > 0 && !unit.dying && unit.portalOwner === cast.id).map(entry => {
        const end = cast.ends[1 - entry.from];
        const landing = this.portalLanding(entry.unit, { x: end.x + entry.dx, y: end.y + entry.dy }, end, reserved);
        if (landing) reserved.push(landing);
        return { ...entry, landing };
      });
      for (const { unit, landing } of moves) {
        if (!landing) continue;
        const oldX = unit.x, oldY = unit.y;
        unit.x = landing.x; unit.y = landing.y;
        if (unit === this.player) {
          const cameraX = oldX + (unit.cameraOffset?.x || 0) - unit.x;
          const cameraY = oldY + (unit.cameraOffset?.y || 0) - unit.y;
          const duration = Math.min(Wilds.PORTAL_TIMING.CAMERA_RETURN_MAX, Math.max(Wilds.PORTAL_TIMING.CAMERA_RETURN,
            Math.hypot(cameraX, cameraY) / CONFIG.VIEW_WIDTH * Wilds.PORTAL_TIMING.CAMERA_RETURN));
          unit.cameraOffset = { x: cameraX, y: cameraY, startX: cameraX, startY: cameraY, age: 0, duration, returning: true };
          this.lastPlayerSafe = { ...landing };
          this.lastStepPosition = { ...landing };
          unit.isDiving = unit.waterDepth === 2; unit.isWading = unit.waterDepth === 1;
          this.updateExplored();
        } else {
          unit.lastSafeX = unit.x; unit.lastSafeY = unit.y;
          const tx = Math.floor(unit.x / CONFIG.TILE_SIZE), ty = Math.floor(unit.y / CONFIG.TILE_SIZE);
          const water = this.world.terrainAt(tx, ty) === TERRAIN.OCEAN;
          const deep = water && (this.world.waterDepthAt?.(tx, ty) ?? 2) === 2 && !this.hasWaterSupport(tx, ty);
          unit.deepWaterEscape = !unit.aquatic && deep;
          unit.portalLandEscape = Boolean(unit.aquatic && !deep);
          unit.beached = Boolean(unit.aquatic && !water);
          if (unit.beached) { unit.moving = false; unit.aggro = false; }
        }
      }
    }

    releasePortalUnits(cast, entries = cast.selected) {
      for (const entry of entries) {
        const { unit } = entry;
        entry.released = true;
        if (unit.portalOwner !== cast.id) continue;
        unit.portalFrozen = false; unit.portalOwner = null;
        // Arrival hazards begin only after the invulnerable outline has ended.
        if (unit !== this.player && !unit.dying && unit.health > 0) this.updateMobOxygen(unit, 0);
      }
      cast.released = cast.age >= Wilds.PORTAL_TIMING.RELEASE && cast.selected.every(entry => entry.released);
    }

    capturePortalEntrants() {
      for (const cast of this.portalEffects || []) {
        if (cast.age >= Wilds.PORTAL_TIMING.PREPARE && cast.age < Wilds.PORTAL_TIMING.EXCHANGE) this.capturePortalUnits(cast);
      }
    }

    updatePortalEffects(dt) {
      for (const cast of this.portalEffects || []) {
        cast.age += dt;
        if (!cast.captured && cast.age >= Wilds.PORTAL_TIMING.PREPARE - 1e-9) this.capturePortalUnits(cast);
        else if (cast.age >= Wilds.PORTAL_TIMING.PREPARE && cast.age < Wilds.PORTAL_TIMING.EXCHANGE) this.capturePortalUnits(cast);
        if (!cast.swapped && cast.age >= Wilds.PORTAL_TIMING.EXCHANGE - 1e-9) this.swapPortalUnits(cast);
        if (!cast.released && cast.age >= Wilds.PORTAL_TIMING.RELEASE - 1e-9) this.releasePortalUnits(cast);
      }
      this.portalEffects = (this.portalEffects || []).filter(cast => cast.age < Wilds.PORTAL_TIMING.END - 1e-9);
    }

    updatePortalCamera(dt) {
      const offset = this.player.cameraOffset;
      if (!offset?.returning) return;
      offset.age += dt;
      const t = Math.min(1, offset.age / (offset.duration || Wilds.PORTAL_TIMING.CAMERA_RETURN)), factor = 1 - t * t * (3 - 2 * t);
      offset.x = offset.startX * factor; offset.y = offset.startY * factor;
      if (t >= 1) this.player.cameraOffset = null;
    }

    clearPortalEffects() {
      for (const cast of this.portalEffects || []) this.releasePortalUnits(cast);
      this.portalEffects = [];
      if (this.player) { this.player.portalFrozen = false; this.player.portalOwner = null; this.player.cameraOffset = null; }
    }

    updateMobOxygen(mob, dt) {
      if (mob.portalFrozen || mob.dying || !this.world?.terrainAt) return;
      const tx = Math.floor(mob.x / CONFIG.TILE_SIZE), ty = Math.floor(mob.y / CONFIG.TILE_SIZE);
      const water = this.world.terrainAt(tx, ty) === TERRAIN.OCEAN;
      if (mob.type === "enderman") {
        if (mob.waterDeathRemaining != null) {
          mob.waterDeathRemaining = Math.max(0, mob.waterDeathRemaining - dt);
          if (mob.waterDeathRemaining <= 1e-9) this.beginMobDeath(mob, "water");
          return;
        }
        if (water) {
          mob.health = 1;
          mob.waterDeathRemaining = 1.5;
          return;
        }
      }
      if (mob.deepWaterEscape && this.mobCanOccupy(mob.x, mob.y, { ...mob, deepWaterEscape: false })) mob.deepWaterEscape = false;
      if (mob.portalLandEscape && this.mobCanOccupy(mob.x, mob.y, { ...mob, portalLandEscape: false })) mob.portalLandEscape = false;
      if (mob.aquatic) {
        mob.beached = !water;
        if (mob.beached) {
          mob.moving = false; mob.aggro = false;
          mob.health = Math.max(0, mob.health - dt * 10 * this.mobDamageMultiplier(mob));
          if (mob.health <= 0) this.beginMobDeath(mob, "stranding");
        }
        return; // Aquatic creatures breathe in water and suffocate only on land.
      }
      const deep = water && (this.world.waterDepthAt?.(tx, ty) ?? 2) === 2 && !this.hasWaterSupport(tx, ty);
      mob.oxygen ??= CONFIG.OXYGEN_MAX;
      mob.inDeepWater = deep;
      if (deep) {
        if (mob.oxygen > 0) mob.oxygen = Math.max(0, mob.oxygen - dt * CONFIG.OXYGEN_DRAIN_PER_SECOND);
        else {
          mob.health = Math.max(0, mob.health - dt * CONFIG.DROWN_DAMAGE_PER_SECOND * this.mobDamageMultiplier(mob));
          if (mob.health <= 0) this.beginMobDeath(mob, "drowning");
        }
      } else mob.oxygen = Math.min(CONFIG.OXYGEN_MAX, mob.oxygen + dt * CONFIG.OXYGEN_REGEN_PER_SECOND);
    }

    endermanHovered(mob, point) {
      return !this.isCreative() && this.endermanHitTest(mob, point);
    }

    endermanHitTest(mob, point) {
      if (!point || !this.isMobInView(mob)) return false;
      const x = point.x - Math.round(mob.x), y = point.y - Math.round(mob.y);
      if (!Wilds.ENDERMAN_PARTS.some(([left, top, width, height]) =>
        x >= left && x < left + width && y >= top && y < top + height)) return false;
      // An opaque roof or a tall foreground fixture hides the real model.
      if (this.renderer) {
        const objects = [...this.placedObjects.values()];
        if (this.renderer.mobOccluders(mob, [...objects, ...(this.renderer.naturalFixtures || [])]).some(object => {
          const b = this.renderer.fixtureBounds(object);
          return point.x >= b.left && point.x < b.right && point.y >= b.top && point.y < b.bottom;
        })) return false;
        if (objects.some(object => object.type === "roof" &&
          !this.renderer.transparentRoofTiles?.has(`${object.tx},${object.ty}`) && (() => {
            const b = this.renderer.fixtureBounds(object);
            return point.x >= b.left && point.x < b.right && point.y >= b.top && point.y < b.bottom;
          })())) return false;
      }
      return true;
    }

    provokeEnderman(mob, now = performance.now()) {
      if (this.isCreative()) return;
      if (mob.dying || mob.health <= 0) return;
      mob.provoked = true;
      mob.aggro = !this.isDead && this.isMobInView(mob) && this.canMonsterAggro(mob);
      if (mob.aggro) this.tryEndermanBlink(mob, now);
    }

    endermanBlinkLanding(mob) {
      const tileSize = CONFIG.TILE_SIZE, player = this.player;
      const canLand = (x, y) => Math.hypot(x - player.x, y - player.y) >= 12 &&
        this.mobCanOccupy(x, y, mob) && this.canMonsterAggro({ x, y }) &&
        !this.mobs.some(other => other !== mob && !other.dying && Math.hypot(other.x - x, other.y - y) < 12);
      const [forwardX, forwardY] = ({ up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] })[this.player.facing] || [0, 1];
      const behind = { x: player.x - forwardX * tileSize, y: player.y - forwardY * tileSize };
      if (canLand(behind.x, behind.y)) return behind;

      // Search outward for the nearest legal cell, irrespective of intervening walls.
      // The mob's current legal position provides a finite upper bound and a fallback.
      let best = canLand(mob.x, mob.y) ? { x: mob.x, y: mob.y } : null;
      let bestDistance = best ? Math.hypot(best.x - player.x, best.y - player.y) : Infinity;
      const maxRadius = Math.ceil(Math.hypot(mob.x - player.x, mob.y - player.y) / tileSize) + 1;
      const offset = Math.max(Math.abs(player.x - (player.tileX + 0.5) * tileSize), Math.abs(player.y - (player.tileY + 0.5) * tileSize));
      for (let radius = 1; radius <= maxRadius; radius++) {
        for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx += Math.abs(dy) === radius ? 1 : 2 * radius) {
          const x = (player.tileX + dx + 0.5) * tileSize, y = (player.tileY + dy + 0.5) * tileSize;
          const distance = Math.hypot(x - player.x, y - player.y);
          if (distance < bestDistance && canLand(x, y)) { best = { x, y }; bestDistance = distance; }
        }
        // No cell outside this square can be closer than its nearest outer edge.
        if (bestDistance <= (radius + 0.5) * tileSize - offset) break;
      }
      return best;
    }

    tryEndermanBlink(mob, now) {
      if (!mob.aggro || mob.portalFrozen || this.isDead || mob.blinkCooldown > 0 || mob.blinkRetry > 0 || !this.canMonsterAggro(mob)) return false;
      if (this.world?.terrainAt?.(this.player.tileX, this.player.tileY) === TERRAIN.OCEAN) return false;
      const landing = this.endermanBlinkLanding(mob);
      if (landing) {
        mob.blinkFromX = mob.x; mob.blinkFromY = mob.y; mob.blinkFlash = 0.4;
        mob.x = mob.lastSafeX = landing.x; mob.y = mob.lastSafeY = landing.y;
        mob.blinkCooldown = 8;
        mob.attackAt = now + 1000;
        this.audio?.playEndermanBlink?.();
        // Teleportation ignores the route; the follow-up melee still needs range and a clear hit.
        if (Math.hypot(mob.x - this.player.x, mob.y - this.player.y) <= 1.5 * CONFIG.TILE_SIZE &&
          this.creaturePathClear(mob.x, mob.y, this.player.x, this.player.y, (x, y) => this.mobCanOccupy(x, y, mob))) this.damagePlayer(30, mob);
        return true;
      }
      // Only a world with no legal landing at all needs a delayed retry.
      mob.blinkRetry = 0.25;
      return false;
    }

    updateMobs(dt, now) {
      const player = this.player;
      const playerX = player.x;
      const playerY = player.y;
      const daylight = this.clock.hours >= 6 && this.clock.hours < 18;

      // Cleanup precedes damage/death animation so distant units cannot linger.
      for (let i = this.mobs.length - 1; i >= 0; i--) {
        if (!this.isWithinMobRange(this.mobs[i].x, this.mobs[i].y)) this.mobs.splice(i, 1);
      }
      if (daylight) {
        this.applyDaylightDamage(dt);
      }
      const gazeEnabled = this.pointerInside && this.canUseWorldInput();
      const gaze = gazeEnabled ? this.getPointerWorldPosition(this.pointerClientX, this.pointerClientY) : null;

      for (let i = this.mobs.length - 1; i >= 0; i -= 1) {
        const mob = this.mobs[i];
        if (mob.dying) {
          if (now - mob.deathStartedAt >= mob.deathDuration) {
            this.finishMobDeath(mob);
          }
          continue;
        }
        const dx = playerX - mob.x;
        const dy = playerY - mob.y;
        const distance = Math.hypot(dx, dy);

        // Living pigs produce one dropping every 12–24 game hours (~1–2/day).
        if (mob.type === "pig") {
          mob.manureHoursRemaining -= dt * Wilds.TIME_SCALE / 3600;
          while (mob.manureHoursRemaining <= 0) {
            this.spawnDrop("animal_manure", 1, Math.floor(mob.x / CONFIG.TILE_SIZE), Math.floor(mob.y / CONFIG.TILE_SIZE));
            mob.manureHoursRemaining += 12 + Math.random() * 12;
          }
        }
        mob.jumpCooldown = Math.max(0, mob.jumpCooldown - dt);
        mob.cullingCooldown=Math.max(0,(mob.cullingCooldown||0)-dt);
        mob.blinkCooldown = Math.max(0, (mob.blinkCooldown || 0) - dt);
        mob.blinkRetry = Math.max(0, (mob.blinkRetry || 0) - dt);
        mob.blinkFlash = Math.max(0, (mob.blinkFlash || 0) - dt);
        this.updateMobOxygen(mob, dt);
        if (mob.dying || mob.portalFrozen || mob.beached) continue;
        const inView = this.isMobInView(mob);

        if (mob.aquatic) {
          mob.aggro = mob.type === "shark" && mob.provoked && inView && this.canMonsterAggro(mob);
          if(mob.aggro) {
            if(distance>CONFIG.TILE_SIZE*1.15)this.moveMob(mob,dx,dy,dt);
            else if(now>=mob.attackAt){mob.attackAt=now+1000;this.damagePlayer(25,mob);}
          } else if(now<mob.fleeUntil)this.moveMob(mob,-dx,-dy,dt);
          else this.wanderMob(mob,now,dt);
        } else if (mob.monster) {
          if (mob.type === "enderman" && !mob.provoked && this.endermanHovered(mob, gaze)) mob.provoked = true;
          mob.aggro = !this.isDead && inView && this.canMonsterAggro(mob) && (mob.type !== "enderman" || mob.provoked);

          if (mob.type === "spider" && mob.jump) {
            this.updateSpiderJump(mob, dt);
            continue;
          }
          if (mob.aggro) {
            const tileDistance = distance / CONFIG.TILE_SIZE;
            if (mob.type === "enderman" && this.tryEndermanBlink(mob, now)) {
              continue;
            } else if (mob.type === "spider" && this.trySpiderJump(mob)) {
              this.updateSpiderJump(mob, dt);
            } else if (mob.type === "dark_lucian") {
              const firing=Boolean(mob.culling) || mob.cullingCooldown<=0;
              this.updateCulling(mob,dt);
              if(firing && tileDistance>1.15)this.moveMob(mob,dx,dy,dt);
            } else if (MOB_TYPES[mob.type]?.attack === "melee") {
              if (tileDistance > 1.15 || (mob.type === "enderman" &&
                this.world?.terrainAt?.(player.tileX, player.tileY) === TERRAIN.OCEAN)) {
                this.moveMob(mob, dx, dy, dt);
              } else if (now >= mob.attackAt && (mob.type !== "enderman" ||
                this.creaturePathClear(mob.x, mob.y, playerX, playerY, (x, y) => this.mobCanOccupy(x, y, mob)))) {
                mob.attackAt = now + 1000;
                this.damagePlayer(MOB_TYPES[mob.type]?.damage || 15, mob);
              }
            } else if (MOB_TYPES[mob.type]?.attack === "ranged") {
              if (tileDistance > 5.5) {
                this.moveMob(mob, dx, dy, dt);
              } else if (tileDistance > 1.4 && now >= mob.attackAt) {
                mob.attackAt = now + 1600;
                this.spawnProjectile("enemy_arrow", "monster", mob.x, mob.y, playerX, playerY, MOB_TYPES[mob.type]?.damage || 25, 220, 7 * CONFIG.TILE_SIZE, mob.id);
              }
            }
          } else {
            if(mob.culling)this.updateCulling(mob,dt);
            if(mob.firstNightHunter && this.canMonsterAggro(mob) && !mob.culling && mob.cullingCooldown<=0)this.moveMob(mob,dx,dy,dt);
            else if(mob.type!=="dark_lucian")this.wanderMob(mob, now, dt);
          }
        } else {
          if (now < mob.fleeUntil) {
            this.moveMob(mob, -dx, -dy, dt);
          } else {
            this.wanderMob(mob, now, dt);
          }
        }
      }

      this.updateSpawner(dt);
    }

    updateCulling(mob,dt) {
      if(!mob.culling && mob.cullingCooldown<=0) {
        // Stratified random timing keeps continuous rain without synchronized rows.
        const times=this.cullingTimes();
        mob.culling={age:0,index:0,times};mob.cullingCooldown=20;
      }
      const cast=mob.culling;if(!cast)return;
      cast.age+=dt;
      while(cast.index<cast.times.length && cast.times[cast.index]<=cast.age+1e-9) {
        cast.index++;
        // Follow the player's current direction; each bullet keeps its own trajectory.
        const dx=this.player.x-mob.x,dy=this.player.y-mob.y,len=Math.hypot(dx,dy)||1;
        const ux=dx/len,uy=dy/len,offset=(Math.random()-.5)*CONFIG.TILE_SIZE*.5;
        const x=mob.x-uy*offset,y=mob.y+ux*offset;
        this.spawnProjectile("culling_bullet","monster",x,y,x+ux*100,y+uy*100,10,(170+Math.random()*20)*1.5,12*CONFIG.TILE_SIZE,mob.id);
        this.projectiles[this.projectiles.length-1].skill="culling";
      }
      if(cast.index>=cast.times.length)mob.culling=null;
    }

    cullingTimes() {
      return Array.from({length:200},(_,i)=>i===0?0:i===199?7:(i+(Math.random()-.5)*.8)*7/199);
    }

    holyGunRemaining(stack) {
      if (!stack || this.isCreative()) return 0;
      const shared = this.skillReadyAtByItem?.get(stack.itemId);
      const deadline = shared && this.inventory.equipment.includes(stack)
        ? Math.max(shared, stack.skillReadyAt || 0) : stack.skillReadyAt || 0;
      return Math.max(0, deadline - (this.holyGunTime || 0));
    }

    useEquippedSkill(equipped, cooldown) {
      this.cancelMining();
      if (this.isCreative()) return;
      if (cooldown !== null) this.setSkillCooldown(equipped.item.id, cooldown);
      this.consumeToolDurability({ area: equipped.area, index: equipped.index, itemId: equipped.item.id });
    }

    setSkillCooldown(itemId, cooldown) {
      const readyAt = (this.holyGunTime || 0) + cooldown;
      (this.skillReadyAtByItem ||= new Map()).set(itemId, readyAt);
      for (const stack of this.inventory.equipment) {
        if (stack?.itemId === itemId) stack.skillReadyAt = readyAt;
      }
    }

    startHolyGun(equipped = this.getEquippedSkills().find(skill => skill.item.skill === "culling")) {
      if (!equipped || this.player.portalFrozen || !this.canUseWorldInput()) return false;
      if(this.holyGunRemaining(equipped.stack)>0){this.showToast("圣枪洗礼冷却中");return false;}
      if(!this.pointerInside){this.showToast("将鼠标移到游戏画面内瞄准");return false;}
      (this.holyGunCasts ||= []).push({age:0,index:0,times:this.cullingTimes()});
      this.useEquippedSkill(equipped, 20);
      this.updateHolyGun(0);return true;
    }

    updateHolyGun(dt) {
      const before=this.inventory.equipment.map(s=>Math.ceil(this.holyGunRemaining(s)));
      this.holyGunTime=(this.holyGunTime||0)+dt;
      if(before.some((value,i)=>value!==Math.ceil(this.holyGunRemaining(this.inventory.equipment[i]))))this.renderInventory();
      if(!this.holyGunCasts?.length)return;
      const target=this.getPointerWorldPosition(this.pointerClientX,this.pointerClientY);
      for(const cast of this.holyGunCasts) {
        cast.age+=dt;
        if(!target)continue;
        while(cast.index<200 && cast.times[cast.index]<=cast.age+1e-9) {
          cast.index++;
          const dx=target.x-this.player.x,dy=target.y-this.player.y,len=Math.hypot(dx,dy)||1;
          const ux=dx/len,uy=dy/len,offset=(Math.random()-.5)*CONFIG.TILE_SIZE*.5;
          const x=this.player.x-uy*offset,y=this.player.y+ux*offset;
          this.spawnProjectile("culling_bullet","player",x,y,x+ux*100,y+uy*100,10,(170+Math.random()*20)*1.5,12*CONFIG.TILE_SIZE);
        }
      }
      this.holyGunCasts=this.holyGunCasts.filter(c=>c.index<200);
    }

    spawnFirstNightLucian(force=false) {
      if (this.isCreative()) return false;
      const firstNight=(this.clock.day===1 && this.clock.hours>=20)||(this.clock.day===2 && this.clock.hours<6);
      if(this.firstNightLucianSpawned || !firstNight || (!force && this.clock.day===1 && this.clock.hours<this.firstNightLucianHour))return false;
      if(!force && (this.elapsed||0)<(this.nextFirstNightLucianAttempt||0))return false;
      this.nextFirstNightLucianAttempt=(this.elapsed||0)+.5;
      // Reserve one encounter, but never bypass visibility, light or geometry.
      for(const radius of [13,14,15,16])for(let n=0;n<64;n++) {
        const angle=n*Math.PI/32,tx=this.player.tileX+Math.round(Math.cos(angle)*radius),ty=this.player.tileY+Math.round(Math.sin(angle)*radius);
        const x=(tx+.5)*CONFIG.TILE_SIZE,y=(ty+.5)*CONFIG.TILE_SIZE;
        if(this.isMobInView({x,y}) || this.isPositionLitBySource(x,y) || !this.monsterSpawnAllowed(tx,ty))continue;
        if(Math.hypot(x-this.player.x,y-this.player.y)<CONFIG.TILE_SIZE*1.2 || this.world.waterDepthAt(tx,ty)!==0 || !this.mobCanOccupy(x,y))continue;
        if(this.mobs.some(m=>!m.dying&&Math.hypot(m.x-x,m.y-y)<CONFIG.TILE_SIZE))continue;
        if(!this.canMonsterAggro({x,y}) || !this.creaturePathClear(this.player.x,this.player.y,x,y,(px,py)=>this.mobCanOccupy(px,py)))continue;
        const mob=this.spawnNaturalMonster("dark_lucian",tx,ty);if(!mob)continue;
        this.firstNightLucianSpawned=true;mob.firstNightHunter=true;mob.cullingCooldown=0;
        return true;
      }
      return false;
    }

    wanderMob(mob, now, dt) {
      if (now >= mob.nextDecisionAt) {
        mob.nextDecisionAt = now + 900 + Math.random() * 1800;
        const angle = Math.random() * Math.PI * 2;
        mob.dirX = Math.cos(angle);
        mob.dirY = Math.sin(angle);
      }
      if (Math.abs(mob.dirX) + Math.abs(mob.dirY) > 0.05) {
        this.moveMob(mob, mob.dirX, mob.dirY, dt);
      }
    }

    beginMobDeath(mob, source = "player") {
      if (!mob || mob.dying || mob.portalFrozen) return;
      mob.dying = true;
      mob.deathSource = source;
      mob.health = 0;
      mob.deathStartedAt = performance.now();
      mob.aggro = false;
      mob.jump = null;
      mob.moving = false;
      mob.fleeUntil = 0;
    }

    finishMobDeath(mob) {
      const definition = MOB_TYPES[mob.type];
      const tx = Math.floor(mob.x / CONFIG.TILE_SIZE);
      const ty = Math.floor(mob.y / CONFIG.TILE_SIZE);
      if (definition && mob.deathSource !== "sun") {
        const copies = mob.deathSource === "smite" ? 2 : 1;
        for (let copy = 0; copy < copies; copy++) {
          for (const [itemId, count] of definition.drops) {
            this.spawnDrop(itemId, count, tx, ty);
          }
        }
      }
      const index = this.mobs.indexOf(mob);
      if (index >= 0) this.mobs.splice(index, 1);
    }

    mobDamageMultiplier(mob) {
      return this.summoner?.damageMultiplier(mob) ?? 1;
    }

    damageMob(mob, amount, source = "player") {
      if (!mob || mob.dying || mob.portalFrozen) return;
      mob.health = Math.max(0, mob.health - amount * this.mobDamageMultiplier(mob));
      mob.hitFlashUntil = performance.now() + 160;
      if (this.audio) {
        if (mob.monster) this.audio.playMonsterHurt();
        else this.audio.playAnimalHurt();
      }
      if (this.isCreative()) { mob.provoked = false; mob.aggro = false; mob.fleeUntil = 0; }
      else if(mob.type === "shark") {mob.provoked=true;mob.aggro=this.canMonsterAggro(mob);}
      else if (mob.type === "enderman") {
        // Friendly fire can hurt this mob, but only the player provokes it.
        if (source === "player" || source === "smite") this.provokeEnderman(mob);
      } else if (mob.monster) {
        mob.aggro = this.canMonsterAggro(mob);
      } else {
        const dx = mob.x - this.player.x;
        const dy = mob.y - this.player.y;
        mob.dirX = dx;
        mob.dirY = dy;
        mob.fleeUntil = performance.now() + 2600;
      }
      if (mob.health <= 0) {
        this.beginMobDeath(mob, source);
      }
    }

    damagePlayer(amount, attacker = null) {
      if (this.isDead || this.player.portalFrozen) return;
      const interrupted = this.summoner?.finishTeleport(false);
      if (this.isCreative() || this.player.summonerShielded) return;
      this.player.takeDamage(amount, { type: attacker ? "monster" : "unknown", name: attacker?.name, monsterType: attacker?.type, skill:attacker?.skill });
      if (this.audio) this.audio.playPlayerHurt();
      if (!interrupted) this.showToast("受到 " + amount + " 点伤害");
    }

    /**
     * Spawn a projectile with a velocity and range. `sourceMobId` lets a
     * monster arrow ignore the archer that fired it while still hitting any
     * other creature.
     */
    spawnProjectile(type, owner, x, y, targetX, targetY, damage, speed, range, sourceMobId = null) {
      const dx = targetX - x;
      const dy = targetY - y;
      const length = Math.hypot(dx, dy) || 1;
      this.projectiles.push({
        id: ++this.mobSequence,
        type,
        owner,
        sourceMobId,
        sourceName: this.mobs.find(mob => mob.id === sourceMobId)?.name || (owner === "monster" ? "未知怪物" : null),
        x,
        y,
        vx: (dx / length) * speed,
        vy: (dy / length) * speed,
        damage,
        range,
        traveled: 0,
      });
      if(type==="culling_bullet") {
        const distance=Math.hypot(x-this.player.x,y-this.player.y);
        const volume=Math.max(0,1-distance/(CONFIG.TILE_SIZE*18));
        this.audio?.playHolyGunShot?.(volume);
      }
    }

    isProjectileBlocked(tx, ty) {
      return this.isGroundBlockedForCreature(tx, ty);
    }

    projectilePathBlocked(x1, y1, x2, y2) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const distance = Math.hypot(dx, dy);
      const steps = Math.max(1, Math.ceil(distance / 1));
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        const tx = Math.floor((x1 + dx * t) / CONFIG.TILE_SIZE);
        const ty = Math.floor((y1 + dy * t) / CONFIG.TILE_SIZE);
        const x = x1 + dx * t, y = y1 + dy * t;
        if (this.groundAreaBlocked(x - 0.5, y - 0.5, x + 0.5, y + 0.5)) return true;
      }
      return false;
    }

    segmentHitsCircle(x1, y1, x2, y2, cx, cy, radius) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const lengthSquared = dx * dx + dy * dy;
      const t = lengthSquared > 0
        ? Math.max(0, Math.min(1, ((cx - x1) * dx + (cy - y1) * dy) / lengthSquared))
        : 0;
      const closestX = x1 + dx * t;
      const closestY = y1 + dy * t;
      return Math.hypot(closestX - cx, closestY - cy) <= radius;
    }

    /**
     * Advance all projectiles. Uses swept sampling of the whole segment so a
     * very fast projectile cannot skip over a blocking tile in one frame.
     */
    updateProjectiles(dt) {
      for (let i = this.projectiles.length - 1; i >= 0; i -= 1) {
        const projectile = this.projectiles[i];
        const oldX = projectile.x;
        const oldY = projectile.y;
        // Stop at the exact range boundary, including on a long frame.
        const speed=Math.hypot(projectile.vx,projectile.vy);
        const travelTime=speed>0?Math.min(dt,Math.max(0,projectile.range-projectile.traveled)/speed):dt;
        const stepX = projectile.vx * travelTime;
        const stepY = projectile.vy * travelTime;
        const nextX = oldX + stepX;
        const nextY = oldY + stepY;
        projectile.traveled += Math.hypot(stepX, stepY);

        // Swept collision: even a very fast projectile cannot tunnel through
        // a fixed ground object within one frame.
        if (this.projectilePathBlocked(oldX, oldY, nextX, nextY)) {
          this.projectiles.splice(i, 1);
          continue;
        }

        let removed = false;
        if (projectile.owner === "player") {
          for (const mob of this.mobs) {
            if(mob.dying || mob.health<=0 || mob.portalFrozen)continue;
            if (this.segmentHitsCircle(oldX, oldY, nextX, nextY, mob.x, mob.y, 11)) {
              this.damageMob(mob, projectile.damage);
              this.projectiles.splice(i, 1);
              removed = true;
              break;
            }
          }
        } else {
          // Monster arrows hurt animals and other monsters too, but never
          // the archer that fired them.
          for (const mob of this.mobs) {
            if (mob.dying || mob.health<=0 || mob.portalFrozen || mob.id === projectile.sourceMobId) continue;
            if (this.segmentHitsCircle(oldX, oldY, nextX, nextY, mob.x, mob.y, 11)) {
              this.damageMob(mob, projectile.damage, "monster");
              this.projectiles.splice(i, 1);
              removed = true;
              break;
            }
          }
          if (
            !removed &&
            !this.isCreative() && !this.isDead && !this.player.portalFrozen && this.player.health>0 &&
            this.segmentHitsCircle(oldX, oldY, nextX, nextY, this.player.x, this.player.y, 10)
          ) {
            this.damagePlayer(projectile.damage, { name: projectile.sourceName || "未知怪物",skill:projectile.skill });
            this.projectiles.splice(i, 1);
            removed = true;
          }
        }

        if (removed) continue;
        projectile.x = nextX;
        projectile.y = nextY;

        if (projectile.traveled >= projectile.range) {
          this.projectiles.splice(i, 1);
        }
      }
    }

    selectCreationScroll() {
      const slots = this.inventory.getSlots("equipment");
      const index = slots.findIndex((stack) => stack && stack.itemId === "creation_scroll");
      if (index < 0) return;
      this.selectedSlot = { area: "equipment", index };
      this.renderSelection();
      this.syncHeldStats();
    }

    canAddToBackpack(itemId, amount) {
      const max = this.inventory.maxStackFor(itemId);
      let room = 0;
      for (const area of ["equipment", "backpack"]) {
        for (const stack of this.inventory.getSlots(area)) {
          if (!stack) room += max;
          else if (stack.itemId === itemId) room += Math.max(0, max - stack.count);
          if (room >= amount) return true;
        }
      }
      return room >= amount;
    }

    addToBackpack(itemId, amount) {
      return this.inventory.addItem(itemId, amount) >= amount;
    }

    // The creation scroll converts 3 wood into a workbench. It is the only
    // way to get a workbench at game start; equipment priority puts it in a
    // free equipment slot first.
    useCreationScroll() {
      if (this.inventory.countItem("wood") < 3) {
        this.showToast("需要三个木材");
        return;
      }
      if (!this.canAddToBackpack("workbench", 1)) {
        this.showToast("背包空间不足");
        return;
      }
      this.inventory.removeItem("wood", 3);
      this.addToBackpack("workbench", 1);
      this.showToast("获得工具箱");
      this.renderInventory();
      this.syncHeldStats();
    }

    findMobAtPointer(worldX, worldY) {
      return this.mobs.find((mob) =>
        !mob.dying &&
        (mob.type === "enderman" ? this.endermanHitTest(mob, { x: worldX, y: worldY }) :
          Math.hypot(mob.x - worldX, mob.y - worldY) < 14) &&
        Math.hypot(mob.x - this.player.x, mob.y - this.player.y) <= 2.6 * CONFIG.TILE_SIZE
      ) || null;
    }

    syncHud(force) {
      const tileX = this.player.tileX;
      const tileY = this.player.tileY;
      const terrain = this.world.terrainAt(tileX, tileY);

      if (force || tileX !== this.lastTileX || tileY !== this.lastTileY) {
        this.coordReadout.textContent = "X " + formatCoordinate(tileX) + " · Y " + formatCoordinate(tileY);
        this.lastTileX = tileX;
        this.lastTileY = tileY;
      }

      if (force || terrain !== this.lastTerrain) {
        const meta = TERRAIN_META[terrain];
        this.terrainChip.dataset.terrain = meta.key;
        this.terrainName.textContent = meta.name;
        this.lastTerrain = terrain;
      }

      this.syncVitals(force);
      this.syncClock(force);
    }

    syncClock(force) {
      const clock = this.clock;
      const timeText = clock.formatTime();
      const dayText = "第 " + clock.day + " 天";
      const phase = clock.phase;

      if (force || timeText !== this.lastClockText) {
        this.gameClock.textContent = timeText;
        this.lastClockText = timeText;
      }

      if (force || dayText !== this.lastClockDay) {
        this.dayCount.textContent = dayText;
        this.lastClockDay = dayText;
      }

      if (force || phase.key !== this.lastClockPhase) {
        this.phaseLabel.textContent = phase.label;
        this.gameClockBox.dataset.phase = phase.key;
        this.lastClockPhase = phase.key;
      }

      this.gameClockBox.setAttribute(
        "aria-label",
        "游戏时间：" + dayText + " " + timeText + "，" + phase.label
      );
    }

    syncVitals(force) {
      const player = this.player;
      this.vitalsPanel.hidden = this.isCreative();
      const health = Math.max(0, Math.min(player.maxHealth, player.health));
      const oxygen = Math.max(0, Math.min(player.maxOxygen, player.oxygen));
      const satiety = Math.max(0, Math.min(player.maxSatiety, player.satiety));
      const healthPercent = (health / player.maxHealth) * 100;
      const oxygenPercent = (oxygen / player.maxOxygen) * 100;
      const satietyPercent = (satiety / player.maxSatiety) * 100;

      this.healthFill.style.width = healthPercent.toFixed(2) + "%";
      this.oxygenFill.style.width = oxygenPercent.toFixed(2) + "%";
      this.satietyFill.style.width = satietyPercent.toFixed(2) + "%";
      this.healthTrack.setAttribute("aria-valuenow", String(Math.round(health)));
      this.oxygenTrack.setAttribute("aria-valuenow", oxygen.toFixed(1));
      this.satietyTrack.setAttribute("aria-valuenow", String(Math.round(satiety)));

      const healthText = Math.round(health) + " / " + player.maxHealth;
      const oxygenText = oxygen.toFixed(1) + " / " + player.maxOxygen;
      const satietyText = Math.round(satiety) + " / " + player.maxSatiety;

      if (force || healthText !== this.lastHealthText) {
        this.healthValue.textContent = healthText;
        this.lastHealthText = healthText;
      }

      if (force || oxygenText !== this.lastOxygenText) {
        this.oxygenValue.textContent = oxygenText;
        this.lastOxygenText = oxygenText;
      }

      if (force || satietyText !== this.lastSatietyText) {
        this.satietyValue.textContent = satietyText;
        this.lastSatietyText = satietyText;
      }

      if(this.foodRestriction) {
        this.foodRestriction.hidden=this.isCreative() || !(player.manureDietHours>0);
        this.foodRestriction.textContent="异食：仅可食粪便（剩余"+Math.ceil(player.manureDietHours||0)+"小时）";
      }
      const diving = Boolean(player.isDiving);

      if (force || diving !== this.lastDiving || player.isWading !== this.lastWading) {
        this.viewport.classList.toggle("is-diving", diving);
        this.statePill.dataset.state = diving ? "diving" : "land";
        this.stateLabel.textContent = diving ? "深水潜行" : player.isWading ? "浅水涉水" : "陆地";
        this.lastWading = player.isWading;
        this.lastDiving = diving;
      }

      const lowOxygen = diving && oxygen > 0 && oxygen <= 3;
      const drowning = diving && oxygen <= 0;

      this.vitalsPanel.classList.toggle("is-low-oxygen", lowOxygen);
      this.vitalsPanel.classList.toggle("is-drowning", drowning);
    }
  }

  function boot() {
    const canvas = document.getElementById("game");
    if (!canvas || typeof canvas.getContext !== "function" || !canvas.getContext("2d")) {
      const message = document.createElement("p");
      message.textContent = "这个浏览器无法创建 Canvas 2D 画面。";
      message.style.cssText = "padding:16px;color:#ece8d9;font-size:14px;";
      document.body.appendChild(message);
      return;
    }

    new Game();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
