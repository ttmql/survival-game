/* Player state and movement. The camera always derives from this position. */
(function () {
  "use strict";

  const { CONFIG, TERRAIN, featureBlocksMovement } = Wilds;

  class Player {
    constructor(world) {
      this.world = world;
      this.reset(world);
    }

    // (Re)build the player from a freshly generated world. Called on
    // construction, on world regenerate, and on respawn.
    reset(world) {
      const spawn = world.findSpawn();
      this.world = world;
      this.spawn = spawn;
      // Position is the pixel-centre of the spawn tile; the camera is
      // always derived from this.x / this.y.
      this.x = (spawn.tx + 0.5) * CONFIG.TILE_SIZE;
      this.y = (spawn.ty + 0.5) * CONFIG.TILE_SIZE;
      this.facing = "down";
      this.moving = false;
      this.walkPhase = 0;
      this.speed = 0;
      this.portalFrozen = false;
      this.portalOwner = null;
      this.cameraOffset = null;
      this.creative = false;
      this.fastTravel = false;

      this.maxHealth = CONFIG.HEALTH_MAX;
      this.health = this.maxHealth;
      this.maxOxygen = CONFIG.OXYGEN_MAX;
      this.oxygen = this.maxOxygen;
      this.maxSatiety = CONFIG.SATIETY_MAX;
      this.satiety = this.maxSatiety;
      this.clearNegativeEffects();
      this.deathCause = null;
      this.summonerSpeedFactor = 1;
      this.summonerShielded = false;
      // Base unarmed damage; the game adds the held weapon's attackBonus.
      this.baseAttackDamage = 5;
      this.attackDamage = this.baseAttackDamage;
      this.isDiving = this.waterDepth === 2;
      this.isWading = this.waterDepth === 1;
    }

    get tileX() {
      return Math.floor(this.x / CONFIG.TILE_SIZE);
    }

    get tileY() {
      return Math.floor(this.y / CONFIG.TILE_SIZE);
    }

    get terrain() {
      return this.world.terrainAt(this.tileX, this.tileY);
    }

    get waterDepth() {
      if (this.isSupportedTile?.(this.tileX, this.tileY)) return 0;
      if (this.terrain !== TERRAIN.OCEAN) return 0;
      return this.world.waterDepthAt ? this.world.waterDepthAt(this.tileX, this.tileY) : 2;
    }

    get isOnOcean() {
      return this.terrain === TERRAIN.OCEAN;
    }

    /**
     * Move from a normalized input vector. Diagonal movement is normalized
     * to a unit vector, then resolved per-axis so the player slides along a
     * tree/wall instead of stopping dead when only one axis is blocked.
     */
    update(dt, axisX, axisY, sprinting) {
      if (this.portalFrozen) { this.moving = false; this.speed = 0; return; }
      let dx = axisX;
      let dy = axisY;
      const length = Math.hypot(dx, dy);

      this.moving = length > 0.001;

      if (!this.moving) {
        this.speed = 0;
        return;
      }

      dx /= length;
      dy /= length;

      const targetSpeed = (sprinting ? CONFIG.PLAYER_SPRINT_SPEED : CONFIG.PLAYER_SPEED) *
        this.speedFactor * this.summonerSpeedFactor * (this.creative && this.fastTravel ? 5 : 1);
      this.speed = targetSpeed;

      // Resolve axes independently so the player can slide along a tree.
      const stepX = dx * targetSpeed * dt;
      const stepY = dy * targetSpeed * dt;

      if (this.canOccupy(this.x + stepX, this.y)) {
        this.x += stepX;
      }

      if (this.canOccupy(this.x, this.y + stepY)) {
        this.y += stepY;
      }

      // Horizontal movement takes visual precedence on diagonals.
      if (Math.abs(dx) >= Math.abs(dy)) {
        this.facing = dx > 0 ? "right" : "left";
      } else {
        this.facing = dy > 0 ? "down" : "up";
      }

      this.walkPhase = (this.walkPhase + dt * (sprinting ? 2.55 : 2.05)) % 1;
    }

    /**
     * Trees occupy their anchor tile. The footprint is kept close to the
     * feet so the character can pass through one-tile gaps.
     */
    canOccupy(x, y) {
      if (typeof this.isBlockedArea === "function") return !this.isBlockedArea(x - 4, y + 1, x + 4, y + 8);
      const halfWidth = 4;
      const footTop = y + 1;
      const footBottom = y + 8;
      const minTileX = Math.floor((x - halfWidth) / CONFIG.TILE_SIZE);
      const maxTileX = Math.floor((x + halfWidth) / CONFIG.TILE_SIZE);
      const minTileY = Math.floor(footTop / CONFIG.TILE_SIZE);
      const maxTileY = Math.floor(footBottom / CONFIG.TILE_SIZE);

      for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
        for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
          if (
            featureBlocksMovement(this.world.featureAt(tileX, tileY)) ||
            (typeof this.isBlockedTile === "function" && this.isBlockedTile(tileX, tileY))
          ) {
            return false;
          }
        }
      }

      return true;
    }

    /**
     * Oxygen is consumed while standing in ocean water and recovers on
     * land. Once the lungs are empty, staying underwater damages health.
     * Empty satiety drains health in real seconds; full-satiety regeneration
     * is handled by Game.updateSurvival using the game clock.
     */
    updateVitals(dt) {
      if (this.creative) { this.isDiving = this.waterDepth === 2; this.isWading = this.waterDepth === 1; return; }
      // Starvation uses real simulation seconds, just like oxygen/drowning.
      if (this.satiety <= 0) {
        this.takeDamage(dt * CONFIG.STARVATION_DAMAGE_PER_SECOND, { type: "starvation" });
      }
      const depth = this.waterDepth;
      const inWater = depth === 2;
      this.isDiving = inWater;
      this.isWading = depth === 1;

      if (inWater) {
        if (this.oxygen > 0) {
          this.oxygen = Math.max(0, this.oxygen - dt * CONFIG.OXYGEN_DRAIN_PER_SECOND);
        } else {
          this.takeDamage(dt * CONFIG.DROWN_DAMAGE_PER_SECOND, { type: "drowning" });
        }
      } else {
        this.oxygen = Math.min(
          this.maxOxygen,
          this.oxygen + dt * CONFIG.OXYGEN_REGEN_PER_SECOND
        );
      }
    }

    // Poison stacks by extending duration and adding total damage, which is
    // then spread evenly across the remaining hours in updateEffects.
    takeDamage(amount, cause = { type: "unknown" }) {
      if (this.creative || this.portalFrozen || this.summonerShielded || this.health <= 0 || !Number.isFinite(amount) || amount <= 0) return;
      this.health = Math.max(0, this.health - amount);
      // Freeze the actual lethal source; later damage cannot overwrite it.
      if (this.health <= 0) this.deathCause = { ...cause };
    }

    clearNegativeEffects() {
      this.manureDietHours = 0;
      this.poisonRemainingHours = 0;
      this.poisonDamageRemaining = 0;
      this.poisonSources = [];
      this.slowRemainingHours = 0;
      this.speedFactor = 1;
    }

    applyPoison(damage, gameHours, source = null) {
      if (this.creative) return;
      const hours = Math.max(0, Number(gameHours) || 0);
      const total = Math.max(0, Number(damage) || 0);
      if (hours <= 0 || total <= 0) return;
      if (this.poisonRemainingHours <= 0 || this.poisonDamageRemaining <= 0) this.poisonSources = [];
      this.poisonRemainingHours = Math.max(this.poisonRemainingHours, hours);
      this.poisonDamageRemaining += total;
      this.poisonSources.push({ remaining: total, cause: { type: "food", name: source?.name, itemId: source?.id } });
    }

    applySlow(gameHours, factor) {
      if (this.creative) return;
      const hours = Math.max(0, Number(gameHours) || 0);
      if (hours <= 0) return;
      this.slowRemainingHours = Math.max(this.slowRemainingHours, hours);
      this.speedFactor = Math.max(0.05, Math.min(1, Number(factor) || 1));
    }

    /**
     * Apply poison (damage over time) and slow (speed penalty) state.
     * Durations are in-game hours; `gameHoursDelta` comes from the clock.
     */
    updateEffects(gameHoursDelta) {
      if (this.creative) return;
      const hours = Math.max(0, Number(gameHoursDelta) || 0);
      if (hours <= 0) return;
      this.manureDietHours = Math.max(0, (this.manureDietHours || 0) - hours);

      if (this.poisonRemainingHours > 0) {
        const step = Math.min(hours, this.poisonRemainingHours);
        const rate = this.poisonDamageRemaining / Math.max(this.poisonRemainingHours, 0.0001);
        const damage = rate * step;
        if (this.poisonSources.length) {
          const total = this.poisonSources.reduce((sum, source) => sum + source.remaining, 0);
          for (const source of this.poisonSources) {
            const share = total > 0 ? damage * source.remaining / total : 0;
            this.takeDamage(share, source.cause);
            source.remaining = Math.max(0, source.remaining - share);
          }
        } else this.takeDamage(damage, { type: "food" });
        this.poisonRemainingHours -= step;
        this.poisonDamageRemaining = Math.max(0, this.poisonDamageRemaining - rate * step);
        if (this.poisonRemainingHours <= 0.0001) {
          this.poisonRemainingHours = 0;
          this.poisonDamageRemaining = 0;
          this.poisonSources = [];
        }
      }

      if (this.slowRemainingHours > 0) {
        this.slowRemainingHours = Math.max(0, this.slowRemainingHours - hours);
        if (this.slowRemainingHours <= 0) {
          this.slowRemainingHours = 0;
          this.speedFactor = 1;
        }
      }
    }
  }

  globalThis.Wilds = Object.assign(globalThis.Wilds || {}, { Player });
})();
