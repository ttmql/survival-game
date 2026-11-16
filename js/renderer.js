/* =========================================================
   Canvas renderer.

   The world uses 480 × 300 logical coordinates (24 × 15 tiles).
   Terrain renders at native resolution. Only holy-gun bullets use a 3× layer.
   ========================================================= */

(function () {
  "use strict";

  const { CONFIG, TERRAIN, FEATURE } = Wilds;
  const { hash2, noise2 } = Wilds.World;

  const TILE = CONFIG.TILE_SIZE;
  const VIEW_W = CONFIG.VIEW_WIDTH;
  const VIEW_H = CONFIG.VIEW_HEIGHT;
  const CENTER_X = VIEW_W / 2;
  const CENTER_Y = VIEW_H / 2;
  const TORCH_LIGHT_RADIUS = VIEW_W * 0.25;
  const TORCH_CORE_RADIUS = TILE * 2.2;

  // Six-step, low-contrast palettes. A slow noise field chooses a shade
  // per tile, so light and shadow drift organically across the ground
  // instead of producing a one-tile checkerboard.
  const GRASS_BASES = ["#52763c", "#567a40", "#5a7e43", "#5e8246", "#628649", "#668a4c"];
  const ROCK_BASES = ["#55564e", "#5a5b52", "#5f6057", "#64645b", "#69685e", "#6e6c61", "#747263"];
  const OCEAN_BASES = ["#245a65", "#28606a", "#2b656f", "#2e6a73", "#326e77", "#35737b"];

  const PLAYER = Object.freeze({
    outline: "#283128",
    shadow: "rgba(7, 16, 11, 0.34)",
    skin: "#e2b58a",
    skinShade: "#c79466",
    hair: "#4b3425",
    hat: "#d8b774",
    hatLight: "#efd796",
    hatShade: "#9b7a4a",
    hatBand: "#6f5533",
    cloak: "#3f7464",
    cloakLight: "#5a9683",
    cloakShade: "#2e584b",
    scarf: "#cb704c",
    pants: "#40382d",
    boot: "#5d4531",
    pack: "#86633f",
    packShade: "#61462d",
  });

  const TREE = Object.freeze({
    outline: "#203626",
    dark: "#355a34",
    mid: "#4a7641",
    light: "#67914f",
    highlight: "#83a960",
    trunk: "#5d4631",
    trunkDark: "#3b2b1f",
    trunkLight: "#7b5c3e",
    shadow: "rgba(13, 31, 17, 0.3)",
  });

  const COAL = Object.freeze({
    outline: "#0f1315",
    dark: "#1b2022",
    mid: "#2b3335",
    light: "#515b5b",
    glint: "#909892",
    scuff: "rgba(24, 28, 27, 0.42)",
  });

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.renderScale=1;
      canvas.width=VIEW_W*this.renderScale;
      canvas.height=VIEW_H*this.renderScale;
      this.ctx = canvas.getContext("2d", { alpha: false });
      this.ctx.setTransform(this.renderScale,0,0,this.renderScale,0,0);
      this.ctx.imageSmoothingEnabled = false;
      this.world = null;
      this.typeScratch = new Uint8Array(0);
      this.featureScratch = new Uint8Array(0);
      this.dugScratch = new Uint8Array(0);
      this.reduceMotion = false;
      this.blgImage = new Image();
      this.blgImage.src = "assets/blg-commemorative.png";

      this.lightCanvas = document.createElement("canvas");
      this.lightCanvas.width = VIEW_W;
      this.lightCanvas.height = VIEW_H;
      this.lightCtx = this.lightCanvas.getContext("2d");
      this.lightCtx.imageSmoothingEnabled = false;

      if (window.matchMedia) {
        const query = window.matchMedia("(prefers-reduced-motion: reduce)");
        this.reduceMotion = query.matches;
        if (typeof query.addEventListener === "function") {
          query.addEventListener("change", (event) => {
            this.reduceMotion = event.matches;
          });
        }
      }
    }

    setWorld(world) {
      this.world = world;
    }

    render(player, time, lighting, drops, target, placedObjects, mobs, projectiles, roomIndex = null, giftEffects = [], farm = new Map(), waterEffects = []) {
      if (!this.world) return;

      const ctx = this.ctx;
      const world = this.world;
      const seed = world.seed;
      this.roomIndex = roomIndex;
      this.viewerRoom = roomIndex?.at(player.tileX, player.tileY) || null;
      this.buildingTiles = new Map();
      for (const object of placedObjects || []) {
        for (const tile of object.tiles || [object]) {
          const key = `${tile.tx},${tile.ty}`;
          if (!this.buildingTiles.has(key)) this.buildingTiles.set(key, []);
          this.buildingTiles.get(key).push(object);
        }
      }
      this.transparentRoofTiles = Wilds.Buildings.transparentRoofs(placedObjects || [], player.tileX, player.tileY);
      const camX = player.x - CENTER_X;
      const camY = player.y - CENTER_Y;

      // These fields make the centre-lock invariant observable in the
      // browser without changing how the frame is drawn.
      this.playerScreenX = CENTER_X;
      this.playerScreenY = CENTER_Y;
      this.cameraX = camX;
      this.cameraY = camY;

      // One extra row/column on either side keeps partially visible
      // tiles (and their shoreline neighbours) present while moving.
      const firstX = Math.floor(camX / TILE) - 1;
      const firstY = Math.floor(camY / TILE) - 1;
      const lastX = Math.floor((camX + VIEW_W) / TILE) + 1;
      const lastY = Math.floor((camY + VIEW_H) / TILE) + 1;
      const cols = lastX - firstX + 1;
      const rows = lastY - firstY + 1;
      const cellCount = cols * rows;

      if (this.typeScratch.length < cellCount) {
        this.typeScratch = new Uint8Array(cellCount);
      }

      if (this.featureScratch.length < cellCount) {
        this.featureScratch = new Uint8Array(cellCount);
      }

      if (this.dugScratch.length < cellCount) {
        this.dugScratch = new Uint8Array(cellCount);
      }

      const types = this.typeScratch;
      const features = this.featureScratch;
      const dugTiles = this.dugScratch;

      for (let row = 0; row < rows; row += 1) {
        const tileY = firstY + row;
        const rowStart = row * cols;
        for (let col = 0; col < cols; col += 1) {
          const tileX = firstX + col;
          const index = rowStart + col;
          types[index] = world.terrainAt(tileX, tileY);
          features[index] = world.featureAt(tileX, tileY);
          dugTiles[index] = world.isDug(tileX, tileY) ? 1 : 0;
        }
      }

      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#12231c";
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);

      const displayTime = this.reduceMotion ? 0 : time;

      for (let row = 0; row < rows; row += 1) {
        const tileY = firstY + row;
        const sy = Math.round(tileY * TILE - camY);
        const rowStart = row * cols;

        for (let col = 0; col < cols; col += 1) {
          const tileX = firstX + col;
          const sx = Math.round(tileX * TILE - camX);
          const type = types[rowStart + col];
          const feature = features[rowStart + col];
          const dug = dugTiles[rowStart + col] === 1;

          if (sx > VIEW_W || sy > VIEW_H || sx + TILE < 0 || sy + TILE < 0) {
            continue;
          }

          this.drawTile(
            type,
            feature,
            dug,
            tileX,
            tileY,
            sx,
            sy,
            seed,
            displayTime,
            col,
            row,
            cols,
            rows,
            types
          );
        }
      }

      this.drawFarming(farm,camX,camY);
      // Features are a second pass so canopies can overlap the terrain
      // around them. Terrain itself is never removed.
      for (let row = 0; row < rows; row += 1) {
        const tileY = firstY + row;
        const sy = Math.round(tileY * TILE - camY);
        const rowStart = row * cols;

        for (let col = 0; col < cols; col += 1) {
          const feature = features[rowStart + col];
          if (feature === FEATURE.NONE) continue;

          const tileX = firstX + col;
          const sx = Math.round(tileX * TILE - camX);

          if (feature === FEATURE.TREE) {
            this.drawTree(tileX, tileY, sx, sy, seed);
          } else if (feature === FEATURE.SILICA) {
            this.drawSilica(sx,sy);
          } else if (feature === FEATURE.COAL) {
            this.drawCoal(tileX, tileY, sx, sy, seed);
          }
        }
      }

      if (player.isDiving) {
        this.drawDiveBubbles(displayTime);
      }

      // Floors are flush with ground; arrows and creatures pass above them.
      this.drawFloors(placedObjects || [], camX, camY);
      this.drawGiftEffects(giftEffects,camX,camY);
      if (projectiles && projectiles.length > 0) {
        this.drawProjectiles(projectiles, camX, camY);
      }

      // Composite the foreground once at native resolution; its alpha also
      // masks the independent HD projectile layer without redrawing buildings.
      if(!this.foregroundCanvas) {
        this.foregroundCanvas=document.createElement("canvas");
        this.foregroundCanvas.width=VIEW_W;this.foregroundCanvas.height=VIEW_H;
      }
      const foreground=this.foregroundCanvas.getContext("2d");
      foreground.clearRect(0,0,VIEW_W,VIEW_H);foreground.imageSmoothingEnabled=false;
      this.ctx=foreground;
      try {
      if (placedObjects && placedObjects.length > 0) {
        this.drawPlacedObjects(placedObjects, camX, camY, displayTime);
      }

      if (mobs && mobs.length > 0) {
        this.drawMobsWithOcclusion(mobs, placedObjects || [], camX, camY, displayTime);
      }

      this.drawPlayerWithOcclusion(player, placedObjects || [], camX, camY, displayTime);

      // Drawn above the player so a drop created on the player's own
      // tile is still visible on the ground. Ground drops also sit above
      // arrows and spears, so projectiles pass behind them.
      if (drops && drops.length > 0) {
        this.drawDrops(drops, camX, camY, displayTime);
      }

      // Roofs cover the scene last, including torches, creatures and drops.
      this.drawRoofs(placedObjects || [], camX, camY);
      this.drawWaterEffects(waterEffects,camX,camY);
      } finally {this.ctx=ctx;}
      ctx.drawImage(this.foregroundCanvas,0,0);
      if (roomIndex?.closedRooms.length) {
        if (!this.unlitSceneCanvas) {
          this.unlitSceneCanvas = document.createElement("canvas");
          this.unlitSceneCanvas.width = VIEW_W*this.renderScale; this.unlitSceneCanvas.height = VIEW_H*this.renderScale;
        }
        const unlit = this.unlitSceneCanvas.getContext("2d");
        unlit.clearRect(0, 0, this.unlitSceneCanvas.width, this.unlitSceneCanvas.height); unlit.drawImage(this.canvas, 0, 0);
      }
      const outdoorSources = (placedObjects || []).filter(o => !roomIndex?.at(o.tx, o.ty));
      this.drawLighting(lighting, outdoorSources, camX, camY, displayTime);
      this.drawEnclosedLighting(roomIndex, placedObjects || [], camX, camY, displayTime);

      if (target) {
        if (target.kind === "gift") this.drawGiftPreview(target,camX,camY);
        else if (target.kind === "placement") this.drawPlacementPreview(target, camX, camY, displayTime);
        else this.drawMiningTarget(target, camX, camY);
      }
      this.drawHDProjectiles(projectiles||[],camX,camY,lighting,outdoorSources,roomIndex,displayTime);
    }

    // -------------------------------------------------------------------
    // Placed objects. Sorted north→south (ascending ty) so a lower object
    // always draws in front of a taller one anchored above it.
    // -------------------------------------------------------------------
    drawGiftImage(x,y,radius,alpha=1) {
      const ctx=this.ctx;ctx.save();ctx.globalAlpha=alpha;ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.clip();
      ctx.fillStyle="#fff";ctx.fillRect(x-radius,y-radius,radius*2,radius*2);
      if(this.blgImage?.complete && this.blgImage.naturalWidth){ctx.imageSmoothingEnabled=true;ctx.drawImage(this.blgImage,x-radius,y-radius,radius*2,radius*2);}
      ctx.restore();
    }

    drawFarming(farm,camX,camY) {
      const ctx=this.ctx,t=CONFIG.TILE_SIZE;
      ctx.save();
      for(const f of farm.values()) {
        const x=Math.round(f.tx*t-camX),y=Math.round(f.ty*t-camY);
        if(x<-t||y<-t||x>CONFIG.VIEW_WIDTH||y>CONFIG.VIEW_HEIGHT)continue;
        if(f.soil) {
          // Uneven earth clods and short furrows, without plank-like stripes.
          ctx.fillStyle=f.wet?"#594331":"#8d6948";ctx.fillRect(x,y,t,t);
          for(let i=0;i<28;i++) {
            const hash=(Math.imul(f.tx+43,73856093)^Math.imul(f.ty-31,19349663)^Math.imul(i+7,83492791))>>>0;
            const px=1+hash%18,py=1+(hash>>>8)%18;
            ctx.fillStyle=f.wet?(i%2?"#46372c":"#6b5037"):(i%2?"#705236":"#a68159");
            ctx.fillRect(x+px,y+py,1+hash%3,1+(hash>>>14)%2);
          }
          ctx.strokeStyle=f.wet?"#40342b":"#644b34";ctx.lineWidth=1;
          for(let i=0;i<3;i++){ctx.beginPath();ctx.moveTo(x+3+i*6,y+4);ctx.lineTo(x+2+i*6,y+8);ctx.moveTo(x+3+i*6,y+12);ctx.lineTo(x+2+i*6,y+16);ctx.stroke();}
          if(f.wet){ctx.fillStyle="#6a7770";ctx.fillRect(x+5,y+9,3,1);ctx.fillRect(x+13,y+16,2,1);}
        }
        if(!f.crop)continue;
        const stage=Math.min(3,Math.floor(f.growth));
        if(f.crop==="sapling") {
          const h=7+stage*4,bx=x+10,by=y+17;
          ctx.strokeStyle="#68452e";ctx.lineWidth=stage?2:1;
          ctx.beginPath();ctx.moveTo(bx,by);ctx.lineTo(bx,by-h);ctx.moveTo(bx,by-4);ctx.lineTo(bx-4,by-h+2);ctx.moveTo(bx,by-6);ctx.lineTo(bx+4,by-h);ctx.stroke();
          for(const [dx,dy,r] of [[-4,2,2+stage],[4,0,3+stage],[0,-3,2+stage]]) {
            ctx.fillStyle="#315a32";ctx.beginPath();ctx.ellipse(bx+dx,by-h+dy,r,r*.75,-.4,0,Math.PI*2);ctx.fill();
            ctx.fillStyle="#669849";ctx.fillRect(bx+dx-1,by-h+dy-1,2,1);
          }
          continue;
        }
        const rice=f.crop==="rice",h=[4,8,12,14][stage];
        for(const dx of [5,10,15]) {
          const bx=x+dx,by=y+17,top=by-h+(dx===10?-1:1);
          ctx.strokeStyle=stage===3?(rice?"#8b9549":"#ad8b3f"):"#4e7a37";ctx.lineWidth=1;
          ctx.beginPath();ctx.moveTo(bx,by);ctx.lineTo(bx,top);
          // Long, narrow leaves; rice splays farther sideways.
          ctx.moveTo(bx,by-2);ctx.quadraticCurveTo(bx-(rice?5:3),by-5,bx-4,by-h*.65);
          ctx.moveTo(bx,by-4);ctx.quadraticCurveTo(bx+4,by-8,bx+3,by-h*.85);ctx.stroke();
          if(stage>=2) {
            ctx.fillStyle=stage===3?(rice?"#d8c37a":"#e5bd5c"):"#87a54a";
            if(rice) {
              ctx.beginPath();ctx.moveTo(bx,top+2);ctx.quadraticCurveTo(bx+4,top-3,bx+5,top+5);ctx.stroke();
              for(let k=0;k<4;k++){ctx.beginPath();ctx.ellipse(bx+1+k,top+1+k*.8,1,1.7,-.4,0,Math.PI*2);ctx.fill();}
            } else {
              for(let k=0;k<3;k++){ctx.fillRect(bx-2,top+k*2,2,2);ctx.fillRect(bx+1,top+k*2-1,2,2);}
              ctx.strokeStyle=stage===3?"#dbc885":"#9bb354";ctx.beginPath();ctx.moveTo(bx,top);ctx.lineTo(bx,top-3);ctx.stroke();
            }
          }
        }
      }
      ctx.restore();
    }

    drawWaterEffects(effects,camX,camY) {
      const ctx=this.ctx,t=CONFIG.TILE_SIZE;ctx.save();
      for(const e of effects){ctx.fillStyle=`rgba(73,172,232,${0.42*Math.max(0,1-e.age/1.8)})`;
        ctx.fillRect((e.tx-1)*t-camX,(e.ty-1)*t-camY,t*3,t*3);}
      ctx.restore();
    }

    drawGiftPreview(target,camX,camY) {
      const ctx=this.ctx,x=target.x-camX,y=target.y-camY;
      ctx.save();ctx.beginPath();ctx.arc(x,y,2,0,Math.PI*2);
      ctx.fillStyle=target.valid?"#65f1ab":"#fa6e79";ctx.fill();
      ctx.strokeStyle="#17332a";ctx.lineWidth=0.75;ctx.stroke();ctx.restore();
    }

    drawGiftEffects(effects,camX,camY) {
      for(const effect of effects) {
        if(effect.age<effect.airTime){
          const t=effect.age/effect.airTime,x=effect.startX+(effect.x-effect.startX)*t-camX,y=effect.startY+(effect.y-effect.startY)*t-camY-Math.sin(t*Math.PI)*35;
          this.ctx.save();this.ctx.translate(x,y);this.ctx.rotate(t*3);this.ctx.fillStyle="#10c3cf";this.ctx.fillRect(-4,-4,8,8);this.ctx.fillStyle="#ed4e7a";this.ctx.fillRect(-1,-4,2,8);this.ctx.restore();
        }else this.drawGiftImage(effect.x-camX,effect.y-camY,effect.radius,Math.min(1,(effect.airTime+5-effect.age)/0.5));
      }
    }

    drawPlacedObjects(objects, camX, camY, time) {
      const ctx = this.ctx;
      // Depth order across cells; inside a cell, torch stays above its solid.
      const ordered = objects.filter(o => o.type !== "roof" && o.type !== "wood_floor" && o.type !== "driftwood")
        .sort((a, b) => a.ty - b.ty || a.tx - b.tx || Number(a.type === "torch") - Number(b.type === "torch"));
      for (const object of ordered) {
        const x = Math.round(object.tx * TILE - camX), y = Math.round(object.ty * TILE - camY);
        if (x > VIEW_W + TILE || y > VIEW_H + 40 || x + TILE < -TILE || y + TILE < -40) continue;
        if (Wilds.Buildings.isBlocking(object)) {
          ctx.fillStyle = "rgba(10, 18, 12, 0.3)";
          ctx.beginPath(); ctx.ellipse(x + 10, y + 17, 8, 2.4, 0, 0, Math.PI * 2); ctx.fill();
        }
        this.drawFixedObject(object, camX, camY, time);
      }
      this.drawOccludedFixtures(objects, camX, camY, time);
    }

    drawFixedObject(object, camX, camY, time) {
      const x = Math.round(object.tx * TILE - camX), y = Math.round(object.ty * TILE - camY);
      if (["wall", "wood_door", "wood_fence", "fence_gate"].includes(object.type)) this.drawBuilding(object, x, y);
      else if (object.type === "workbench") this.drawPlacedWorkbench(x, y);
      else if (object.type === "torch") {
        const solid = this.buildingsAt(object.tx, object.ty).find(Wilds.Buildings.isBlocking);
        this.drawPlacedTorch(x, y - (solid ? Wilds.Buildings.height(solid) : 0), time, object.id);
      } else if (object.type === "stele") this.drawPlacedStele(x, y);
      else if (object.type === "respawn_stele") this.drawPlacedRespawnStele(x, y, time, object.active, object.id);
      else if (object.type === "bed") this.drawPlacedBed(x, y);
      else if (object.type === "storage_chest") this.drawPlacedChest(x, y);
      else if (object.type === "furnace") this.drawPlacedFurnace(x, y);
      else if ((object.type === "wood_floor" || object.type === "driftwood")) this.drawFloors([object], camX, camY);
      else if (object.type === "roof") this.drawRoofModel(x, y - Wilds.Buildings.WALL_HEIGHT);
    }

    fixtureBounds(object) {
      let height = Wilds.Buildings.height(object);
      if (object.type === "torch") {
        const solid = this.buildingsAt(object.tx, object.ty).find(Wilds.Buildings.isBlocking);
        height = (solid ? Wilds.Buildings.height(solid) : 0) + 3;
      }
      return { left: object.tx * TILE, right: (object.tx + 1) * TILE,
        top: object.ty * TILE - height, bottom: (object.ty + 1) * TILE };
    }

    occludingFixtures(object, objects) {
      if (!this.viewerRoom && this.roomIndex?.at(object.tx, object.ty)) return [];
      const a = this.fixtureBounds(object);
      return objects.filter(front => {
        if (front.ty <= object.ty || front.type === "roof" || front.type === "wood_floor" || front.type === "driftwood") return false;
        const b = this.fixtureBounds(front);
        return b.left < a.right && b.right > a.left && b.top < a.bottom && b.bottom > a.top;
      });
    }

    drawOccludedFixtures(objects, camX, camY, time) {
      const ctx = this.ctx;
      const visible = objects.filter(o => o.type !== "roof" && o.tx * TILE > camX - TILE &&
        o.tx * TILE < camX + VIEW_W + TILE && o.ty * TILE > camY - TILE && o.ty * TILE < camY + VIEW_H + 40);
      this.occlusionGhostCount = 0;
      for (const object of visible) {
        const occluders = this.occludingFixtures(object, visible);
        if (!occluders.length) continue;
        // Intersect actual model pixels on two reusable offscreen canvases.
        // This reveals only the hidden portion, never a full double image.
        if (!this.fixtureGhostCanvas) {
          this.fixtureGhostCanvas = document.createElement("canvas");
          this.fixtureMaskCanvas = document.createElement("canvas");
          for (const canvas of [this.fixtureGhostCanvas, this.fixtureMaskCanvas]) {
            canvas.width = VIEW_W; canvas.height = VIEW_H;
          }
        }
        const ghost = this.fixtureGhostCanvas.getContext("2d"), mask = this.fixtureMaskCanvas.getContext("2d");
        ghost.clearRect(0, 0, VIEW_W, VIEW_H); mask.clearRect(0, 0, VIEW_W, VIEW_H);
        try {
          this.ctx = mask;
          for (const front of occluders) this.drawFixedObject(front, camX, camY, time);
          this.ctx = ghost; this.drawFixedObject(object, camX, camY, time);
          ghost.globalCompositeOperation = "destination-in";
          ghost.drawImage(this.fixtureMaskCanvas, 0, 0);
          ghost.globalCompositeOperation = "source-over";
        } finally { this.ctx = ctx; }
        ctx.save(); ctx.globalAlpha = 0.28;
        ctx.drawImage(this.fixtureGhostCanvas, 0, 0); ctx.restore();
        this.occlusionGhostCount++;
      }
    }

    drawPlacementPreview(target, camX, camY, time) {
      const ctx = this.ctx, object = target.object;
      const previous = this.buildingTiles;
      // Temporary occupancy gives doors/fences their real expected orientation.
      this.buildingTiles = new Map(previous);
      for (const tile of object.tiles) {
        const key = `${tile.tx},${tile.ty}`;
        this.buildingTiles.set(key, [...(previous.get(key) || []), object]);
      }
      try {
        ctx.save(); ctx.globalAlpha = target.valid ? 0.42 : 0.22;
        this.drawFixedObject(object, camX, camY, time);
        ctx.restore();
      } finally { this.buildingTiles = previous; }
      ctx.save(); ctx.lineWidth = 1;
      const color = target.valid ? "#a7efd1" : "#f18b7e";
      ctx.strokeStyle = color; ctx.fillStyle = target.valid ? "rgba(128,238,190,0.09)" : "rgba(241,112,96,0.13)";
      for (const tile of object.tiles) {
        const x = Math.round(tile.tx * TILE - camX), y = Math.round(tile.ty * TILE - camY);
        ctx.fillRect(x, y, TILE, TILE); ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
      }
      // Roofs and tall models can be in a different screen cell from the anchor.
      ctx.setLineDash([2, 2]); ctx.beginPath();
      ctx.moveTo(Math.round(object.tx * TILE - camX + 10), Math.round(object.ty * TILE - camY + 10));
      const lift = object.type === "roof" ? Wilds.Buildings.WALL_HEIGHT : Wilds.Buildings.height(object);
      ctx.lineTo(Math.round(object.tx * TILE - camX + 10), Math.round(object.ty * TILE - camY + 10 - lift));
      ctx.stroke(); ctx.restore();
    }

    buildingsAt(tx, ty) {
      return this.buildingTiles?.get(`${tx},${ty}`) || [];
    }

    drawFloors(objects, camX, camY) {
      const ctx = this.ctx;
      for (const o of objects) {
        if (o.type !== "wood_floor" && o.type !== "driftwood") continue;
        const x = Math.round(o.tx * TILE - camX), y = Math.round(o.ty * TILE - camY);
        if (o.type === "driftwood") {
          ctx.fillStyle="#5a3c28";ctx.fillRect(x,y,TILE,TILE);
          for(let col=0;col<4;col++) {ctx.fillStyle=col%2?"#a67e50":"#bd9765";ctx.fillRect(x+col*5+1,y,4,TILE);}
          ctx.fillStyle="#ddc695";ctx.fillRect(x,y+3,TILE,2);ctx.fillRect(x,y+15,TILE,2);continue;
        }
        ctx.fillStyle = "#a97b48"; ctx.fillRect(x, y, TILE, TILE);
        for (let row = 0; row < 4; row++) {
          ctx.fillStyle = row % 2 ? "#bf9259" : "#b48750";
          ctx.fillRect(x + 1, y + row * 5 + 1, 18, 3);
          ctx.fillStyle = "#765031";
          ctx.fillRect(x, y + row * 5, TILE, 1);
          ctx.fillRect(x + (row % 2 ? 7 : 14), y + row * 5, 1, 5);
        }
      }
    }

    drawBuilding(object, x, y) {
      const ctx = this.ctx, B = Wilds.Buildings;
      if (object.type === "wall") {
        const h = B.WALL_HEIGHT;
        // Square cap and equal side treatment: no directional wall variants.
        ctx.fillStyle = "#797d74"; ctx.fillRect(x, y - h, TILE, TILE + h);
        ctx.fillStyle = "#b9bbab"; ctx.fillRect(x + 1, y - h, 18, 18);
        ctx.fillStyle = "#979e8f"; ctx.fillRect(x + 2, y - h + 2, 16, 14);
        ctx.fillStyle = "#62685e";
        for (let row = 0; row < 3; row++) {
          ctx.fillRect(x, y + row * 6, TILE, 1);
          ctx.fillRect(x + (row % 2 ? 6 : 13), y + row * 6, 1, 6);
        }
        ctx.fillRect(x, y - h, 1, TILE + h); ctx.fillRect(x + 19, y - h, 1, TILE + h);
        return;
      }
      const at = (tx, ty) => this.buildingsAt(tx, ty);
      const isFence = object.type !== "wood_door";
      const h = isFence ? B.FENCE_HEIGHT : B.WALL_HEIGHT;
      const post = (px, py) => {
        ctx.fillStyle = "#714b2c"; ctx.fillRect(px - 2, py - h, 4, h + 2);
        ctx.fillStyle = "#c59a5d"; ctx.fillRect(px - 1, py - h, 2, 3);
      };
      const rail = (x1, y1, x2, y2) => {
        ctx.strokeStyle = "#b48950"; ctx.lineWidth = 2;
        for (const lift of [3, 8]) {
          ctx.beginPath(); ctx.moveTo(x1, y1 - lift); ctx.lineTo(x2, y2 - lift); ctx.stroke();
        }
      };
      if (object.type === "wood_fence") {
        const c = B.connections(object, at);
        for (const [on, dx, dy] of [[c.left, -10, 0], [c.right, 10, 0], [c.up, 0, -10], [c.down, 0, 10]]) {
          if (on) rail(x + 10, y + 10, x + 10 + dx, y + 10 + dy);
        }
        post(x + 10, y + 10);
        return;
      }
      const { horizontal, near } = B.doorPose(object, at);
      const hingeX = x + (horizontal ? (near ? 1 : 19) : (object.open ? 1 : 10));
      const hingeY = y + (horizontal ? (object.open ? 1 : 10) : (near ? 1 : 19));
      const endX = object.open ? (horizontal ? hingeX : x + 19) : (horizontal ? x + (near ? 19 : 1) : 10 + x);
      const endY = object.open ? (horizontal ? y + 19 : hingeY) : (horizontal ? y + 10 : y + (near ? 19 : 1));
      if (isFence) {
        rail(hingeX, hingeY, endX, endY); post(hingeX, hingeY); post(endX, endY);
      } else {
        ctx.fillStyle = "#a87941";
        ctx.beginPath(); ctx.moveTo(hingeX, hingeY); ctx.lineTo(endX, endY);
        ctx.lineTo(endX, endY - h); ctx.lineTo(hingeX, hingeY - h); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = "#593c24"; ctx.lineWidth = 2; ctx.stroke();
        for (const t of [0.25, 0.5, 0.75]) {
          const px = hingeX + (endX - hingeX) * t, py = hingeY + (endY - hingeY) * t;
          ctx.beginPath(); ctx.moveTo(px, py - h + 2); ctx.lineTo(px, py - 1); ctx.stroke();
        }
        ctx.fillStyle = "#efd18c"; ctx.fillRect(Math.round(hingeX + (endX - hingeX) * 0.8), Math.round(hingeY + (endY - hingeY) * 0.8 - 8), 2, 2);
        post(hingeX, hingeY);
      }
    }

    drawRoofs(objects, camX, camY) {
      const ctx = this.ctx, h = Wilds.Buildings.WALL_HEIGHT;
      const roofs = objects.filter(o => o.type === "roof").sort((a, b) => a.ty - b.ty || a.tx - b.tx);
      // Opaque roofs first so an adjacent opaque edge cannot cover a faded room.
      for (const transparent of [false, true]) {
        for (const o of roofs) {
          if (this.transparentRoofTiles.has(`${o.tx},${o.ty}`) !== transparent) continue;
          const x = Math.round(o.tx * TILE - camX), y = Math.round(o.ty * TILE - camY);
          ctx.save(); ctx.globalAlpha = transparent ? Wilds.Buildings.ROOF_INTERIOR_ALPHA : 1;
          this.drawRoofModel(x, y - h);
          ctx.restore();
        }
      }
    }

    drawRoofModel(x, y) {
      const ctx = this.ctx;
      // Muted fired-clay shingles: warm roofing tones paired with the cool
      // concrete walls. Staggered overlaps stay flat within a single tile.
      ctx.fillStyle="#795248";ctx.fillRect(x,y,TILE,TILE);
      for(let row=0;row<4;row++) {
        const py=y+row*5, offset=row%2?-5:0;
        for(let col=offset;col<TILE;col+=10) {
          const left=Math.max(0,col),right=Math.min(TILE,col+10);
          const width=right-left;if(width<=0)continue;
          ctx.fillStyle=row%2?"#a16f5c":"#a97660";ctx.fillRect(x+left,py,width,4);
          ctx.fillStyle="#b88a70";ctx.fillRect(x+left,py,width,1);
          ctx.fillStyle="#8e604f";ctx.fillRect(x+left,py+3,width,1);
          ctx.fillStyle="#634b43";ctx.fillRect(x+left,py+4,width,1);
          if(col>=0){ctx.fillStyle="#80584b";ctx.fillRect(x+col,py+1,1,3);}
          if(col+4>=0&&col+4<TILE){ctx.fillStyle="#b18068";ctx.fillRect(x+col+4,py+2,2,1);}
        }
      }
    }

    drawPlacedWorkbench(x, y) {
      const ctx = this.ctx;

      ctx.fillStyle = "#3a2717";
      ctx.fillRect(x + 2, y + 5, 16, 3);
      ctx.fillRect(x + 3, y + 8, 2, 8);
      ctx.fillRect(x + 15, y + 8, 2, 8);
      ctx.fillStyle = "#9b6a3d";
      ctx.fillRect(x + 3, y + 5, 14, 2);
      ctx.fillStyle = "#c28c53";
      ctx.fillRect(x + 3, y + 4, 14, 1);
      ctx.fillStyle = "#694529";
      ctx.fillRect(x + 4, y + 8, 1, 6);
      ctx.fillRect(x + 15, y + 8, 1, 6);
      ctx.fillStyle = "#c7c2ac";
      ctx.fillRect(x + 11, y + 2, 5, 2);
      ctx.fillStyle = "#eee6c9";
      ctx.fillRect(x + 12, y + 2, 2, 1);
      ctx.fillStyle = "#6f4b2d";
      ctx.fillRect(x + 10, y + 3, 1, 1);
    }

    drawPlacedTorch(x, y, time, id) {
      const ctx = this.ctx;
      const flicker = this.reduceMotion ? 0 : Math.sin(time * 9 + id * 1.4);
      const flameX = x + 10;
      const flameY = y + 2 + Math.round(flicker * 0.6);

      ctx.fillStyle = "#3a2414";
      ctx.fillRect(x + 9, y + 7, 2, 9);
      ctx.fillStyle = "#8a5932";
      ctx.fillRect(x + 10, y + 7, 1, 8);
      ctx.fillStyle = "#d75d25";
      ctx.fillRect(flameX - 3, flameY + 2, 6, 5);
      ctx.fillStyle = "#f0a33a";
      ctx.fillRect(flameX - 2, flameY, 4, 5);
      ctx.fillStyle = "#ffe089";
      ctx.fillRect(flameX - 1, flameY - 2, 2, 3);
    }

    drawPlacedStele(x, y) {
      const ctx = this.ctx;

      // Stepped stone plinth.
      ctx.fillStyle = "#26291f";
      ctx.fillRect(x + 1, y + 17, 18, 3);
      ctx.fillRect(x + 3, y + 14, 14, 3);
      ctx.fillStyle = "#66695b";
      ctx.fillRect(x + 2, y + 16, 16, 2);
      ctx.fillRect(x + 4, y + 13, 12, 2);
      ctx.fillStyle = "#a3a28f";
      ctx.fillRect(x + 4, y + 13, 12, 1);
      ctx.fillStyle = "#4d5045";
      ctx.fillRect(x + 2, y + 18, 16, 1);

      // Main slab: dark silhouette, bevels, and a pale lit left edge.
      ctx.fillStyle = "#22251f";
      ctx.fillRect(x + 3, y - 10, 14, 25);
      ctx.fillRect(x + 4, y - 13, 12, 3);
      ctx.fillRect(x + 5, y - 15, 10, 2);
      ctx.fillStyle = "#777a6b";
      ctx.fillRect(x + 4, y - 10, 12, 23);
      ctx.fillRect(x + 5, y - 12, 10, 2);
      ctx.fillStyle = "#858777";
      ctx.fillRect(x + 5, y - 9, 10, 21);
      ctx.fillStyle = "#a6a794";
      ctx.fillRect(x + 5, y - 9, 1, 21);
      ctx.fillRect(x + 5, y - 13, 8, 1);
      ctx.fillStyle = "#5a5e50";
      ctx.fillRect(x + 14, y - 9, 1, 21);
      ctx.fillStyle = "#474a40";
      ctx.fillRect(x + 13, y + 10, 1, 2);

      // Carved border and inscription marks.
      ctx.fillStyle = "#4b4f43";
      ctx.fillRect(x + 6, y - 7, 1, 17);
      ctx.fillRect(x + 13, y - 7, 1, 17);
      ctx.fillRect(x + 6, y - 7, 8, 1);
      ctx.fillRect(x + 7, y + 2, 6, 1);
      ctx.fillStyle = "#3d4137";
      ctx.fillRect(x + 8, y - 4, 4, 1);
      ctx.fillRect(x + 8, y - 2, 3, 1);
      ctx.fillRect(x + 8, y, 4, 1);
      ctx.fillRect(x + 7, y + 4, 5, 1);
      ctx.fillRect(x + 8, y + 6, 3, 1);
      ctx.fillRect(x + 7, y + 8, 4, 1);
      ctx.fillRect(x + 10, y + 10, 2, 1);

      // A small carved medallion under the cap.
      ctx.fillStyle = "#555a4b";
      ctx.fillRect(x + 8, y - 11, 4, 3);
      ctx.fillStyle = "#b7b49e";
      ctx.fillRect(x + 9, y - 11, 2, 1);
      ctx.fillStyle = "#3d4137";
      ctx.fillRect(x + 9, y - 9, 2, 1);

      // Cracks, chips and damp moss at the foot.
      ctx.fillStyle = "#5d6153";
      ctx.fillRect(x + 12, y - 6, 1, 3);
      ctx.fillRect(x + 11, y - 3, 1, 2);
      ctx.fillRect(x + 12, y + 1, 1, 1);
      ctx.fillStyle = "#9b9a88";
      ctx.fillRect(x + 4, y + 7, 1, 2);
      ctx.fillStyle = "#53663f";
      ctx.fillRect(x + 3, y + 12, 3, 2);
      ctx.fillRect(x + 15, y + 12, 2, 2);
      ctx.fillStyle = "#708552";
      ctx.fillRect(x + 4, y + 12, 1, 1);
      ctx.fillRect(x + 14, y + 13, 1, 1);
    }

    drawPlacedRespawnStele(x, y, time, active, id) {
      const ctx = this.ctx;
      const pulse = active && !this.reduceMotion
        ? 0.65 + Math.sin(time * 3.4 + id * 1.1) * 0.35
        : 0;

      ctx.fillStyle = "#24271f";
      ctx.fillRect(x + 4, y + 15, 12, 3);
      ctx.fillStyle = "#777b69";
      ctx.fillRect(x + 5, y + 14, 10, 2);
      ctx.fillStyle = "#a0a28f";
      ctx.fillRect(x + 5, y + 14, 10, 1);
      ctx.fillStyle = "#34392f";
      ctx.fillRect(x + 6, y - 5, 8, 20);
      ctx.fillStyle = "#858b79";
      ctx.fillRect(x + 7, y - 5, 6, 19);
      ctx.fillStyle = "#aeb39e";
      ctx.fillRect(x + 7, y - 5, 1, 19);
      ctx.fillStyle = "#5c6254";
      ctx.fillRect(x + 12, y - 4, 1, 18);
      ctx.fillStyle = "#4c5447";
      ctx.fillRect(x + 6, y - 5, 8, 2);

      if (active) {
        ctx.fillStyle = "rgba(83, 216, 178, " + (0.3 + pulse * 0.55).toFixed(3) + ")";
        ctx.fillRect(x + 9, y - 1, 2, 10);
        ctx.fillRect(x + 8, y + 3, 4, 3);
        ctx.fillStyle = "rgba(198, 255, 225, " + (0.55 + pulse * 0.4).toFixed(3) + ")";
        ctx.fillRect(x + 9, y + 1, 1, 2);
        ctx.fillRect(x + 10, y + 6, 1, 2);
        ctx.fillStyle = "rgba(115, 242, 195, " + (0.1 + pulse * 0.16).toFixed(3) + ")";
        ctx.beginPath();
        ctx.arc(x + 10, y + 4, 9, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = "#385c50";
        ctx.fillRect(x + 9, y, 2, 8);
        ctx.fillStyle = "#668478";
        ctx.fillRect(x + 9, y, 1, 2);
      }

      ctx.fillStyle = "#3d4438";
      ctx.fillRect(x + 6, y + 8, 3, 1);
      ctx.fillRect(x + 8, y + 11, 2, 1);
    }

    // -------------------------------------------------------------------
    // Living creatures. Dying mobs play a squash/fade/dust animation and
    // hide their health bar; normal mobs just draw with a hit flash.
    // -------------------------------------------------------------------
    mobOccluders(mob, objects) {
      return objects.filter(object => {
        if (!Wilds.Buildings.isBlocking(object) || Wilds.Buildings.height(object) <= 0 ||
            (object.ty + 0.5) * TILE <= mob.y) return false;
        const b = this.fixtureBounds(object);
        return b.left < mob.x + 16 && b.right > mob.x - 16 && b.top < mob.y + 20 && b.bottom > mob.y - 32;
      });
    }

    drawMobsWithOcclusion(mobs, objects, camX, camY, time) {
      const ctx = this.ctx;
      for (const mob of mobs.slice().sort((a, b) => a.y - b.y)) {
        const occluders = this.mobOccluders(mob, objects);
        if (!occluders.length) { this.drawMobs([mob], camX, camY, time); continue; }
        if (!this.mobOcclusionCanvas) {
          this.mobOcclusionCanvas = document.createElement("canvas"); this.mobMaskCanvas = document.createElement("canvas");
          for (const canvas of [this.mobOcclusionCanvas, this.mobMaskCanvas]) { canvas.width = VIEW_W; canvas.height = VIEW_H; }
        }
        const layer = this.mobOcclusionCanvas.getContext("2d"), mask = this.mobMaskCanvas.getContext("2d");
        layer.clearRect(0, 0, VIEW_W, VIEW_H); mask.clearRect(0, 0, VIEW_W, VIEW_H);
        try {
          this.ctx = layer; this.drawMobs([mob], camX, camY, time);
          this.ctx = mask; for (const object of occluders) this.drawFixedObject(object, camX, camY, time);
        } finally { this.ctx = ctx; }
        layer.save(); layer.globalCompositeOperation = "destination-out";
        const hiddenRoom = !this.viewerRoom && this.roomIndex?.at(Math.floor(mob.x / TILE), Math.floor(mob.y / TILE));
        layer.globalAlpha = hiddenRoom ? 1 : 0.72;
        layer.drawImage(this.mobMaskCanvas, 0, 0); layer.restore();
        ctx.drawImage(this.mobOcclusionCanvas, 0, 0);
      }
    }

    drawPlayerWithOcclusion(player, objects, camX, camY, time) {
      const occluders = this.mobOccluders(player, objects);
      if (!occluders.length) { this.drawPlayer(player); return; }
      if (!this.playerOcclusionCanvas) {
        this.playerOcclusionCanvas = document.createElement("canvas"); this.playerMaskCanvas = document.createElement("canvas");
        for (const canvas of [this.playerOcclusionCanvas, this.playerMaskCanvas]) { canvas.width = VIEW_W; canvas.height = VIEW_H; }
      }
      const ctx = this.ctx, layer = this.playerOcclusionCanvas.getContext("2d"), mask = this.playerMaskCanvas.getContext("2d");
      layer.clearRect(0, 0, VIEW_W, VIEW_H); mask.clearRect(0, 0, VIEW_W, VIEW_H);
      try {
        this.ctx = layer; this.drawPlayer(player);
        this.ctx = mask; for (const object of occluders) this.drawFixedObject(object, camX, camY, time);
      } finally { this.ctx = ctx; }
      layer.save(); layer.globalCompositeOperation = "destination-out"; layer.globalAlpha = 0.72;
      layer.drawImage(this.playerMaskCanvas, 0, 0); layer.restore();
      ctx.drawImage(this.playerOcclusionCanvas, 0, 0);
    }

    drawMobs(mobs, camX, camY, time) {
      const ctx = this.ctx;
      for (const mob of mobs) {
        const sx = Math.round(mob.x - camX);
        const sy = Math.round(mob.y - camY);
        if (sx < -30 || sy < -30 || sx > VIEW_W + 30 || sy > VIEW_H + 30) continue;

        const deathProgress = mob.dying
          ? Math.max(0, Math.min(1, (performance.now() - mob.deathStartedAt) / mob.deathDuration))
          : 0;
        const flash = performance.now() < mob.hitFlashUntil;

        ctx.fillStyle = "rgba(7, 14, 9, 0.28)";
        ctx.beginPath();
        ctx.ellipse(sx, sy + 8, 7, 2.2, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.save();
        if (mob.dying) {
          ctx.translate(sx, sy + deathProgress * 4);
          ctx.rotate(deathProgress * 0.32);
          ctx.scale(1, Math.max(0.3, 1 - deathProgress * 0.55));
          ctx.globalAlpha = Math.max(0, 1 - deathProgress);
        } else {
          const jumpHeight = mob.jump ? Math.sin(Math.PI * mob.jump.elapsed / mob.jump.duration) * 16 : 0;
          ctx.translate(sx, sy - jumpHeight);
          if (flash) ctx.globalAlpha = 0.55;
        }

        if (mob.aquatic) {
          this.drawAquatic(0,0,mob.type==="shark",time);
        } else if (mob.type === "sheep") {
          this.drawSheep(0, 0);
        } else if (mob.type === "algorithm_chicken") {
          this.drawChicken(0, 0, time);
        } else if (mob.type === "pig") {
          this.drawPig(0, 0);
        } else if (mob.type === "spider") {
          this.drawSpider(0, 0, time);
        } else if (mob.type === "zombie") {
          this.drawZombie(0, 0);
        } else if (mob.type === "savage_archer") {
          this.drawArcher(0, 0);
        } else if (mob.type === "dark_lucian") {
          this.drawDarkLucian(0,0,Boolean(mob.culling));
        }
        ctx.restore();

        if (mob.dying) {
          ctx.fillStyle = "rgba(20, 25, 18, " + (0.35 * (1 - deathProgress)).toFixed(3) + ")";
          for (let i = 0; i < 4; i += 1) {
            const angle = Math.PI * 2 * (i / 4) + 0.6;
            const radius = 4 + deathProgress * 10;
            ctx.beginPath();
            ctx.arc(
              sx + Math.cos(angle) * radius,
              sy + 5 + Math.sin(angle) * radius * 0.5,
              1.4 + deathProgress * 1.2,
              0,
              Math.PI * 2
            );
            ctx.fill();
          }
        }

        if (!mob.dying && (mob.health < mob.maxHealth || mob.aggro)) {
          const width = 18;
          ctx.fillStyle = "rgba(5, 10, 7, 0.72)";
          ctx.fillRect(sx - width / 2, sy - 18, width, 3);
          ctx.fillStyle = mob.monster ? "#c96b56" : "#8ac56d";
          ctx.fillRect(sx - width / 2, sy - 18, width * (mob.health / mob.maxHealth), 3);
        }
      }
    }

    drawAquatic(x,y,shark,time) {
      const ctx=this.ctx,w=shark?24:12,h=shark?10:6;
      const tail=Math.sin(time*8)>0?1:-1;
      ctx.fillStyle=shark?"#547d89":"#74bac3";
      ctx.beginPath();ctx.moveTo(x-w/2,y);ctx.lineTo(x-w/2-5,y-h/2+tail);ctx.lineTo(x-w/2-5,y+h/2+tail);ctx.closePath();ctx.fill();
      ctx.fillRect(x-w/2,y-h/2,w,h);ctx.fillRect(x+w/2,y-h/2+2,3,h-4);
      ctx.fillStyle=shark?"#a3c3c5":"#bce5d5";ctx.fillRect(x-w/2+2,y+1,w-2,2);
      if(shark){ctx.fillStyle="#446675";ctx.beginPath();ctx.moveTo(x-4,y-5);ctx.lineTo(x,y-11);ctx.lineTo(x+5,y-5);ctx.fill();ctx.fillStyle="#e8e5c5";ctx.fillRect(x+8,y+2,4,1);}
      ctx.fillStyle="#173f4a";ctx.fillRect(x+w/2-3,y-2,1,1);
    }

    drawPig(x, y) {
      const ctx = this.ctx;
      ctx.fillStyle = "#84535c";
      ctx.fillRect(x - 7, y + 4, 3, 5); ctx.fillRect(x + 4, y + 4, 3, 5);
      ctx.fillStyle = "#d88e98";
      ctx.fillRect(x - 9, y - 6, 17, 12);
      ctx.fillStyle = "#edb0b2";
      ctx.fillRect(x - 8, y - 7, 14, 3);
      ctx.fillRect(x + 4, y - 5, 7, 9);
      ctx.fillStyle = "#bb717e";
      ctx.fillRect(x + 3, y - 9, 3, 5); ctx.fillRect(x + 8, y - 8, 3, 4);
      ctx.fillStyle = "#f4bec0";
      ctx.fillRect(x + 7, y, 6, 4);
      ctx.fillStyle = "#573840";
      ctx.fillRect(x + 8, y + 1, 1, 2); ctx.fillRect(x + 11, y + 1, 1, 2);
      ctx.fillRect(x + 7, y - 3, 1, 2);
      ctx.fillStyle = "#d88e98";
      ctx.fillRect(x - 12, y - 3, 4, 2); ctx.fillRect(x - 12, y - 5, 2, 3);
    }

    drawSpider(x, y, time) {
      const ctx = this.ctx;
      // Four pairs of articulated legs keep the silhouette distinct.
      for (let i = 0; i < 4; i += 1) {
        const offset = Math.round(Math.sin(time * 9 + i * 2) * 1.5);
        for (const side of [-1, 1]) {
          ctx.fillStyle = "#514451";
          ctx.fillRect(x + (side < 0 ? -10 : 4), y - 6 + i * 4, 6, 2);
          ctx.fillRect(x + (side < 0 ? -13 : 10), y - 8 + i * 5 + offset, 3, 4);
        }
      }
      ctx.fillStyle = "#362c3d"; ctx.fillRect(x - 6, y - 8, 12, 11);
      ctx.fillStyle = "#695067"; ctx.fillRect(x - 4, y - 7, 7, 3);
      ctx.fillStyle = "#4c394d"; ctx.fillRect(x - 5, y + 1, 10, 6);
      ctx.fillStyle = "#ec856a";
      ctx.fillRect(x - 3, y + 3, 2, 2); ctx.fillRect(x + 1, y + 3, 2, 2);
      ctx.fillStyle = "#dbc9b3";
      ctx.fillRect(x - 3, y + 7, 1, 2); ctx.fillRect(x + 2, y + 7, 1, 2);
    }

    drawSheep(x, y) {
      const ctx = this.ctx;
      ctx.fillStyle = "#e7e3d7";
      ctx.fillRect(x - 7, y - 8, 12, 7);
      ctx.fillRect(x - 5, y - 10, 8, 3);
      ctx.fillStyle = "#cfcabc";
      ctx.fillRect(x - 5, y - 2, 2, 5);
      ctx.fillRect(x + 2, y - 2, 2, 5);
      ctx.fillStyle = "#4c4b43";
      ctx.fillRect(x + 4, y - 9, 5, 4);
      ctx.fillRect(x + 7, y - 8, 2, 2);
      ctx.fillStyle = "#b3ad9e";
      ctx.fillRect(x - 3, y - 4, 1, 2);
    }

    drawChicken(x, y, time) {
      const ctx = this.ctx;
      ctx.fillStyle = "#e9e2cf";
      ctx.fillRect(x - 4, y - 7, 8, 7);
      ctx.fillRect(x - 1, y - 11, 4, 4);
      ctx.fillStyle = "#d8b45f";
      ctx.fillRect(x + 3, y - 9, 2, 1);
      ctx.fillStyle = "#b84c3f";
      ctx.fillRect(x, y - 12, 2, 1);
      ctx.fillStyle = "#4b8f89";
      ctx.fillRect(x - 3, y - 5, 1, 1);
      ctx.fillRect(x + 1, y - 3, 1, 1);
      ctx.fillStyle = "#d5b05a";
      ctx.fillRect(x - 2, y, 1, 3);
      ctx.fillRect(x + 1, y, 1, 3);
      if (Math.sin(time * 5) > 0.4) {
        ctx.fillRect(x - 1, y - 6, 2, 1);
      }
    }

    drawZombie(x, y) {
      const ctx = this.ctx;
      ctx.fillStyle = "#382f2a";
      ctx.fillRect(x - 5, y - 6, 10, 10);
      ctx.fillStyle = "#47602f";
      ctx.fillRect(x - 4, y - 12, 8, 7);
      ctx.fillRect(x - 8, y - 7, 3, 2);
      ctx.fillRect(x + 5, y - 7, 3, 2);
      ctx.fillStyle = "#6d8b48";
      ctx.fillRect(x - 3, y - 10, 6, 4);
      ctx.fillStyle = "#c9d18d";
      ctx.fillRect(x - 3, y - 9, 1, 1);
      ctx.fillRect(x + 2, y - 9, 1, 1);
      ctx.fillStyle = "#4a3c32";
      ctx.fillRect(x - 4, y + 4, 3, 4);
      ctx.fillRect(x + 1, y + 4, 3, 4);
    }

    drawDarkLucian(x,y,firing) {
      const ctx=this.ctx;
      ctx.fillStyle="#151e30";ctx.beginPath();ctx.moveTo(x-5,y-6);ctx.lineTo(x+5,y-6);ctx.lineTo(x+8,y+5);ctx.lineTo(x-8,y+5);ctx.fill();
      ctx.fillStyle="#3d465e";ctx.fillRect(x-4,y-6,8,8);
      ctx.fillStyle="#b9c7d9";ctx.fillRect(x-1,y-5,2,7);
      ctx.fillStyle="#483539";ctx.fillRect(x-3,y-12,6,6);
      ctx.fillStyle="#131a28";ctx.fillRect(x-4,y-14,8,4);
      ctx.fillStyle="#66c9ff";ctx.fillRect(x-2,y-9,1,1);ctx.fillRect(x+1,y-9,1,1);
      ctx.fillStyle="#171d2a";ctx.fillRect(x-4,y+4,3,5);ctx.fillRect(x+1,y+4,3,5);
      for(const side of [-1,1]) {
        ctx.fillStyle="#778fa9";ctx.fillRect(x+side*7-2,y-5,4,7);
        ctx.fillStyle="#23364e";ctx.fillRect(x+side*7-1,y-3,2,4);
        ctx.fillStyle=firing?"#a9f1ff":"#437ea9";ctx.fillRect(x+side*7-1,y-6,2,2);
      }
    }

    drawArcher(x, y) {
      const ctx = this.ctx;
      // A slimmer, cloaked archer with a bow, visually distinct from the zombie.
      ctx.fillStyle = "#4b3a28";
      ctx.fillRect(x - 4, y - 5, 8, 9);
      ctx.fillStyle = "#6f5638";
      ctx.fillRect(x - 5, y - 7, 10, 4);
      ctx.fillStyle = "#c59669";
      ctx.fillRect(x - 2, y - 12, 5, 6);
      ctx.fillStyle = "#2f251b";
      ctx.fillRect(x - 4, y - 13, 9, 3);
      ctx.fillStyle = "#8b6b45";
      ctx.fillRect(x - 3, y + 4, 2, 4);
      ctx.fillRect(x + 2, y + 4, 2, 4);
      ctx.fillStyle = "#7a4d28";
      ctx.strokeStyle = "#7a4d28";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(x + 6, y - 1, 7, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
      ctx.fillStyle = "#e2d7bd";
      ctx.fillRect(x + 5, y - 8, 1, 14);
      ctx.fillStyle = "#d9caa4";
      ctx.fillRect(x + 5, y - 1, 7, 1);
    }

    // -------------------------------------------------------------------
    // Arrows / enemy projectiles. Rotated to face their velocity vector.
    // -------------------------------------------------------------------
    drawHDProjectiles(projectiles,camX,camY,lighting,outdoorSources,roomIndex,time) {
      const visible=projectiles.filter(p=>p.type==="culling_bullet" && p.x>=camX-20 && p.x<=camX+VIEW_W+20 && p.y>=camY-20 && p.y<=camY+VIEW_H+20);
      if(!visible.length) {
        if(this.projectileCanvas)this.projectileCanvas.hidden=true;
        return;
      }
      if(!this.projectileCanvas) {
        this.projectileCanvas=document.createElement("canvas");
        this.projectileCanvas.className="projectile-hd-layer";
        this.projectileCanvas.setAttribute("aria-hidden","true");
        this.projectileCanvas.width=VIEW_W*3;this.projectileCanvas.height=VIEW_H*3;
        this.canvas.insertAdjacentElement("afterend",this.projectileCanvas);
        this.projectileLightCanvas=document.createElement("canvas");
        this.projectileLightCanvas.width=VIEW_W;this.projectileLightCanvas.height=VIEW_H;
      }
      this.projectileCanvas.hidden=false;
      const hd=this.projectileCanvas.getContext("2d"),light=this.projectileLightCanvas.getContext("2d"),original=this.ctx;
      hd.setTransform(3,0,0,3,0,0);hd.globalCompositeOperation="source-over";
      hd.clearRect(0,0,VIEW_W,VIEW_H);
      light.clearRect(0,0,VIEW_W,VIEW_H);
      try {
        this.ctx=hd;this.drawProjectiles(visible,camX,camY,true);
        // Lighting stays at 480×300; apply it only to the bullet pixels.
        this.ctx=light;this.drawLighting(lighting,outdoorSources,camX,camY,time);
        for(const room of roomIndex?.closedRooms||[]) {
          light.save();light.beginPath();
          for(const cell of room.cells)light.rect(Math.round(cell.tx*TILE-camX),Math.round(cell.ty*TILE-camY-Wilds.Buildings.WALL_HEIGHT),TILE,TILE+Wilds.Buildings.WALL_HEIGHT);
          light.clip();light.clearRect(0,0,VIEW_W,VIEW_H);
          this.drawLighting({darkness:.72,warm:0},roomIndex.torchesFor(room),camX,camY,time);
          light.restore();
        }
      } finally {this.ctx=original;}
      hd.globalCompositeOperation="source-atop";
      hd.drawImage(this.projectileLightCanvas,0,0);
      hd.globalCompositeOperation="destination-out";hd.imageSmoothingEnabled=false;
      hd.drawImage(this.foregroundCanvas,0,0);
      hd.globalCompositeOperation="source-over";
    }

    drawProjectiles(projectiles, camX, camY, hd = false) {
      const ctx = this.ctx;
      for (const projectile of projectiles) {
        if((projectile.type==="culling_bullet")!==hd)continue;
        const sx = projectile.x - camX;
        const sy = projectile.y - camY;
        if (sx < -20 || sy < -20 || sx > VIEW_W + 20 || sy > VIEW_H + 20) continue;
        const angle = Math.atan2(projectile.vy, projectile.vx);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(angle);
        if (projectile.type === "culling_bullet") {
          ctx.lineCap="round";
          const trail=ctx.createLinearGradient(-12,0,4,0);
          trail.addColorStop(0,"rgba(25,68,220,0)");trail.addColorStop(1,"rgba(45,102,255,0.28)");
          ctx.strokeStyle=trail;ctx.lineWidth=5.6;ctx.beginPath();ctx.moveTo(-12,0);ctx.lineTo(3,0);ctx.stroke();
          ctx.strokeStyle="#2055e8";ctx.lineWidth=3.6;ctx.beginPath();ctx.moveTo(-9,0);ctx.lineTo(3,0);ctx.stroke();
          ctx.strokeStyle="#689aff";ctx.lineWidth=1.3;ctx.beginPath();ctx.moveTo(-3,0);ctx.lineTo(3,0);ctx.stroke();
        } else if (projectile.owner === "player") {
          ctx.fillStyle = "#e8dfc2";
          ctx.fillRect(-6, -1, 12, 1);
          ctx.fillStyle = "#b7aa8c";
          ctx.fillRect(4, -2, 2, 3);
          ctx.fillStyle = "#d7c7a3";
          ctx.fillRect(-7, -2, 2, 3);
        } else {
          ctx.fillStyle = "#d8c7a2";
          ctx.fillRect(-6, -1, 12, 1);
          ctx.fillStyle = "#9e3f32";
          ctx.fillRect(-7, -2, 3, 3);
          ctx.fillStyle = "#5b4a37";
          ctx.fillRect(4, -2, 2, 3);
        }
        ctx.restore();
      }
    }

    drawPlacedBed(x, y) {
      const ctx = this.ctx;
      ctx.fillStyle = "#3c2819";
      ctx.fillRect(x + 2, y + 7, 16, 4);
      ctx.fillStyle = "#6f4a2c";
      ctx.fillRect(x + 2, y + 7, 16, 2);
      ctx.fillStyle = "#b6493e";
      ctx.fillRect(x + 3, y + 9, 14, 4);
      ctx.fillStyle = "#e5dfcf";
      ctx.fillRect(x + 3, y + 5, 7, 4);
      ctx.fillStyle = "#f2eee0";
      ctx.fillRect(x + 3, y + 4, 7, 2);
      ctx.fillStyle = "#7c5837";
      ctx.fillRect(x + 3, y + 13, 2, 4);
      ctx.fillRect(x + 15, y + 13, 2, 4);
    }

    drawPlacedChest(x, y) {
      const ctx = this.ctx;
      ctx.fillStyle = "#3a2414";
      ctx.fillRect(x + 2, y + 5, 16, 11);
      ctx.fillStyle = "#78502c";
      ctx.fillRect(x + 2, y + 4, 16, 5);
      ctx.fillStyle = "#a9793f";
      ctx.fillRect(x + 3, y + 9, 14, 1);
      ctx.fillStyle = "#d0ad63";
      ctx.fillRect(x + 9, y + 3, 2, 12);
      ctx.fillStyle = "#e4c77e";
      ctx.fillRect(x + 9, y + 8, 2, 3);
      ctx.fillStyle = "#2c1c10";
      ctx.fillRect(x + 2, y + 15, 2, 2);
      ctx.fillRect(x + 16, y + 15, 2, 2);
    }

    drawPlacedFurnace(x, y) {
      const ctx = this.ctx;
      ctx.fillStyle = "#31332d";
      ctx.fillRect(x + 2, y + 3, 16, 14);
      ctx.fillStyle = "#6d6c60";
      ctx.fillRect(x + 3, y + 4, 14, 12);
      ctx.fillStyle = "#8c8a7b";
      ctx.fillRect(x + 4, y + 5, 12, 3);
      ctx.fillStyle = "#252019";
      ctx.fillRect(x + 5, y + 10, 10, 5);
      ctx.fillStyle = "#d98240";
      ctx.fillRect(x + 7, y + 12, 6, 3);
      ctx.fillStyle = "#f0c060";
      ctx.fillRect(x + 9, y + 12, 2, 2);
      ctx.fillStyle = "#5c5a50";
      ctx.fillRect(x + 8, y - 1, 4, 4);
      ctx.fillStyle = "#918f80";
      ctx.fillRect(x + 9, y - 2, 2, 2);
    }

    // -------------------------------------------------------------------
    // Lighting. The night layer is rendered off-screen, then torch/stele
    // light cuts holes in it with "destination-out", revealing the real
    // terrain underneath. Warm screen light adds sunrise/sunset glow.
    // -------------------------------------------------------------------
    drawEnclosedLighting(roomIndex, objects, camX, camY, time) {
      if (!roomIndex?.closedRooms.length || !this.unlitSceneCanvas) return;
      const ctx = this.ctx, h = Wilds.Buildings.WALL_HEIGHT;
      if (!this.boundaryOutdoorCanvas) {
        this.boundaryOutdoorCanvas = document.createElement("canvas"); this.boundaryRestoreCanvas = document.createElement("canvas");
        for (const canvas of [this.boundaryOutdoorCanvas,this.boundaryRestoreCanvas]) {canvas.width=VIEW_W;canvas.height=VIEW_H;}
      }
      const outdoor=this.boundaryOutdoorCanvas.getContext("2d");
      outdoor.clearRect(0,0,VIEW_W,VIEW_H);outdoor.drawImage(this.canvas,0,0,VIEW_W,VIEW_H);

      for (const room of roomIndex.closedRooms) {
        const cells = room.cells.filter(tile => tile.tx * TILE >= camX - TILE && tile.tx * TILE <= camX + VIEW_W &&
          tile.ty * TILE >= camY - TILE && tile.ty * TILE <= camY + VIEW_H + h);
        if (!cells.length) continue;
        ctx.save(); ctx.beginPath();
        for (const tile of cells) ctx.rect(Math.round(tile.tx * TILE - camX), Math.round(tile.ty * TILE - camY - h), TILE, TILE + h);
        ctx.clip();
        // Restore the unlit scene to remove outdoor sunlight and lamps first.
        // The clip also prevents room lamps and their warm glow escaping outside.
        ctx.drawImage(this.unlitSceneCanvas, 0, 0,VIEW_W,VIEW_H);
        this.drawLighting({ darkness: 0.72, warm: 0 }, roomIndex.torchesFor(room), camX, camY, time);
        ctx.restore();
      }
      // Region membership includes the perimeter, but its visible wall/door
      // models retain outdoor illumination. Restore only their actual pixels.
      const boundaries=new Set();
      for(const room of roomIndex.closedRooms) for(const tile of room.surfaceCells) {
        if(room.tiles.has(`${tile.tx},${tile.ty}`))continue;
        for(const object of this.buildingsAt(tile.tx,tile.ty)) if(Wilds.Buildings.isBlocking(object))boundaries.add(object);
      }
      const restore=this.boundaryRestoreCanvas.getContext("2d");restore.clearRect(0,0,VIEW_W,VIEW_H);
      try {this.ctx=restore;for(const object of boundaries)this.drawFixedObject(object,camX,camY,time);}
      finally {this.ctx=ctx;}
      restore.globalCompositeOperation="source-in";restore.drawImage(this.boundaryOutdoorCanvas,0,0);restore.globalCompositeOperation="source-over";
      ctx.drawImage(this.boundaryRestoreCanvas,0,0);
    }

    drawLighting(lighting, placedObjects, camX, camY, time) {
      if (!lighting) return;

      const ctx = this.ctx;
      ctx.globalCompositeOperation = "source-over";

      const torches = lighting.darkness > 0.02 && placedObjects
        ? placedObjects.filter((object) => object.type === "torch")
        : [];
      const activeRespawns = lighting.darkness > 0.02 && placedObjects
        ? placedObjects.filter((object) => object.type === "respawn_stele" && object.active)
        : [];

      if (lighting.darkness > 0.001) {
        // Build the night layer off-screen so lights can cut clear
        // openings in it. This reveals the real terrain instead of
        // stacking a translucent yellow "fog" over the scene.
        const lightCtx = this.lightCtx;
        lightCtx.clearRect(0, 0, VIEW_W, VIEW_H);
        lightCtx.globalCompositeOperation = "source-over";
        lightCtx.fillStyle = "rgba(5, 12, 29, " + lighting.darkness.toFixed(3) + ")";
        lightCtx.fillRect(0, 0, VIEW_W, VIEW_H);

        if (torches.length > 0 || activeRespawns.length > 0) {
          lightCtx.globalCompositeOperation = "destination-out";

          for (const torch of torches) {
            const sx = torch.tx * TILE - camX + TILE / 2;
            const sy = torch.ty * TILE - camY + TILE / 2;
            const flicker = this.reduceMotion ? 1 : 0.96 + Math.sin(time * 7 + torch.id) * 0.04;
            const radius = TORCH_LIGHT_RADIUS * flicker;
            const hole = lightCtx.createRadialGradient(sx, sy, TILE * 0.45, sx, sy, radius);
            hole.addColorStop(0, "rgba(0, 0, 0, 0.96)");
            hole.addColorStop(0.48, "rgba(0, 0, 0, 0.9)");
            hole.addColorStop(0.74, "rgba(0, 0, 0, 0.52)");
            hole.addColorStop(0.9, "rgba(0, 0, 0, 0.18)");
            hole.addColorStop(1, "rgba(0, 0, 0, 0)");
            lightCtx.fillStyle = hole;
            lightCtx.fillRect(0, 0, VIEW_W, VIEW_H);
          }

          for (const stele of activeRespawns) {
            const sx = stele.tx * TILE - camX + TILE / 2;
            const sy = stele.ty * TILE - camY + TILE / 2;
            const flicker = this.reduceMotion ? 1 : 0.92 + Math.sin(time * 3.4 + stele.id) * 0.08;
            const radius = TILE * 2.1 * flicker;
            const hole = lightCtx.createRadialGradient(sx, sy, TILE * 0.3, sx, sy, radius);
            hole.addColorStop(0, "rgba(0, 0, 0, 0.9)");
            hole.addColorStop(0.5, "rgba(0, 0, 0, 0.74)");
            hole.addColorStop(0.82, "rgba(0, 0, 0, 0.3)");
            hole.addColorStop(1, "rgba(0, 0, 0, 0)");
            lightCtx.fillStyle = hole;
            lightCtx.fillRect(sx - radius, sy - radius, radius * 2, radius * 2);
          }

          lightCtx.globalCompositeOperation = "source-over";
        }
        ctx.drawImage(this.lightCanvas, 0, 0);
      }

      if (lighting.warm > 0.001) {
        // Screen light keeps sunrise/sunset luminous instead of muddy.
        ctx.globalCompositeOperation = "screen";
        ctx.fillStyle = "rgba(" + (lighting.warmColor || "244, 151, 88") + ", " + lighting.warm.toFixed(3) + ")";
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
        ctx.globalCompositeOperation = "source-over";
      }

      if (torches.length > 0) {
        // Keep only a small, low-opacity fire tint at the core. The large
        // radius comes from revealing the darkness layer, not from a veil.
        ctx.globalCompositeOperation = "screen";
        for (const torch of torches) {
          const sx = torch.tx * TILE - camX + TILE / 2;
          const sy = torch.ty * TILE - camY + TILE / 2;
          const flicker = this.reduceMotion ? 1 : 0.92 + Math.sin(time * 11 + torch.id) * 0.08;
          const glow = ctx.createRadialGradient(sx, sy, 2, sx, sy, TORCH_CORE_RADIUS);
          glow.addColorStop(0, "rgba(255, 169, 85, " + (0.17 * flicker).toFixed(3) + ")");
          glow.addColorStop(0.45, "rgba(255, 146, 69, " + (0.08 * flicker).toFixed(3) + ")");
          glow.addColorStop(1, "rgba(255, 130, 60, 0)");
          ctx.fillStyle = glow;
          ctx.fillRect(sx - TORCH_CORE_RADIUS, sy - TORCH_CORE_RADIUS, TORCH_CORE_RADIUS * 2, TORCH_CORE_RADIUS * 2);
        }
        ctx.globalCompositeOperation = "source-over";
      }

      if (activeRespawns.length > 0) {
        ctx.globalCompositeOperation = "screen";
        for (const stele of activeRespawns) {
          const sx = stele.tx * TILE - camX + TILE / 2;
          const sy = stele.ty * TILE - camY + TILE / 2;
          const pulse = this.reduceMotion ? 0.8 : 0.7 + Math.sin(time * 3.4 + stele.id) * 0.3;
          const glow = ctx.createRadialGradient(sx, sy, 2, sx, sy, TILE * 1.9);
          glow.addColorStop(0, "rgba(142, 255, 213, " + (0.18 * pulse).toFixed(3) + ")");
          glow.addColorStop(0.55, "rgba(95, 218, 181, " + (0.08 * pulse).toFixed(3) + ")");
          glow.addColorStop(1, "rgba(76, 190, 160, 0)");
          ctx.fillStyle = glow;
          ctx.fillRect(sx - TILE * 1.9, sy - TILE * 1.9, TILE * 3.8, TILE * 3.8);
        }
        ctx.globalCompositeOperation = "source-over";
      }
    }

    // -------------------------------------------------------------------
    // Terrain tile painting. Uses three per-tile hashes for deterministic
    // variation so light/shadow, blades, cracks and flowers drift smoothly.
    // -------------------------------------------------------------------
    drawTile(type, feature, dug, tileX, tileY, sx, sy, seed, time, col, row, cols, rows, types) {
      const ctx = this.ctx;
      const h0 = hash2(tileX, tileY, seed ^ 0x7a3c1f65);
      const h1 = hash2(tileX, tileY, seed ^ 0x19b7d4c3);
      const h2 = hash2(tileX, tileY, seed ^ 0x5d2e8a11);

      if (type === TERRAIN.OCEAN) {
        const shade = this.macroShade(tileX, tileY, seed ^ 0x41b7e2d9, OCEAN_BASES.length);
        const shallow = this.world.waterDepthAt?.(tileX,tileY) === 1;
        ctx.fillStyle = shallow ? ["#428f96","#48999c","#4c9c9b"][shade%3] : OCEAN_BASES[shade];
        ctx.fillRect(sx, sy, TILE, TILE);
        if (dug) {ctx.fillStyle="rgba(194,219,199,0.16)";ctx.fillRect(sx+5,sy+12,7,1);ctx.fillRect(sx+11,sy+8,3,1);}

        // Faint depth variation.
        if (h2 > 0.66) {
          ctx.fillStyle = "rgba(12, 48, 57, 0.2)";
          const px = 2 + Math.floor(h1 * 13);
          const py = 4 + Math.floor(h2 * 10);
          ctx.fillRect(sx + px, sy + py, 3 + Math.floor(h0 * 3), 2);
        }

        this.drawWaves(tileX, tileY, sx, sy, seed, time, h0, h1);
        this.drawShoreline(sx, sy, col, row, cols, rows, types, h0);
        return;
      }

      if (type === TERRAIN.GRASS) {
        const shade = this.macroShade(tileX, tileY, seed ^ 0x6f31a84b, GRASS_BASES.length);
        ctx.fillStyle = GRASS_BASES[shade];
        ctx.fillRect(sx, sy, TILE, TILE);

        // A sparse shadow clump, not a full-tile pattern.
        if (h2 > 0.7) {
          ctx.fillStyle = "rgba(44, 81, 39, 0.18)";
          const px = 3 + Math.floor(h1 * 12);
          const py = 3 + Math.floor(h0 * 11);
          ctx.fillRect(sx + px, sy + py, 4, 2);
        }

        const bladeCount = 3 + Math.floor(h1 * 3);
        for (let i = 0; i < bladeCount; i += 1) {
          const bh = hash2(tileX * 7 + i, tileY * 5 - i, seed ^ 0x3f6a9c21);
          const px = 2 + Math.floor(bh * (TILE - 5));
          const py = 3 + Math.floor(hash2(tileX - i, tileY * 11 + i, seed ^ 0x6b2f4d87) * (TILE - 7));
          ctx.fillStyle = i % 2 === 0 ? "rgba(177, 202, 126, 0.46)" : "rgba(45, 82, 38, 0.46)";
          ctx.fillRect(sx + px, sy + py, 1, 2);
          if (bh > 0.7) {
            ctx.fillRect(sx + px + 1, sy + py + 1, 1, 1);
          }
        }

        // A few slightly larger tufts.
        if (h1 > 0.58) {
          const tx = 3 + Math.floor(h2 * 12);
          const ty = 5 + Math.floor(h0 * 9);
          ctx.fillStyle = "rgba(147, 176, 102, 0.38)";
          ctx.fillRect(sx + tx, sy + ty, 1, 3);
          ctx.fillRect(sx + tx + 2, sy + ty + 1, 1, 2);
          ctx.fillStyle = "rgba(49, 83, 41, 0.35)";
          ctx.fillRect(sx + tx + 1, sy + ty + 2, 1, 1);
        }

        // Rare wildflowers.
        if (h0 > 0.965) {
          const fx = 5 + Math.floor(h1 * 10);
          const fy = 5 + Math.floor(h2 * 9);
          ctx.fillStyle = "rgba(232, 220, 168, 0.9)";
          ctx.fillRect(sx + fx, sy + fy, 1, 1);
          ctx.fillStyle = "rgba(208, 179, 107, 0.8)";
          ctx.fillRect(sx + fx + 1, sy + fy + 1, 1, 1);
        }

        if (dug) this.drawDugMark(TERRAIN.GRASS, sx, sy, tileX, tileY, seed);

        this.drawLandEdge(type, sx, sy, col, row, cols, rows, types);
        return;
      }

      // Rock
      const shade = this.macroShade(tileX, tileY, seed ^ 0x2c9d6e17, ROCK_BASES.length);
      ctx.fillStyle = ROCK_BASES[shade];
      ctx.fillRect(sx, sy, TILE, TILE);

      if (h1 > 0.5) {
        ctx.fillStyle = "rgba(35, 38, 34, 0.26)";
        const px = 2 + Math.floor(h0 * 12);
        const py = 4 + Math.floor(h2 * 12);
        ctx.fillRect(sx + px, sy + py, 4, 2);
      }

      const crackCount = h0 > 0.55 ? 2 : 1;
      for (let i = 0; i < crackCount; i += 1) {
        const ch = hash2(tileX * 9 - i, tileY * 3 + i, seed ^ 0x4e8c1a2d);
        const px = 3 + Math.floor(ch * (TILE - 8));
        const py = 3 + Math.floor(hash2(tileX + i, tileY - i, seed ^ 0x71d3a6b9) * (TILE - 8));
        ctx.fillStyle = i === 0 ? "rgba(183, 179, 158, 0.3)" : "rgba(42, 45, 40, 0.42)";
        ctx.fillRect(sx + px, sy + py, 1, 3);
        if (i === 0) {
          ctx.fillRect(sx + px + 1, sy + py + 1, 2, 1);
        }
      }

      // A little moss softens some stone tiles.
      if (h2 > 0.82) {
        ctx.fillStyle = "rgba(112, 139, 75, 0.56)";
        ctx.fillRect(sx + 13, sy + 13, 3, 2);
        ctx.fillRect(sx + 15, sy + 12, 1, 2);
      }

      if (dug) this.drawDugMark(TERRAIN.ROCK, sx, sy, tileX, tileY, seed);

      // Occasional boulders give large stone fields a sense of scale.
      // Coal gets the tile to itself so the two dark shapes don't fight.
      if (h0 > 0.875 && feature !== FEATURE.COAL) {
        const bx = 3 + Math.floor(h1 * 9);
        const by = 4 + Math.floor(h2 * 9);
        ctx.fillStyle = "rgba(35, 37, 33, 0.34)";
        ctx.fillRect(sx + bx - 1, sy + by + 4, 8, 2);
        ctx.fillStyle = "rgba(101, 100, 89, 0.9)";
        ctx.fillRect(sx + bx, sy + by, 6, 4);
        ctx.fillStyle = "rgba(137, 134, 119, 0.62)";
        ctx.fillRect(sx + bx + 1, sy + by, 4, 1);
        ctx.fillStyle = "rgba(46, 48, 43, 0.55)";
        ctx.fillRect(sx + bx, sy + by + 3, 6, 1);
      }

      this.drawLandEdge(type, sx, sy, col, row, cols, rows, types);
    }

    macroShade(tileX, tileY, seed, levels) {
      let value = noise2(tileX * 0.085 + 0.7, tileY * 0.085 - 0.4, seed);
      value = 0.5 + (value - 0.5) * 1.8;
      value = Math.max(0, Math.min(0.999, value));
      return Math.floor(value * levels);
    }

    drawWaves(tileX, tileY, sx, sy, seed, time, h0, h1) {
      const ctx = this.ctx;
      const count = 1 + Math.floor(h1 * 3);

      for (let i = 0; i < count; i += 1) {
        const wh = hash2(tileX * 13 + i, tileY * 17 - i, seed ^ 0x2c7f5b91);
        const px = 2 + Math.floor(wh * (TILE - 7));
        const py = 3 + Math.floor(hash2(tileX - i, tileY + i, seed ^ 0x6a19c4d7) * (TILE - 7));
        const width = 2 + Math.floor(hash2(tileX + i, tileY * 3 - i, seed ^ 0x38be72a5) * 4);
        const drift = Math.sin(time * 0.8 + h0 * Math.PI * 2 + i * 1.7) * 1.1;

        ctx.fillStyle = "rgba(151, 204, 196, 0.34)";
        ctx.fillRect(Math.round(sx + px + drift), sy + py, width, 1);

        if (wh > 0.72) {
          ctx.fillStyle = "rgba(206, 231, 215, 0.26)";
          ctx.fillRect(Math.round(sx + px + drift) + width, sy + py - 1, 1, 1);
        }
      }
    }

    drawShoreline(sx, sy, col, row, cols, rows, types, h0) {
      const above = this.neighbour(col, row - 1, cols, rows, types);
      const below = this.neighbour(col, row + 1, cols, rows, types);
      const left = this.neighbour(col - 1, row, cols, rows, types);
      const right = this.neighbour(col + 1, row, cols, rows, types);

      const touchesLand =
        (above !== null && above !== TERRAIN.OCEAN) ||
        (below !== null && below !== TERRAIN.OCEAN) ||
        (left !== null && left !== TERRAIN.OCEAN) ||
        (right !== null && right !== TERRAIN.OCEAN);

      if (!touchesLand) return;

      const ctx = this.ctx;
      const shallow = "rgba(79, 133, 127, 0.62)";
      const foam = "rgba(205, 224, 206, 0.34)";

      if (above !== null && above !== TERRAIN.OCEAN) {
        ctx.fillStyle = shallow;
        ctx.fillRect(sx, sy, TILE, 2);
        ctx.fillStyle = foam;
        const offset = 2 + Math.floor(h0 * 5);
        for (let x = offset; x < TILE - 2; x += 9) {
          ctx.fillRect(sx + x, sy + 1, 2, 1);
        }
      }

      if (below !== null && below !== TERRAIN.OCEAN) {
        ctx.fillStyle = shallow;
        ctx.fillRect(sx, sy + TILE - 2, TILE, 2);
        ctx.fillStyle = foam;
        const offset = 1 + Math.floor(h0 * 5);
        for (let x = offset; x < TILE - 3; x += 10) {
          ctx.fillRect(sx + x, sy + TILE - 2, 2, 1);
        }
      }

      if (left !== null && left !== TERRAIN.OCEAN) {
        ctx.fillStyle = shallow;
        ctx.fillRect(sx, sy, 2, TILE);
        ctx.fillStyle = foam;
        const offset = 2 + Math.floor(h0 * 4);
        for (let y = offset; y < TILE - 2; y += 9) {
          ctx.fillRect(sx + 1, sy + y, 1, 2);
        }
      }

      if (right !== null && right !== TERRAIN.OCEAN) {
        ctx.fillStyle = shallow;
        ctx.fillRect(sx + TILE - 2, sy, 2, TILE);
        ctx.fillStyle = foam;
        const offset = 1 + Math.floor(h0 * 5);
        for (let y = offset; y < TILE - 3; y += 10) {
          ctx.fillRect(sx + TILE - 2, sy + y, 1, 2);
        }
      }

      if (h0 > 0.74) {
        ctx.fillStyle = "rgba(199, 220, 202, 0.24)";
        ctx.fillRect(sx + 4 + Math.floor(((h0 * 37) % 1) * 10), sy + 5 + Math.floor(h0 * 8), 1, 1);
      }
    }

    drawLandEdge(type, sx, sy, col, row, cols, rows, types) {
      const above = this.neighbour(col, row - 1, cols, rows, types);
      const below = this.neighbour(col, row + 1, cols, rows, types);
      const left = this.neighbour(col - 1, row, cols, rows, types);
      const right = this.neighbour(col + 1, row, cols, rows, types);
      const ctx = this.ctx;

      ctx.fillStyle = type === TERRAIN.ROCK
        ? "rgba(24, 46, 38, 0.3)"
        : "rgba(30, 67, 51, 0.24)";

      if (above === TERRAIN.OCEAN) ctx.fillRect(sx, sy, TILE, 1);
      if (below === TERRAIN.OCEAN) ctx.fillRect(sx, sy + TILE - 1, TILE, 1);
      if (left === TERRAIN.OCEAN) ctx.fillRect(sx, sy, 1, TILE);
      if (right === TERRAIN.OCEAN) ctx.fillRect(sx + TILE - 1, sy, 1, TILE);
    }

    neighbour(col, row, cols, rows, types) {
      if (col < 0 || row < 0 || col >= cols || row >= rows) return null;
      return types[row * cols + col];
    }

    drawTree(tileX, tileY, sx, sy, seed) {
      const ctx = this.ctx;
      const h0 = hash2(tileX, tileY, seed ^ 0x1f4a8c6d);
      const h1 = hash2(tileX - 13, tileY + 29, seed ^ 0x6d9b2a41);
      const h2 = hash2(tileX + 7, tileY * 3 + 1, seed ^ 0x2a7f5c13);

      const large = h0 > 0.62;
      const lean = h1 < 0.25 ? -1 : h1 > 0.75 ? 1 : 0;
      const spread = Math.floor(h1 * 3) - 1;
      const cx = sx + Math.floor(TILE / 2) + (large ? 1 : 0);
      const baseY = sy + TILE - 2;
      const topY = baseY - (large ? 28 : 25) + Math.floor(h2 * 2);
      const canopyX = cx + lean;

      // Contact shadow and a couple of roots anchor the tree to the turf.
      ctx.fillStyle = TREE.shadow;
      ctx.beginPath();
      ctx.ellipse(cx, baseY + 1, large ? 9 : 7, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();

      this.pixel(cx - 3, baseY - 2, 2, 2, TREE.trunkDark);
      this.pixel(cx + 2, baseY - 2, 2, 1, TREE.trunkDark);

      // Trunk and a small branch, drawn before the crown.
      this.pixel(cx - 1, topY + 11, 3, baseY - topY - 10, TREE.trunkDark);
      this.pixel(cx, topY + 11, 1, baseY - topY - 11, TREE.trunk);
      this.pixel(cx - 2, topY + 20, 1, 2, TREE.trunkDark);

      // Irregular crown silhouette.
      this.pixel(canopyX - 6, topY + 4, 12, 9, TREE.outline);
      this.pixel(canopyX - 8 + spread, topY + 7, 17, 5, TREE.outline);
      this.pixel(canopyX - 4, topY + 1, 8, 4, TREE.outline);
      this.pixel(canopyX - 2, topY + 13, 5, 3, TREE.outline);
      this.pixel(canopyX + 6, topY + 6, 2, 4, TREE.outline);
      this.pixel(canopyX - 9, topY + 8, 2, 3, TREE.outline);

      // Dark underlayer gives the crown volume.
      this.pixel(canopyX - 5, topY + 5, 10, 7, TREE.dark);
      this.pixel(canopyX - 7 + spread, topY + 8, 15, 3, TREE.dark);
      this.pixel(canopyX - 3, topY + 2, 6, 3, TREE.dark);
      this.pixel(canopyX - 1, topY + 12, 4, 2, TREE.dark);

      // Mid-green leaves.
      this.pixel(canopyX - 4, topY + 5, 7, 5, TREE.mid);
      this.pixel(canopyX - 6 + spread, topY + 8, 12, 2, TREE.mid);
      this.pixel(canopyX - 2, topY + 2, 4, 2, TREE.mid);
      this.pixel(canopyX + 1, topY + 9, 3, 3, TREE.mid);

      // Sunlit leaves and stray silhouette pixels.
      this.pixel(canopyX - 4, topY + 4, 3, 2, TREE.light);
      this.pixel(canopyX + 1, topY + 6, 2, 2, TREE.light);
      this.pixel(canopyX - 6 + spread, topY + 8, 3, 1, TREE.light);
      if (large) this.pixel(canopyX - 1, topY + 10, 2, 1, TREE.light);

      this.pixel(canopyX - 4, topY + 4, 2, 1, TREE.highlight);
      this.pixel(canopyX + 2, topY + 6, 1, 1, TREE.highlight);
      this.pixel(canopyX - 6, topY + 10, 1, 1, TREE.highlight);
      this.pixel(canopyX - 9, topY + 9, 1, 1, TREE.mid);
      this.pixel(canopyX + 8, topY + 8, 1, 1, TREE.mid);
      this.pixel(canopyX + 4, topY + 3, 1, 1, TREE.mid);

      // A grass tuft covers the trunk base and embeds the tree in the turf.
      this.pixel(cx - 5, baseY - 1, 2, 1, "rgba(154, 184, 106, 0.4)");
      this.pixel(cx + 3, baseY - 1, 2, 1, "rgba(154, 184, 106, 0.4)");
    }

    drawSilica(x,y) {
      const ctx=this.ctx;ctx.fillStyle="#315f6a";ctx.fillRect(x+3,y+9,14,6);
      ctx.fillStyle="#8cbfc1";ctx.fillRect(x+5,y+7,4,6);ctx.fillRect(x+11,y+9,4,5);
      ctx.fillStyle="#d2ebe0";ctx.fillRect(x+5,y+7,2,3);ctx.fillRect(x+11,y+9,2,2);
    }

    drawCoal(tileX, tileY, sx, sy, seed) {
      const ctx = this.ctx;
      const h0 = hash2(tileX, tileY, seed ^ 0x5b8d1f27);
      const h1 = hash2(tileX + 17, tileY - 9, seed ^ 0x73c4a08b);
      const h2 = hash2(tileX - 5, tileY + 21, seed ^ 0x2e6f94d1);

      const x = sx + 4 + Math.floor(h0 * 5);
      const y = sy + 5 + Math.floor(h1 * 4);

      // A dusty scuff blends the seam into the surrounding stone.
      ctx.fillStyle = COAL.scuff;
      ctx.fillRect(x - 2, y + 2, 12, 6);
      ctx.fillRect(x + 1, y - 1, 6, 1);

      // Dark angular chunks.
      ctx.fillStyle = COAL.outline;
      ctx.fillRect(x - 1, y + 1, 6, 5);
      ctx.fillRect(x + 4, y + 3, 5, 4);
      ctx.fillRect(x, y + 5, 4, 3);
      ctx.fillRect(x + 6, y + 1, 3, 3);

      ctx.fillStyle = COAL.dark;
      ctx.fillRect(x, y + 2, 4, 3);
      ctx.fillRect(x + 5, y + 4, 3, 2);
      ctx.fillRect(x + 1, y + 6, 2, 1);
      ctx.fillRect(x + 7, y + 2, 1, 1);

      ctx.fillStyle = COAL.mid;
      ctx.fillRect(x, y + 2, 2, 1);
      ctx.fillRect(x + 5, y + 4, 1, 1);
      ctx.fillRect(x + 7, y + 2, 1, 1);

      // A couple of hard, pale facets read as coal under the ground light.
      ctx.fillStyle = COAL.light;
      ctx.fillRect(x + 1, y + 2, 1, 1);
      ctx.fillRect(x + 8, y + 4, 1, 1);

      if (h2 > 0.45) {
        ctx.fillStyle = COAL.glint;
        ctx.fillRect(x + 2, y + 3, 1, 1);
      }

      // Hairline cracks lead away from the seam.
      ctx.fillStyle = "rgba(29, 31, 28, 0.45)";
      ctx.fillRect(x - 2, y + 3, 2, 1);
      ctx.fillRect(x + 9, y + 6, 2, 1);
      ctx.fillRect(x + 3, y + 8, 3, 1);

      // A barely visible stone lip covers the cluster edge.
      ctx.fillStyle = "rgba(122, 119, 104, 0.32)";
      ctx.fillRect(x + 4, y + 2, 1, 1);
      ctx.fillRect(x - 1, y + 6, 1, 1);
    }

    drawDugMark(type, sx, sy, tileX, tileY, seed) {
      const ctx = this.ctx;
      const h = hash2(tileX, tileY, seed ^ 0x4d8b2a67);
      const wobble = Math.floor(h * 3) - 1;

      if (type === TERRAIN.GRASS) {
        // A small exposed patch of soil rather than a missing tile.
        ctx.fillStyle = "rgba(62, 44, 28, 0.62)";
        ctx.fillRect(sx + 6 + wobble, sy + 8, 8, 5);
        ctx.fillStyle = "rgba(94, 68, 42, 0.55)";
        ctx.fillRect(sx + 7 + wobble, sy + 7, 4, 1);
        ctx.fillRect(sx + 10 + wobble, sy + 11, 3, 1);
        ctx.fillStyle = "rgba(42, 31, 21, 0.4)";
        ctx.fillRect(sx + 6 + wobble, sy + 7, 1, 1);
        ctx.fillRect(sx + 13 + wobble, sy + 10, 1, 1);
      } else {
        // A shallow pick scar and loose chips in the stone.
        ctx.fillStyle = "rgba(35, 38, 33, 0.34)";
        ctx.fillRect(sx + 5 + wobble, sy + 8, 10, 4);
        ctx.fillStyle = "rgba(132, 127, 111, 0.34)";
        ctx.fillRect(sx + 7 + wobble, sy + 7, 4, 1);
        ctx.fillRect(sx + 13, sy + 9, 2, 1);
        ctx.fillStyle = "rgba(21, 23, 20, 0.42)";
        ctx.fillRect(sx + 8 + wobble, sy + 9, 1, 3);
        ctx.fillRect(sx + 9 + wobble, sy + 11, 3, 1);
      }
    }

    // -------------------------------------------------------------------
    // Ground drops. Drawn after the player so a drop on the player's own
    // tile is still visible, and above projectiles so arrows pass behind.
    // -------------------------------------------------------------------
    drawDrops(drops, camX, camY, time) {
      const ctx = this.ctx;
      const halos = {
        coal: "rgba(77, 130, 136, 0.22)",
        wood: "rgba(182, 118, 52, 0.24)",
        dirt: "rgba(146, 97, 50, 0.24)",
        rock: "rgba(150, 151, 137, 0.2)",
        workbench: "rgba(184, 128, 66, 0.25)",
        torch: "rgba(238, 145, 62, 0.3)",
        stele: "rgba(158, 160, 144, 0.24)",
        respawn_stele: "rgba(95, 191, 160, 0.3)",
        wool: "rgba(225, 223, 211, 0.24)",
        raw_mutton: "rgba(190, 92, 76, 0.28)",
        algorithm_chicken_leg: "rgba(217, 180, 105, 0.28)",
        zombie_elbow: "rgba(112, 138, 82, 0.28)",
        silk: "rgba(199, 191, 218, 0.24)",
        comfortable_bed: "rgba(196, 76, 67, 0.24)",
        wood_bow: "rgba(173, 132, 72, 0.26)",
      };

      for (let i = 0; i < drops.length; i += 1) {
        const drop = drops[i];
        const offsetX = drop.id % 2 === 0 ? 8 : -8;
        const sx = Math.round(drop.tx * TILE - camX + TILE / 2 + offsetX);
        const sy = Math.round(drop.ty * TILE - camY + TILE / 2 + 7);
        if (sx < -12 || sy < -12 || sx > VIEW_W + 12 || sy > VIEW_H + 12) continue;

        const bob = Math.sin(time * 3.2 + drop.id * 1.7) * 1;

        // A soft type-coloured halo plus a big, readable ground icon.
        ctx.fillStyle = halos[drop.itemId] || "rgba(236, 208, 139, 0.18)";
        ctx.beginPath();
        ctx.ellipse(sx, sy + 3, 9, 4.5, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "rgba(7, 16, 10, 0.35)";
        ctx.beginPath();
        ctx.ellipse(sx, sy + 5, 5, 1.6, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "rgba(236, 208, 139, 0.9)";
        ctx.fillRect(sx - 6, sy - 10 + bob, 2, 2);

        ctx.save();
        ctx.translate(sx, sy + bob);
        ctx.scale(2, 2);
        this.drawDropIcon(drop.itemId, 0, 0);
        ctx.restore();
      }
    }

    drawEquipmentDropIcon(definition, x, y) {
      const ctx = this.ctx;
      const stone = String(definition.id).startsWith("stone_");
      const head = stone ? "#94968a" : "#c18a4c";
      const light = stone ? "#cbc9b6" : "#e4b471";
      const dark = stone ? "#5f6259" : "#87602f";
      const edge = "#29251c";
      const handle = "#764c2b";
      const handleEdge = "#2c1b10";

      if (definition.weaponType === "bow") {
        ctx.fillStyle = "#2b1b10";
        ctx.fillRect(x - 5, y - 6, 2, 2);
        ctx.fillRect(x - 6, y - 4, 2, 2);
        ctx.fillRect(x - 6, y - 2, 2, 6);
        ctx.fillRect(x - 5, y + 4, 2, 2);
        ctx.fillStyle = "#8a5a31";
        ctx.fillRect(x - 4, y - 5, 1, 2);
        ctx.fillRect(x - 5, y - 3, 1, 6);
        ctx.fillRect(x - 4, y + 3, 1, 2);
        ctx.fillStyle = "#ddd6bd";
        ctx.fillRect(x - 4, y - 4, 1, 1);
        ctx.fillRect(x - 3, y - 2, 1, 1);
        ctx.fillRect(x - 2, y, 1, 1);
        ctx.fillRect(x - 3, y + 2, 1, 1);
        ctx.fillRect(x - 4, y + 3, 1, 1);
        ctx.fillStyle = "#d8ccb0";
        ctx.fillRect(x - 1, y - 1, 7, 1);
        ctx.fillRect(x + 5, y - 2, 1, 3);
      } else if (definition.id === "creation_scroll") {
        ctx.fillStyle = "#d7bc7b"; ctx.fillRect(x - 5, y - 3, 10, 7);
        ctx.fillStyle = "#efe0b6"; ctx.fillRect(x - 4, y - 2, 8, 5);
        ctx.fillStyle = "#8d6235"; ctx.fillRect(x - 5, y - 4, 10, 2);
        ctx.fillRect(x - 5, y + 4, 10, 1);
      } else if (definition.toolType === "axe") {
        ctx.fillStyle = handleEdge;
        ctx.fillRect(x - 3, y + 3, 3, 2);
        ctx.fillRect(x - 1, y + 1, 3, 2);
        ctx.fillRect(x + 1, y - 1, 3, 2);
        ctx.fillStyle = handle;
        ctx.fillRect(x - 2, y + 3, 1, 1);
        ctx.fillRect(x, y + 1, 1, 1);
        ctx.fillRect(x + 2, y - 1, 1, 1);
        ctx.fillStyle = edge;
        ctx.fillRect(x - 1, y - 5, 7, 3);
        ctx.fillRect(x + 4, y - 3, 2, 4);
        ctx.fillStyle = head;
        ctx.fillRect(x, y - 4, 5, 2);
        ctx.fillRect(x + 4, y - 2, 1, 2);
        ctx.fillStyle = light;
        ctx.fillRect(x, y - 4, 3, 1);
        ctx.fillStyle = dark;
        ctx.fillRect(x + 3, y - 2, 2, 1);
      } else if (definition.id === "lucian_holy_gun") {
        ctx.fillStyle="#26384e";ctx.fillRect(x-6,y-5,12,4);ctx.fillRect(x-2,y-1,4,7);
        ctx.fillStyle="#bed6e3";ctx.fillRect(x-6,y-5,12,2);ctx.fillRect(x-1,y,2,5);
        ctx.fillStyle="#5bd3ff";ctx.fillRect(x+4,y-4,3,2);
      } else if (definition.toolType === "hoe") {
        ctx.strokeStyle=handleEdge;ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(x-4,y+6);ctx.lineTo(x+1,y-6);ctx.stroke();
        ctx.strokeStyle=handle;ctx.lineWidth=1;ctx.stroke();
        ctx.fillStyle=edge;ctx.beginPath();ctx.moveTo(x,y-6);ctx.lineTo(x+6,y-3);ctx.lineTo(x+5,y+2);ctx.lineTo(x+1,y);ctx.closePath();ctx.fill();
        ctx.fillStyle=head;ctx.beginPath();ctx.moveTo(x+1,y-5);ctx.lineTo(x+5,y-3);ctx.lineTo(x+4,y);ctx.lineTo(x+2,y-1);ctx.closePath();ctx.fill();
        ctx.fillStyle=light;ctx.fillRect(x+2,y-4,2,1);
      } else if (definition.toolType === "pickaxe") {
        ctx.fillStyle = handleEdge;
        ctx.fillRect(x - 1, y - 2, 3, 8);
        ctx.fillStyle = handle;
        ctx.fillRect(x, y - 1, 1, 6);
        ctx.fillStyle = edge;
        ctx.fillRect(x - 6, y - 6, 12, 2);
        ctx.fillRect(x - 5, y - 4, 3, 2);
        ctx.fillRect(x + 2, y - 4, 3, 2);
        ctx.fillStyle = head;
        ctx.fillRect(x - 5, y - 5, 10, 1);
        ctx.fillStyle = light;
        ctx.fillRect(x - 5, y - 5, 3, 1);
        ctx.fillRect(x + 2, y - 5, 3, 1);
      } else if (definition.toolType === "shovel") {
        ctx.fillStyle = handleEdge;
        ctx.fillRect(x - 1, y - 7, 3, 8);
        ctx.fillStyle = handle;
        ctx.fillRect(x, y - 6, 1, 7);
        ctx.fillStyle = edge;
        ctx.fillRect(x - 4, y, 8, 5);
        ctx.fillRect(x - 3, y + 5, 6, 2);
        ctx.fillStyle = head;
        ctx.fillRect(x - 3, y + 1, 6, 4);
        ctx.fillStyle = light;
        ctx.fillRect(x - 3, y + 1, 6, 1);
        ctx.fillStyle = dark;
        ctx.fillRect(x, y + 5, 3, 1);
      } else if (definition.toolType === "sword") {
        ctx.fillStyle = edge;
        ctx.fillRect(x - 1, y - 8, 3, 9);
        ctx.fillRect(x - 5, y, 10, 2);
        ctx.fillRect(x - 1, y + 2, 3, 4);
        ctx.fillStyle = light;
        ctx.fillRect(x, y - 7, 1, 7);
        ctx.fillStyle = head;
        ctx.fillRect(x - 1, y - 7, 1, 7);
        ctx.fillRect(x - 4, y, 8, 1);
        ctx.fillStyle = handle;
        ctx.fillRect(x, y + 2, 1, 3);
        ctx.fillStyle = dark;
        ctx.fillRect(x - 1, y + 5, 3, 1);
      }
    }

    drawDropIcon(itemId, x, y) {
      const ctx = this.ctx;
      const definition = globalThis.Wilds && Wilds.ITEMS ? Wilds.ITEMS[itemId] : null;

      if(["sapling","wheat_seed","rice_seed","wheat","rice","wood_bowl","bread","raw_rice","cooked_rice"].includes(itemId)) {
        this.farmIconImages ||= new Map();
        if(!this.farmIconImages.has(itemId)) {
          const icon=new Image();icon.src="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(definition.icon.replace("<svg ",'<svg xmlns="http://www.w3.org/2000/svg" '));
          this.farmIconImages.set(itemId,icon);
        }
        const icon=this.farmIconImages.get(itemId);
        if(icon.complete&&icon.naturalWidth)ctx.drawImage(icon,x-7,y-7,14,14);
        return;
      }

      if (definition && definition.kind === "equipment") {
        this.drawEquipmentDropIcon(definition, x, y);
      } else if (["wall", "wood_floor", "roof", "wood_door", "wood_fence", "fence_gate"].includes(itemId)) {
        ctx.save(); ctx.translate(x - 5, y - 2); ctx.scale(0.5, 0.5);
        if (itemId === "wood_floor") this.drawFloors([{ type: itemId, tx: 0, ty: 0 }], 0, 0);
        else if (itemId === "roof") {
          this.drawRoofModel(0, -5);
        } else this.drawBuilding({ type: itemId, tx: 0, ty: 0 }, 0, 0);
        ctx.restore();
      } else if(itemId==="blg_gift_box") {
        ctx.fillStyle="#129ba9";ctx.fillRect(x-5,y-3,10,8);ctx.fillStyle="#10c3cf";ctx.fillRect(x-6,y-5,12,3);ctx.fillStyle="#ed4e7a";ctx.fillRect(x-1,y-5,2,10);
      } else if (itemId === "deep_sea_gills") {
        ctx.fillStyle="#703e55";ctx.fillRect(x-3,y-5,6,10);ctx.fillRect(x-5,y-2,10,5);
        ctx.fillStyle="#ce8390";ctx.fillRect(x-2,y-4,4,8);ctx.fillRect(x-4,y-1,8,3);
        ctx.fillStyle="#793f59";for(const row of [-2,0,2])ctx.fillRect(x-2,y+row,5,1);
        ctx.fillStyle="#efd0be";ctx.fillRect(x-3,y-3,1,5);
      } else if (["raw_fish","cooked_fish"].includes(itemId)) {
        ctx.fillStyle=itemId==="raw_fish"?"#8ac8cc":itemId==="cooked_fish"?"#c58c50":"#ad6573";
        ctx.fillRect(x-4,y-2,8,5);ctx.fillRect(x-6,y-3,2,7);ctx.fillStyle="#243c43";ctx.fillRect(x+2,y-1,1,1);
      } else if (["fine_sand","silica","glass","glass_bottle","water_bottle","driftwood"].includes(itemId)) {
        if(itemId==="driftwood") {ctx.save();ctx.translate(x-6,y-6);ctx.scale(0.6,0.6);this.drawFloors([{type:"driftwood",tx:0,ty:0}],0,0);ctx.restore();}
        else {ctx.fillStyle=({fine_sand:"#dbc48f",silica:"#b4e2df",glass:"#a0e2dc",glass_bottle:"#c2efdf",water_bottle:"#57b9dc"})[itemId];ctx.fillRect(x-3,y-3,7,7);ctx.fillStyle="#efffe8";ctx.fillRect(x-2,y-2,1,3);}
      } else if (itemId === "raw_pork" || itemId === "cooked_pork") {
        ctx.fillStyle = itemId === "raw_pork" ? "#d68489" : "#a65e38";
        ctx.fillRect(x - 4, y - 3, 9, 7);
        ctx.fillStyle = itemId === "raw_pork" ? "#f4c4b9" : "#d69b60";
        ctx.fillRect(x - 3, y - 2, 6, 2); ctx.fillRect(x - 3, y, 2, 3);
      } else if (itemId === "animal_manure") {
        ctx.fillStyle = "#725039";
        ctx.fillRect(x - 5, y + 1, 10, 3); ctx.fillRect(x - 3, y - 2, 6, 3); ctx.fillRect(x - 1, y - 4, 3, 2);
        ctx.fillStyle = "#a07b4a"; ctx.fillRect(x - 3, y + 1, 4, 1);
      } else if (itemId === "spider_leg") {
        ctx.fillStyle = "#51444f";
        ctx.fillRect(x - 5, y - 4, 3, 3); ctx.fillRect(x - 3, y - 2, 5, 2); ctx.fillRect(x + 1, y, 2, 5);
        ctx.fillStyle = "#94727f"; ctx.fillRect(x - 4, y - 4, 1, 2);
      } else if (itemId === "wool") {
        ctx.fillStyle = "#d7d5ca"; ctx.fillRect(x - 4, y - 3, 8, 6);
        ctx.fillStyle = "#f0eee3"; ctx.fillRect(x - 3, y - 4, 6, 2);
        ctx.fillStyle = "#aaa89f"; ctx.fillRect(x - 3, y + 2, 6, 1);
      } else if (itemId === "raw_mutton") {
        ctx.fillStyle = "#a65b4d"; ctx.fillRect(x - 4, y - 2, 8, 5);
        ctx.fillStyle = "#c77863"; ctx.fillRect(x - 3, y - 3, 6, 2);
        ctx.fillStyle = "#e7ddc8"; ctx.fillRect(x - 5, y, 2, 3);
        ctx.fillStyle = "#e0a28d"; ctx.fillRect(x, y - 1, 2, 1);
      } else if (itemId === "algorithm_chicken_leg") {
        ctx.fillStyle = "#d7b26a"; ctx.fillRect(x - 4, y - 2, 6, 5);
        ctx.fillStyle = "#efd393"; ctx.fillRect(x - 3, y - 3, 4, 2);
        ctx.fillStyle = "#d8d5c7"; ctx.fillRect(x + 2, y + 1, 3, 2);
        ctx.fillStyle = "#eeeadd"; ctx.fillRect(x + 4, y + 3, 1, 2);
      } else if (itemId === "zombie_elbow") {
        ctx.fillStyle = "#687b4f"; ctx.fillRect(x - 4, y - 2, 7, 5);
        ctx.fillStyle = "#829665"; ctx.fillRect(x - 3, y - 3, 5, 2);
        ctx.fillStyle = "#d9d1bd"; ctx.fillRect(x + 3, y + 1, 2, 2);
      } else if (itemId === "silk") {
        ctx.fillStyle = "#d7d2e0"; ctx.fillRect(x - 4, y - 4, 8, 8);
        ctx.fillStyle = "#eee9f4"; ctx.fillRect(x - 3, y - 3, 6, 6);
        ctx.fillStyle = "#b7aec9"; ctx.fillRect(x - 1, y - 2, 1, 4);
      } else if (itemId === "comfortable_bed") {
        ctx.fillStyle = "#3b2718"; ctx.fillRect(x - 5, y - 1, 10, 4);
        ctx.fillStyle = "#e4e0d0"; ctx.fillRect(x - 4, y - 2, 8, 2);
        ctx.fillStyle = "#b5483d"; ctx.fillRect(x - 4, y, 8, 3);
        ctx.fillStyle = "#f2eee0"; ctx.fillRect(x - 4, y - 4, 3, 2);
      } else if (itemId === "storage_chest") {
        ctx.fillStyle = "#6b4629"; ctx.fillRect(x - 5, y - 3, 10, 7);
        ctx.fillStyle = "#8b6037"; ctx.fillRect(x - 5, y - 4, 10, 2);
        ctx.fillStyle = "#c9a25b"; ctx.fillRect(x - 1, y - 4, 2, 8);
      } else if (itemId === "furnace") {
        ctx.fillStyle = "#6e6c61"; ctx.fillRect(x - 5, y - 4, 10, 9);
        ctx.fillStyle = "#2b241d"; ctx.fillRect(x - 3, y, 6, 4);
        ctx.fillStyle = "#e28745"; ctx.fillRect(x - 2, y + 1, 4, 2);
      } else if (itemId === "cooked_mutton") {
        ctx.fillStyle = "#8f4e35"; ctx.fillRect(x - 4, y - 2, 8, 5);
        ctx.fillStyle = "#f0e4c8"; ctx.fillRect(x - 5, y, 2, 3);
      } else if (itemId === "cooked_algorithm_chicken_leg") {
        ctx.fillStyle = "#b87b3d"; ctx.fillRect(x - 4, y - 2, 6, 5);
        ctx.fillStyle = "#e4e0d1"; ctx.fillRect(x + 2, y + 1, 3, 2);
      } else if (itemId === "strange_waste") {
        ctx.fillStyle = "#6a6745"; ctx.fillRect(x - 4, y - 2, 8, 5);
        ctx.fillStyle = "#8a855e"; ctx.fillRect(x - 2, y - 1, 2, 1);
      } else if (itemId === "workbench") {
        // A compact crafting bench silhouette.
        ctx.fillStyle = "#2b1c0f";
        ctx.fillRect(x - 6, y - 3, 12, 5);
        ctx.fillRect(x - 5, y + 2, 2, 4);
        ctx.fillRect(x + 3, y + 2, 2, 4);
        ctx.fillStyle = "#9c6a3c";
        ctx.fillRect(x - 5, y - 2, 10, 2);
        ctx.fillStyle = "#c6935a";
        ctx.fillRect(x - 5, y - 3, 10, 1);
        ctx.fillStyle = "#d0cdb9";
        ctx.fillRect(x + 1, y - 5, 4, 2);
        ctx.fillStyle = "#f0ebd2";
        ctx.fillRect(x + 2, y - 5, 2, 1);
      } else if (itemId === "torch") {
        // A burning torch with a bright flame.
        ctx.fillStyle = "#2b1a0e";
        ctx.fillRect(x - 1, y - 1, 3, 6);
        ctx.fillStyle = "#7a4d2d";
        ctx.fillRect(x, y - 1, 1, 5);
        ctx.fillStyle = "#d65c24";
        ctx.fillRect(x - 3, y - 5, 6, 3);
        ctx.fillStyle = "#f0a33b";
        ctx.fillRect(x - 2, y - 7, 4, 4);
        ctx.fillStyle = "#ffe18b";
        ctx.fillRect(x - 1, y - 8, 2, 3);
      } else if (itemId === "stele") {
        // A small inscribed stone tablet.
        ctx.fillStyle = "#242722";
        ctx.fillRect(x - 5, y - 5, 10, 10);
        ctx.fillStyle = "#73766a";
        ctx.fillRect(x - 4, y - 4, 8, 8);
        ctx.fillStyle = "#8f9183";
        ctx.fillRect(x - 3, y - 4, 6, 7);
        ctx.fillStyle = "#c0bea8";
        ctx.fillRect(x - 3, y - 3, 6, 1);
        ctx.fillStyle = "#4e5148";
        ctx.fillRect(x - 2, y - 1, 4, 1);
        ctx.fillRect(x - 1, y + 1, 3, 1);
        ctx.fillStyle = "#4c4f45";
        ctx.fillRect(x - 5, y + 5, 10, 2);
      } else if (itemId === "respawn_stele") {
        // A small rune pillar with a teal life-rune.
        ctx.fillStyle = "#232821";
        ctx.fillRect(x - 4, y - 5, 8, 11);
        ctx.fillRect(x - 5, y + 5, 10, 2);
        ctx.fillStyle = "#7a8272";
        ctx.fillRect(x - 3, y - 4, 6, 9);
        ctx.fillStyle = "#a8b09c";
        ctx.fillRect(x - 3, y - 4, 1, 9);
        ctx.fillStyle = "#2e776a";
        ctx.fillRect(x - 1, y - 2, 3, 5);
        ctx.fillStyle = "#7ad0b1";
        ctx.fillRect(x, y - 3, 1, 5);
        ctx.fillStyle = "#5f6255";
        ctx.fillRect(x - 4, y + 5, 8, 1);
      } else if (itemId === "wood") {
        // Two short logs with pale end grain.
        ctx.fillStyle = "#24160d";
        ctx.fillRect(x - 5, y - 3, 10, 4);
        ctx.fillRect(x - 4, y + 1, 9, 4);
        ctx.fillStyle = "#794724";
        ctx.fillRect(x - 4, y - 2, 8, 2);
        ctx.fillRect(x - 3, y + 2, 7, 2);
        ctx.fillStyle = "#aa6d36";
        ctx.fillRect(x - 4, y - 2, 6, 1);
        ctx.fillRect(x - 3, y + 2, 5, 1);
        ctx.fillStyle = "#e1a75c";
        ctx.fillRect(x + 3, y - 2, 2, 2);
        ctx.fillRect(x + 2, y + 2, 2, 2);
        ctx.fillStyle = "#8b5629";
        ctx.fillRect(x + 4, y - 1, 1, 1);
        ctx.fillRect(x + 3, y + 3, 1, 1);
      } else if (itemId === "coal") {
        // Jet-black angular chunks with cool metallic faces.
        ctx.fillStyle = "#050a0b";
        ctx.fillRect(x - 5, y - 1, 5, 5);
        ctx.fillRect(x - 1, y - 3, 4, 4);
        ctx.fillRect(x + 2, y, 4, 4);
        ctx.fillStyle = "#172326";
        ctx.fillRect(x - 4, y, 3, 3);
        ctx.fillRect(x, y - 2, 2, 2);
        ctx.fillRect(x + 3, y + 1, 2, 2);
        ctx.fillStyle = "#4d7075";
        ctx.fillRect(x - 3, y, 1, 1);
        ctx.fillRect(x, y - 2, 1, 1);
        ctx.fillRect(x + 3, y + 1, 1, 1);
        ctx.fillStyle = "#a6c6c3";
        ctx.fillRect(x + 1, y - 1, 1, 1);
      } else if (itemId === "dirt") {
        // A soil clod with a grassy sprout.
        ctx.fillStyle = "#291a0e";
        ctx.fillRect(x - 4, y - 2, 9, 5);
        ctx.fillRect(x - 2, y - 3, 6, 1);
        ctx.fillStyle = "#704a27";
        ctx.fillRect(x - 3, y - 1, 7, 3);
        ctx.fillRect(x - 1, y - 2, 4, 1);
        ctx.fillStyle = "#966439";
        ctx.fillRect(x - 2, y - 1, 4, 1);
        ctx.fillStyle = "#bb844d";
        ctx.fillRect(x, y - 2, 1, 1);
        ctx.fillStyle = "#5d963f";
        ctx.fillRect(x, y - 6, 1, 3);
        ctx.fillRect(x - 1, y - 5, 1, 1);
        ctx.fillStyle = "#8fc063";
        ctx.fillRect(x + 1, y - 5, 1, 1);
      } else if (itemId === "rock") {
        // A large grey boulder with a bright top facet.
        ctx.fillStyle = "#222522";
        ctx.fillRect(x - 5, y - 2, 10, 5);
        ctx.fillRect(x - 3, y - 3, 6, 1);
        ctx.fillStyle = "#717468";
        ctx.fillRect(x - 4, y - 1, 8, 3);
        ctx.fillRect(x - 2, y - 2, 5, 1);
        ctx.fillStyle = "#9c9d8d";
        ctx.fillRect(x - 3, y - 1, 4, 1);
        ctx.fillStyle = "#c0bea7";
        ctx.fillRect(x - 2, y - 2, 2, 1);
        ctx.fillStyle = "#4a4d45";
        ctx.fillRect(x + 3, y + 1, 1, 1);
        ctx.fillRect(x + 1, y + 1, 1, 1);
      } else {
        ctx.fillStyle = "#20261f";
        ctx.fillRect(x - 3, y - 4, 6, 7);
        ctx.fillStyle = "#a9b1a9";
        ctx.fillRect(x - 2, y - 3, 4, 5);
        ctx.fillStyle = "#c9cdbd";
        ctx.fillRect(x - 1, y - 2, 2, 2);
      }
    }

    drawMiningTarget(target, camX, camY) {
      const ctx = this.ctx;
      const sx = Math.round(target.tx * TILE - camX);
      const sy = Math.round(target.ty * TILE - camY);
      const active = Boolean(target.active);

      ctx.strokeStyle = active ? "rgba(244, 216, 143, 0.95)" : "rgba(244, 216, 143, 0.55)";
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + 1, sy + 1, TILE - 2, TILE - 2);

      if (!active) return;

      ctx.fillStyle = "rgba(244, 216, 143, 0.07)";
      ctx.fillRect(sx + 2, sy + 2, TILE - 4, TILE - 4);

      const progress = Math.max(0, Math.min(1, target.progress || 0));
      const barWidth = TILE - 8;
      ctx.fillStyle = "rgba(5, 12, 8, 0.58)";
      ctx.fillRect(sx + 4, sy + 3, barWidth, 2);
      ctx.fillStyle = "#e9cf86";
      ctx.fillRect(sx + 4, sy + 3, Math.max(1, Math.round(barWidth * progress)), 2);
    }

    drawDiveBubbles(time) {
      const ctx = this.ctx;
      const bubbles = [
        { x: -10, y: 6, phase: 0.08, speed: 0.22, size: 1 },
        { x: -6, y: 9, phase: 0.43, speed: 0.31, size: 1 },
        { x: 8, y: 7, phase: 0.71, speed: 0.2, size: 2 },
        { x: 12, y: 4, phase: 0.27, speed: 0.34, size: 1 },
        { x: 2, y: 10, phase: 0.59, speed: 0.26, size: 1 },
      ];

      for (let i = 0; i < bubbles.length; i += 1) {
        const bubble = bubbles[i];
        const cycle = (time * bubble.speed + bubble.phase) % 1;
        const x = CENTER_X + bubble.x + Math.sin((time + bubble.phase) * 1.7) * 1.5;
        const y = CENTER_Y + bubble.y - cycle * 23;
        const alpha = (1 - cycle) * 0.42;

        ctx.fillStyle = "rgba(195, 233, 227, " + alpha.toFixed(3) + ")";
        ctx.fillRect(Math.round(x), Math.round(y), bubble.size, bubble.size);
      }
    }

    drawPlayer(player) {
      const ctx = this.ctx;
      const cx = CENTER_X;
      const cy = CENTER_Y;
      const moving = player.moving;
      const phase = this.reduceMotion ? 0 : player.walkPhase * Math.PI * 2;
      const bob = moving && !this.reduceMotion ? (Math.sin(phase * 2) >= 0 ? 0 : -1) : 0;
      const stride = moving && !this.reduceMotion ? Math.sin(phase) : 0;
      const facing = player.facing;

      // Contact shadow, or a pair of ripples while submerged.
      if (player.isDiving) {
        ctx.fillStyle = "rgba(192, 230, 222, 0.12)";
        ctx.beginPath();
        ctx.ellipse(cx, cy + 8, 9, 2.6, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = "rgba(193, 233, 225, 0.28)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(cx, cy + 8, 13, 3.7, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = PLAYER.shadow;
        ctx.beginPath();
        ctx.ellipse(cx, cy + 8, 8, 2.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      const bodyY = cy - 2 + bob;

      // Legs and boots. The two legs take turns lifting.
      const legOffset = Math.round(stride * 1.5);
      const leftLift = legOffset > 0 ? 1 : 0;
      const rightLift = legOffset < 0 ? 1 : 0;

      this.pixel(cx - 4, bodyY + 5, 3, 4 - leftLift, PLAYER.pants);
      this.pixel(cx + 1, bodyY + 5, 3, 4 - rightLift, PLAYER.pants);
      this.pixel(cx - 4, bodyY + 8 - leftLift, 3, 2, PLAYER.boot);
      this.pixel(cx + 1, bodyY + 8 - rightLift, 3, 2, PLAYER.boot);

      if (facing === "left" || facing === "right") {
        const backX = facing === "right" ? cx - 6 : cx + 3;
        this.pixel(backX, bodyY, 3, 5, PLAYER.packShade);
        this.pixel(backX, bodyY + 1, 1, 1, PLAYER.pack);
      }

      // Cloak silhouette and highlight.
      this.pixel(cx - 5, bodyY, 10, 7, PLAYER.outline);
      this.pixel(cx - 4, bodyY + 1, 8, 6, PLAYER.cloak);
      this.pixel(cx - 4, bodyY + 1, 2, 4, PLAYER.cloakLight);
      this.pixel(cx + 2, bodyY + 2, 2, 5, PLAYER.cloakShade);
      this.pixel(cx - 4, bodyY + 5, 8, 1, PLAYER.hatBand);
      this.pixel(cx - 4, bodyY, 8, 1, PLAYER.scarf);

      // Arms.
      this.pixel(cx - 5, bodyY + 2, 1, 3, PLAYER.skinShade);
      this.pixel(cx + 4, bodyY + 2, 1, 3, PLAYER.skinShade);

      // Walking away puts the pack over the cloak.
      if (facing === "up") {
        this.pixel(cx - 4, bodyY + 1, 8, 5, PLAYER.packShade);
        this.pixel(cx - 3, bodyY + 1, 6, 4, PLAYER.pack);
        this.pixel(cx - 3, bodyY + 1, 1, 4, "rgba(255, 238, 198, 0.2)");
        this.pixel(cx - 4, bodyY + 5, 8, 1, PLAYER.hatBand);
        this.pixel(cx - 5, bodyY + 2, 1, 3, PLAYER.hatBand);
        this.pixel(cx + 4, bodyY + 2, 1, 3, PLAYER.hatBand);
      }

      // Head and hat.
      this.pixel(cx - 4, cy - 10 + bob, 8, 7, PLAYER.outline);
      this.pixel(cx - 3, cy - 9 + bob, 6, 5, PLAYER.skin);

      if (facing === "up") {
        this.pixel(cx - 3, cy - 9 + bob, 6, 4, PLAYER.hair);
        this.pixel(cx - 3, cy - 5 + bob, 6, 1, PLAYER.skinShade);
      } else if (facing === "left") {
        this.pixel(cx - 3, cy - 9 + bob, 3, 4, PLAYER.hair);
        this.pixel(cx - 4, cy - 7 + bob, 1, 1, PLAYER.outline);
      } else if (facing === "right") {
        this.pixel(cx, cy - 9 + bob, 3, 4, PLAYER.hair);
        this.pixel(cx + 3, cy - 7 + bob, 1, 1, PLAYER.outline);
      } else {
        this.pixel(cx - 3, cy - 9 + bob, 6, 2, PLAYER.hair);
        this.pixel(cx - 2, cy - 7 + bob, 1, 1, PLAYER.outline);
        this.pixel(cx + 1, cy - 7 + bob, 1, 1, PLAYER.outline);
        this.pixel(cx - 1, cy - 5 + bob, 2, 1, PLAYER.skinShade);
      }

      // Hat brim, band, crown.
      this.pixel(cx - 7, cy - 12 + bob, 14, 3, PLAYER.outline);
      this.pixel(cx - 6, cy - 12 + bob, 12, 1, PLAYER.hatShade);
      this.pixel(cx - 6, cy - 11 + bob, 12, 1, PLAYER.hat);
      this.pixel(cx - 4, cy - 13 + bob, 8, 1, PLAYER.hatBand);
      this.pixel(cx - 4, cy - 16 + bob, 8, 3, PLAYER.outline);
      this.pixel(cx - 3, cy - 16 + bob, 6, 3, PLAYER.hat);
      this.pixel(cx - 2, cy - 16 + bob, 3, 1, PLAYER.hatLight);

      if (facing === "left") {
        this.pixel(cx - 8, cy - 11 + bob, 1, 1, PLAYER.hatLight);
      } else if (facing === "right") {
        this.pixel(cx + 7, cy - 11 + bob, 1, 1, PLAYER.hatLight);
      }

      // Both water depths cover the waist; only deep water uses diving effects.
      if (player.isDiving || player.isWading) {
        ctx.fillStyle = "rgba(20, 78, 88, 0.26)";
        ctx.fillRect(cx - 8, cy + 2, 16, 8);
        ctx.fillStyle = "rgba(183, 228, 220, 0.22)";
        ctx.fillRect(cx - 9, cy + 2, 18, 1);
      }
    }

    // Small helper: fill a rect (all pixel art is drawn via this).
    pixel(x, y, width, height, color) {
      this.ctx.fillStyle = color;
      this.ctx.fillRect(x, y, width, height);
    }
  }

  globalThis.Wilds = Object.assign(globalThis.Wilds || {}, { Renderer });
})();
