/* The bracelet shares one selected spell across the entire equipment bar. */
(function () {
  "use strict";

  const TILE = Wilds.CONFIG.TILE_SIZE;
  const RANGE = 120 * TILE;
  const CHANNEL_SECONDS = 5;
  const EPSILON = 1e-8;
  const SPELLS = Object.freeze({
    flash: { name: "闪现", description: "你可以向鼠标方向瞬移一段距离", cooldown: 60, color: "#ffe377" },
    teleport: { name: "传送", description: "你可以主动传送至你选择的地方，最大范围120格", cooldown: 120, color: "#77d7ff" },
    ignite: { name: "引燃", description: "你可以对最近单位施加持续恒温火烤", cooldown: 60, color: "#ff793e", targeted: true },
    smite: { name: "惩戒", description: "你可以对最近单位造成大量伤害，如果导致目标死亡，目标掉落物×2", cooldown: 60, color: "#ffcc68", targeted: true },
    heal: { name: "治疗", description: "使用后加速运动30%并且三秒内每秒恢复20点血量", cooldown: 60, color: "#80f9a0" },
    barrier: { name: "屏障", description: "三秒内获得无敌护盾，抵挡一切伤害", cooldown: 60, color: "#ffe596" },
    exhaust: { name: "虚弱", description: "你可以对最近单位挂上虚弱，8秒内其受到伤害翻倍", duration: 8, cooldown: 60, color: "#c3a4ff", targeted: true },
    ghost: { name: "疾跑", description: "使用后8秒内移动速度翻倍", duration: 8, cooldown: 35, color: "#9fceff" },
    cleanse: { name: "净化", description: "使用后移除所有负面效果", cooldown: 60, color: "#b2fff4" },
  });

  class SummonerBracelet {
    constructor(game) {
      this.game = game;
      this.selection = "flash";
      this.time = 0;
      this.channel = null;
      this.heal = null;
      this.barrierUntil = 0;
      this.ghostUntil = 0;
      this.bursts = [];
    }

    get spell() { return SPELLS[this.selection]; }

    equipped() {
      for (const binding of this.game.skillBindings?.values() || []) {
        if (binding.item.skill === "summoner") return binding;
      }
      return null;
    }

    remaining(item) {
      return this.game.holyGunRemaining(item?.stack);
    }

    select(id) {
      if (!Object.hasOwn(SPELLS, id) || this.channel) return false;
      const item = this.equipped();
      if (!item || this.remaining(item) > 0) return false;
      this.selection = id;
      return true;
    }

    teleportPlan(point, fromMap) {
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
      const { game } = this;
      const tx = Math.floor(point.x / TILE), ty = Math.floor(point.y / TILE);
      const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
      const distance = Math.hypot(x - game.player.x, y - game.player.y);
      const explored = !fromMap || game.explored.has(game.tileKey(tx, ty));
      return { x, y, valid: distance <= RANGE && explored && game.player.canOccupy(x, y) };
    }

    teleportPreview(point, fromMap) {
      const item = this.selection === "teleport" && this.equipped();
      if (!item || this.game.player.portalFrozen) return null;
      const plan = this.teleportPlan(point, fromMap);
      if (plan) plan.valid &&= !this.channel && this.remaining(item) <= 0;
      return plan;
    }

    worldPreview() {
      const { game } = this;
      if (this.selection !== "teleport" || !game.pointerInside || !game.canUseWorldInput()) return null;
      if (game.getHeldEquipment()?.item.skill !== "summoner") return null;
      return this.teleportPreview(game.getPointerWorldPosition(game.pointerClientX, game.pointerClientY), false);
    }

    nearestMob() {
      const { game } = this;
      let nearest = null, nearestDistance = 5 * TILE;
      for (const mob of game.mobs) {
        if (mob.dying || mob.portalFrozen || mob.health <= 0) continue;
        const distance = Math.hypot(mob.x - game.player.x, mob.y - game.player.y);
        if (distance <= 5 * TILE && (!nearest || distance < nearestDistance)) {
          nearest = mob;
          nearestDistance = distance;
        }
      }
      return nearest;
    }

    inWater(mob) {
      const { game } = this;
      const tx = Math.floor(mob.x / TILE), ty = Math.floor(mob.y / TILE);
      return game.world.terrainAt(tx, ty) === Wilds.TERRAIN.OCEAN && !game.hasWaterSupport(tx, ty);
    }

    play(id, phase = "cast") {
      this.game.audio?.playSummonerSkill?.(id, phase);
    }

    burst(id, x, y, duration = 0.6) {
      this.bursts.push({ id, x, y, start: this.time, until: this.time + duration });
    }

    moveTo(x, y, smooth) {
      const { game } = this;
      const { player } = game;
      const dx = player.x + (player.cameraOffset?.x || 0) - x;
      const dy = player.y + (player.cameraOffset?.y || 0) - y;
      player.x = x;
      player.y = y;
      player.cameraOffset = smooth && Math.hypot(dx, dy) > 0
        ? { x: dx, y: dy, startX: dx, startY: dy, age: 0, duration: Math.min(1, Math.hypot(dx, dy) / (24 * TILE)), returning: true }
        : null;
      game.lastPlayerSafe = { x, y };
    }

    flash(point) {
      if (!point) return false;
      const { player } = this.game;
      const dx = point.x - player.x, dy = point.y - player.y;
      const distance = Math.hypot(dx, dy);
      if (!distance) return false;
      for (let step = 8 * TILE; step >= 1; step--) {
        const x = player.x + dx / distance * step, y = player.y + dy / distance * step;
        if (!player.canOccupy(x, y)) continue;
        this.burst("flash", player.x, player.y, 0.35);
        this.moveTo(x, y, false);
        this.burst("flash", x, y, 0.35);
        return true;
      }
      return false;
    }

    start(gear, fromMap = false) {
      const { game } = this;
      const { player } = game;
      if (!gear || player.portalFrozen || this.channel || game.paused || game.isDead || game.sleeping ||
          (fromMap ? !game.mapOpen || this.selection !== "teleport" : !game.canUseWorldInput())) return false;
      if (this.remaining(gear) > 0) {
        game.showToast("召唤师手环冷却中");
        return false;
      }
      const id = this.selection;
      const target = this.spell.targeted ? this.nearestMob() : null;
      if (this.spell.targeted && !target) {
        game.showToast("5 格内没有可用目标");
        return false;
      }
      if (id === "flash" || id === "teleport") {
        const point = fromMap ? game.mapPortalTarget : game.pointerInside &&
          game.getPointerWorldPosition(game.pointerClientX, game.pointerClientY);
        if (id === "flash" && !this.flash(point)) return false;
        if (id === "teleport") return this.startTeleport(gear, point, fromMap);
      }
      if (id === "ignite") {
        if (this.inWater(target)) {
          target.summonerIgnite = null;
          game.damageMob(target, 10);
          this.burst(id, target.x, target.y, 0.35);
        } else target.summonerIgnite = { next: this.time + 0.5, ticks: 10 };
      } else if (id === "smite") {
        game.damageMob(target, 50, "smite");
        this.burst(id, target.x, target.y);
      } else if (id === "heal") {
        this.heal = { next: this.time + 1, ticks: 3 };
        this.syncPlayerBuffs();
      } else if (id === "barrier") {
        this.barrierUntil = this.time + 3;
        this.syncPlayerBuffs();
      } else if (id === "exhaust") {
        target.summonerWeakUntil = this.time + this.spell.duration;
      } else if (id === "ghost") {
        this.ghostUntil = this.time + this.spell.duration;
        this.syncPlayerBuffs();
      } else if (id === "cleanse") {
        player.clearNegativeEffects();
        this.burst(id, player.x, player.y);
      }
      this.play(id);
      game.useEquippedSkill(gear, this.spell.cooldown);
      return true;
    }

    startTeleport(gear, point, fromMap) {
      const { game } = this;
      const plan = this.teleportPlan(point, fromMap);
      if (!plan?.valid) {
        game.showToast("此处无法传送");
        return false;
      }
      if (fromMap) game.closeMap();
      game.keys.clear();
      this.channel = {
        target: plan, source: { x: game.player.x, y: game.player.y },
        start: this.time, until: this.time + CHANNEL_SECONDS, nextTone: this.time + 1,
        itemId: gear.item.id, usesCooldown: !game.isCreative(),
      };
      game.useEquippedSkill(gear, null);
      game.renderInventory();
      this.play("teleport");
      return true;
    }

    finishTeleport(success, feedback = true) {
      const channel = this.channel;
      if (!channel) return;
      const { game } = this;
      this.channel = null;
      if (channel.usesCooldown) {
        game.setSkillCooldown(channel.itemId, success ? SPELLS.teleport.cooldown : 10);
      }
      if (success) {
        this.moveTo(channel.target.x, channel.target.y, true);
        this.burst("teleport", channel.target.x, channel.target.y, 0.8);
      } else if (feedback) game.showToast("传送引导被打断");
      if (feedback) this.play("teleport", success ? "arrive" : "interrupt");
      game.renderInventory();
      return true;
    }

    onDeath() {
      this.finishTeleport(false, false);
      this.heal = null;
      this.ghostUntil = this.barrierUntil = 0;
      this.syncPlayerBuffs();
    }

    syncPlayerBuffs() {
      this.game.player.summonerSpeedFactor = (this.heal ? 1.3 : 1) * (this.ghostUntil > this.time ? 2 : 1);
      this.game.player.summonerShielded = this.barrierUntil > this.time;
    }

    damageMultiplier(mob) {
      return mob.summonerWeakUntil > this.time + EPSILON ? 2 : 1;
    }

    update(dt) {
      const { game } = this;
      this.time += dt;
      const channel = this.channel;
      if (channel) {
        if (game.player.portalFrozen) this.finishTeleport(false);
        else if (this.time + EPSILON >= channel.until) {
          this.finishTeleport(game.player.canOccupy(channel.target.x, channel.target.y));
        } else if (this.time + EPSILON >= channel.nextTone) {
          channel.nextTone++;
          this.play("teleport", "pulse");
        }
      }
      if (this.heal) {
        while (this.heal.ticks > 0 && this.time + EPSILON >= this.heal.next) {
          game.player.health = Math.min(game.player.maxHealth, game.player.health + 20);
          this.heal.ticks--;
          this.heal.next++;
        }
        if (this.heal.ticks === 0) this.heal = null;
      }
      this.syncPlayerBuffs();

      for (const mob of game.mobs) {
        const ignite = mob.summonerIgnite;
        if (!ignite) continue;
        if (mob.dying || this.inWater(mob)) {
          mob.summonerIgnite = null;
          continue;
        }
        while (ignite.ticks > 0 && this.time + EPSILON >= ignite.next && !mob.dying) {
          game.damageMob(mob, 10);
          ignite.ticks--;
          ignite.next += 0.5;
        }
        if (!ignite.ticks || mob.dying) mob.summonerIgnite = null;
      }
      if (this.bursts.length) this.bursts = this.bursts.filter(effect => effect.until > this.time);
    }
  }

  Wilds.SummonerBracelet = SummonerBracelet;
  Wilds.SUMMONER_SPELLS = SPELLS;
})();
