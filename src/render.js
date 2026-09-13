/**
 * Canvas renderer. Reads the match, never mutates game logic (except its own
 * particle system). Everything is drawn from scratch — no image assets.
 */

import { TILE, MAT, MATERIALS, POWERUPS, PLAYER, ARENA } from './config.js?v=20260913';
import { hexCorners, hexRing } from './hex.js?v=20260913';
import { clamp, lerp, easeOutCubic, easeInCubic, smoothstep } from './rng.js?v=20260913';

const TAU = Math.PI * 2;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.w = 0;
    this.h = 0;
    this.particles = [];
    this.floaters = [];
    this.rings = [];
    this.embers = [];
    this.cam = { scale: 1, x: 0, y: 0, targetScale: 1, shakeX: 0, shakeY: 0, punch: 0 };
    this.time = 0;
    this.flash = 0;
    this.flashColor = '#ffffff';
    this.hueShift = 0;
    this.cornerCache = new Map();
    this.theme = null;
    this.roundKey = null;
    this.arenaRef = null;
    this.roundAnim = 99;
    for (let i = 0; i < 90; i++) {
      this.embers.push({
        x: Math.random(),
        y: Math.random(),
        z: Math.random() * 0.8 + 0.2,
        s: Math.random() * 1.8 + 0.4,
      });
    }
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(320, rect.width);
    this.h = Math.max(240, rect.height);
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
  }

  /** Arena palette override for normal tiles (Kollektsiya unlocks). */
  setTheme(theme) {
    this.theme = theme || null;
  }

  tileColors(t) {
    const base = MATERIALS[t.mat];
    if (t.mat === MAT.NORMAL && this.theme) {
      return {
        ...base,
        top: this.theme.top,
        topAlt: this.theme.topAlt,
        side: this.theme.side,
        edge: this.theme.edge,
      };
    }
    return base;
  }

  /** Hex or rounded-square outline depending on the arena definition. */
  cellPath(ctx, arena, x, y, r) {
    if (arena.gridType === 'square') {
      const w = r * 1.84;
      const rad = r * 0.42;
      ctx.beginPath();
      ctx.moveTo(x - w / 2 + rad, y - w / 2);
      ctx.arcTo(x + w / 2, y - w / 2, x + w / 2, y + w / 2, rad);
      ctx.arcTo(x + w / 2, y + w / 2, x - w / 2, y + w / 2, rad);
      ctx.arcTo(x - w / 2, y + w / 2, x - w / 2, y - w / 2, rad);
      ctx.arcTo(x - w / 2, y - w / 2, x + w / 2, y - w / 2, rad);
      ctx.closePath();
      return;
    }
    this.hexPath(ctx, x, y, r);
  }

  /** Bright arcade palette for Arena #1; specials keep their identity. */
  squareColors(t, arena, match) {
    const pal = arena.def.palette || ['#ff5d73', '#ffb03a', '#ffe14d', '#5dffa8', '#4dd0ff', '#b47cff'];
    let top = pal[t.ci % pal.length];
    if (t.mat === MAT.STEEL) top = '#9fb4d8';
    else if (t.mat === MAT.ICE) top = '#bfeaff';
    else if (t.mat === MAT.CRUMBLE) top = '#d8a06a';
    if (match && match.blackoutT > 0) top = '#2a3350';
    const side = mix(top, 0, 0.45);
    return { top, topAlt: mix(top, 255, 0.14), side, edge: mix(top, 255, 0.4), crackTime: MATERIALS[t.mat].crackTime, fallTime: MATERIALS[t.mat].fallTime };
  }

  corners(size) {
    if (!this.cornerCache.has(size)) this.cornerCache.set(size, hexCorners(size));
    return this.cornerCache.get(size);
  }

  hexPath(ctx, cx, cy, size, scale = 1) {
    const pts = this.corners(size);
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const x = cx + pts[i][0] * scale;
      const y = cy + pts[i][1] * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  /* ------------------------------------------------------------- particles */

  spawnShards(x, y, color, n = 9, power = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const sp = (40 + Math.random() * 190) * power;
      this.particles.push({
        kind: 'shard',
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp * 0.6 - 30,
        g: 320,
        life: 0.5 + Math.random() * 0.6,
        t: 0,
        size: 2 + Math.random() * 4.5,
        rot: Math.random() * TAU,
        vr: (Math.random() - 0.5) * 12,
        color,
      });
    }
  }

  spawnDust(x, y, color, n = 6, power = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const sp = (18 + Math.random() * 70) * power;
      this.particles.push({
        kind: 'dust',
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp * 0.5 - 12,
        g: -18,
        life: 0.4 + Math.random() * 0.5,
        t: 0,
        size: 3 + Math.random() * 7,
        color,
      });
    }
  }

  spawnSpark(x, y, color, n = 12, power = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const sp = (90 + Math.random() * 260) * power;
      this.particles.push({
        kind: 'spark',
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        g: 0,
        life: 0.22 + Math.random() * 0.3,
        t: 0,
        size: 1.4 + Math.random() * 2.2,
        color,
      });
    }
  }

  spawnBeam(x, y, color) {
    this.particles.push({ kind: 'beam', x, y, vx: 0, vy: 0, g: 0, life: 0.55, t: 0, size: 16, color });
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * TAU;
      this.particles.push({
        kind: 'spark',
        x: x + Math.cos(a) * 10,
        y: y + Math.sin(a) * 6,
        vx: Math.cos(a) * 60,
        vy: -120 - Math.random() * 140,
        g: 60,
        life: 0.5 + Math.random() * 0.3,
        t: 0,
        size: 1.6 + Math.random() * 1.6,
        color,
      });
    }
  }

  spawnConfetti(n = 130) {
    const colors = ['#ffd23f', '#ff5d73', '#5ad7ff', '#5dffa8', '#b47cff', '#ff9f45'];
    for (let i = 0; i < n; i++) {
      this.particles.push({
        kind: 'confetti',
        x: (Math.random() - 0.5) * this.w / Math.max(0.4, this.cam.scale),
        y: -this.h / Math.max(0.4, this.cam.scale) * 0.6 - Math.random() * 200,
        vx: (Math.random() - 0.5) * 90,
        vy: 90 + Math.random() * 160,
        g: 60,
        life: 2.2 + Math.random() * 1.4,
        t: 0,
        size: 3 + Math.random() * 4,
        rot: Math.random() * TAU,
        vr: (Math.random() - 0.5) * 10,
        color: colors[i % colors.length],
      });
    }
  }

  spawnRing(x, y, color, r0 = 6, r1 = 90, life = 0.5, width = 4) {
    this.rings.push({ x, y, color, r0, r1, life, t: 0, width });
  }

  spawnFloater(x, y, text, color, size = 18, life = 1.1) {
    this.floaters.push({ x, y, text, color, size, life, t: 0, vy: -46 });
  }

  doFlash(color, amount = 0.5) {
    this.flash = Math.max(this.flash, amount);
    this.flashColor = color;
  }

  /** Turn simulation events into visual noise. */
  consume(events, arena) {
    for (const e of events) {
      const mat = e.mat ? MATERIALS[e.mat] : null;
      switch (e.type) {
        case 'crack':
          this.spawnShards(e.x, e.y, mat ? mat.topAlt : '#7ee0a8', e.forced ? 5 : 3, 0.5);
          break;
        case 'fall':
          this.spawnShards(e.x, e.y, mat ? mat.side : '#1d6b45', 12, 1);
          this.spawnDust(e.x, e.y, 'rgba(180,255,220,0.5)', 7, 0.9);
          break;
        case 'quake':
          this.cam.shake = Math.min(1.1, (this.cam.shake || 0) + 0.5);
          this.doFlash('#ff8a5c', 0.16);
          break;
        case 'collapse':
          this.cam.shake = 1.2;
          this.cam.punch = 0.09;
          this.doFlash('#ff5d73', 0.3);
          this.spawnRing(0, 0, 'rgba(255,93,115,0.5)', arena.size * 1.5, arena.size * (arena.radius + 0.5) * 1.75, 0.7, 4);
          break;
        case 'dash':
          this.spawnDust(e.x, e.y, hexToRgba(e.player.color, 0.55), 8, 1.1);
          break;
        case 'bump':
          this.spawnSpark(e.x, e.y, '#ffffff', 16, 1.2);
          this.spawnRing(e.x, e.y, hexToRgba(e.power ? e.power.color : '#fff', 0.8), 8, 54, 0.35, 3);
          this.cam.shake = Math.min(1, (this.cam.shake || 0) + 0.45);
          break;
        case 'slip':
          this.spawnDust(e.x, e.y, 'rgba(255,120,140,0.5)', 5, 0.6);
          break;
        case 'scramble':
          this.spawnDust(e.x, e.y, 'rgba(255,255,255,0.6)', 8, 0.8);
          this.spawnFloater(e.x, e.y - 26, 'SAQLANDI!', '#8dffc9', 15, 0.8);
          break;
        case 'fell': {
          const col = e.player.color;
          this.spawnShards(e.x, e.y, col, 22, 1.5);
          this.spawnRing(e.x, e.y, hexToRgba(col, 0.9), 10, 120, 0.7, 5);
          this.doFlash(col, 0.22);
          this.cam.shake = Math.min(1.3, (this.cam.shake || 0) + 0.8);
          this.spawnFloater(e.x, e.y - 30, e.player.name, col, 20, 1.3);
          break;
        }
        case 'shovedOff':
          this.spawnFloater(e.x ?? e.killer.x, (e.y ?? e.killer.y) - 52, 'URIB TUSHIRDI!', '#ffd23f', 17, 1.2);
          break;
        case 'powerup':
          this.spawnRing(e.x, e.y, hexToRgba(e.def.color, 0.9), 8, 96, 0.55, 4);
          this.spawnSpark(e.x, e.y, e.def.color, 20, 1);
          this.spawnBeam(e.x, e.y, e.def.color);
          this.spawnFloater(e.x, e.y - 34, (e.label || e.def.label).toUpperCase(), e.def.color, 17, 1.1);
          break;
        case 'land':
          this.spawnDust(e.x, e.y + 8, 'rgba(255,255,255,0.45)', 7, 0.8);
          break;
        case 'powerupSpawn':
          this.spawnRing(e.x, e.y, hexToRgba(POWERUPS[e.type].color, 0.6), 4, 40, 0.4, 2);
          break;
        case 'stabilize':
          this.spawnSpark(e.x, e.y, '#5ad7ff', 8, 0.6);
          break;
        case 'go':
          this.doFlash('#8dffc9', 0.4);
          break;
        default:
          break;
      }
    }
  }

  /* ------------------------------------------------------------------ draw */

  draw(match, dt, opts = {}) {
    this.time += dt;
    const ctx = this.ctx;
    const arena = match.arena;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    // --- camera -----------------------------------------------------------
    const focus = opts.focus;
    const worldW = arena.viewW;
    const worldH = arena.viewH;
    const pad = Math.min(this.w, this.h) < 620 ? 1.04 : 1.08;
    this.cam.targetScale = Math.min(this.w / (worldW * pad), this.h / (worldH * pad));
    this.cam.punch = Math.max(0, (this.cam.punch || 0) - dt * 0.35);
    this.cam.scale = lerp(this.cam.scale, this.cam.targetScale * (1 + this.cam.punch), 1 - Math.exp(-3 * dt));

    // tiles materialise ring-by-ring at the start of every round
    const rkey = match.round + '/' + arena.list.length;
    if (rkey !== this.roundKey || this.arenaRef !== arena) {
      this.roundKey = rkey;
      this.arenaRef = arena;
      this.roundAnim = 0;
    }
    this.roundAnim += dt;

    const shake = Math.max(match.shake || 0, this.cam.shake || 0);
    this.cam.shake = Math.max(0, (this.cam.shake || 0) - dt * 3);
    const shakeAmt = shake * 14 * this.cam.scale;
    this.cam.shakeX = (Math.random() - 0.5) * shakeAmt;
    this.cam.shakeY = (Math.random() - 0.5) * shakeAmt;

    const focusX = focus ? clamp(focus.x, -arena.size * 3, arena.size * 3) : 0;
    const focusY = focus ? clamp(focus.y, -arena.size * 3, arena.size * 3) : 0;
    this.cam.x = lerp(this.cam.x, focusX * 0.18, 1 - Math.exp(-2.5 * dt));
    this.cam.y = lerp(this.cam.y, focusY * 0.18, 1 - Math.exp(-2.5 * dt));

    this.drawBackground(ctx, arena, match);

    ctx.save();
    ctx.translate(this.w / 2 + this.cam.shakeX - this.cam.x * this.cam.scale, this.h / 2 + this.cam.shakeY - this.cam.y * this.cam.scale);
    if (opts.yaw) ctx.rotate(-opts.yaw);
    ctx.scale(this.cam.scale, this.cam.scale);

    this.drawArena(ctx, arena, match);
    this.drawPowerups(ctx, match, arena);
    this.drawParticles(ctx, dt, 'under');
    this.drawPlayers(ctx, match, dt);
    this.drawParticles(ctx, dt, 'over');
    this.drawFloaters(ctx, dt);

    ctx.restore();

    this.drawOverlayFx(ctx, match);
  }

  drawBackground(ctx, arena, match) {
    const th = (arena.def && arena.def.theme) || { bg0: '#141b33', bg1: '#0b1024', bg2: '#04060f' };
    const g = ctx.createRadialGradient(this.w / 2, this.h * 0.45, 0, this.w / 2, this.h * 0.5, Math.max(this.w, this.h) * 0.78);
    g.addColorStop(0, th.bg0);
    g.addColorStop(0.55, th.bg1);
    g.addColorStop(1, th.bg2 || '#04060f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);

    // drifting embers
    ctx.save();
    for (const e of this.embers) {
      const t = this.time * 0.03 * e.z;
      const x = ((e.x + t) % 1) * this.w;
      const y = ((e.y + Math.sin(this.time * 0.4 * e.z + e.x * 9) * 0.01 + t * 0.25) % 1) * this.h;
      ctx.globalAlpha = 0.08 + e.z * 0.16;
      ctx.fillStyle = e.z > 0.6 ? '#7fe9ff' : '#b47cff';
      ctx.beginPath();
      ctx.arc(x, y, e.s, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // danger pulse when a ring is about to go
    const warn = arena.collapseWarn;
    if (warn > 0) {
      const p = (Math.sin(this.time * 14) * 0.5 + 0.5) * warn;
      const vg = ctx.createRadialGradient(this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.28, this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.72);
      vg.addColorStop(0, 'rgba(255,60,90,0)');
      vg.addColorStop(1, `rgba(255,60,90,${0.16 + p * 0.3})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    if (arena.quakeFlash > 0) {
      ctx.fillStyle = `rgba(255,140,80,${arena.quakeFlash * 0.08})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    if (match && match.darkT > 0) {
      const a = 0.55 * clamp(match.darkT / 2, 0, 1);
      const vg = ctx.createRadialGradient(this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.12, this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.6);
      vg.addColorStop(0, 'rgba(2,4,10,0)');
      vg.addColorStop(1, `rgba(2,4,10,${a})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, this.w, this.h);
    }
  }

  drawArena(ctx, arena, match) {
    const size = arena.size;
    const depth = ARENA.depth;
    const tiles = arena.list;

    // Holes: faint outlines so gaps stay readable.
    ctx.save();
    ctx.lineWidth = 1.4;
    for (const t of tiles) {
      if (t.state !== TILE.GONE) continue;
      const g = ctx.createRadialGradient(t.x, t.y, 0, t.x, t.y, size);
      g.addColorStop(0, 'rgba(2,4,10,0.9)');
      g.addColorStop(0.75, 'rgba(6,10,24,0.55)');
      g.addColorStop(1, 'rgba(6,10,24,0)');
      ctx.fillStyle = g;
      this.cellPath(ctx, arena, t.x, t.y, size * 0.98);
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,170,255,0.14)';
      this.cellPath(ctx, arena, t.x, t.y, size * 0.94);
      ctx.stroke();
    }
    ctx.restore();

    // Rim warning: the ring that is about to collapse.
    if (arena.collapseWarn > 0) {
      const pulse = Math.sin(this.time * 12) * 0.5 + 0.5;
      ctx.save();
      ctx.lineWidth = 3;
      ctx.strokeStyle = `rgba(255,80,110,${0.25 + pulse * 0.55 * arena.collapseWarn})`;
      const rim =
        arena.gridType === 'square'
          ? arena.list.filter((x) => x.d === arena.maxRing)
          : hexRing(arena.maxRing).map((c) => arena.get(c.q, c.r)).filter(Boolean);
      for (const t of rim) {
        if (!t || t.state === TILE.GONE) continue;
        this.cellPath(ctx, arena, t.x, t.y, size * 0.97);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Tiles, back row first.
    const ordered = tiles.slice().sort((a, b) => a.r - b.r || a.q - b.q);
    for (const t of ordered) {
      if (t.state === TILE.GONE) continue;
      const k = clamp(this.roundAnim * 2.4 - t.d * 0.13, 0, 1);
      if (k <= 0.001) continue;
      this.drawTile(ctx, t, size, depth, arena, k, match);
    }

    // --- live hazard dressing (events) -------------------------------------
    if (match) {
      if (match.lavaT > 0) {
        ctx.save();
        ctx.rotate(match.lavaAngle);
        const lg = ctx.createLinearGradient(0, -arena.size, 0, arena.size);
        lg.addColorStop(0, 'rgba(255,90,40,0)');
        lg.addColorStop(0.5, `rgba(255,110,40,${0.35 * clamp(match.lavaT / 2, 0, 1)})`);
        lg.addColorStop(1, 'rgba(255,90,40,0)');
        ctx.fillStyle = lg;
        ctx.fillRect(-arena.worldRadius, -arena.size * 0.6, arena.worldRadius * 2, arena.size * 1.2);
        ctx.restore();
      }
      if (match.tornado) {
        const tn = match.tornado;
        ctx.save();
        ctx.translate(tn.x, tn.y);
        for (let i = 0; i < 4; i++) {
          ctx.rotate(tn.a + i * 1.57);
          ctx.strokeStyle = `rgba(190,230,255,${0.35 - i * 0.07})`;
          ctx.lineWidth = 5 - i;
          ctx.beginPath();
          ctx.arc(0, 0, 60 + i * 46, 0, 2.2);
          ctx.stroke();
        }
        ctx.restore();
      }
      if (match.iceT > 0) {
        ctx.fillStyle = `rgba(120,220,255,${0.08 * clamp(match.iceT / 2, 0, 1)})`;
        ctx.fillRect(-arena.worldRadius, -arena.worldRadius, arena.worldRadius * 2, arena.worldRadius * 2);
      }
    }
  }

  drawTile(ctx, t, size, depth, arena, spawn = 1, match = null) {
    const square = arena.gridType === 'square';
    const tiny = match && match.modifier === 'tinyTiles' ? 0.86 : 1;
    size *= tiny;
    const mat = square ? this.squareColors(t, arena, match) : this.tileColors(t);
    const wob = Math.sin(t.wobbleT) * t.wobble * 2.2;
    let scale = spawn < 1 ? easeOutBack(spawn) : 1;
    let drop = spawn < 1 ? (1 - spawn) * size * 1.4 : 0;
    let alpha = spawn < 1 ? spawn : 1;

    if (t.state === TILE.FALLING) {
      const p = clamp(t.fallT / mat.fallTime, 0, 1);
      drop = easeInCubic(p) * size * 3.4;
      scale = 1 - easeInCubic(p) * 0.55;
      alpha = 1 - smoothstep(clamp((p - 0.35) / 0.65, 0, 1));
    } else if (t.state === TILE.CRACKED) {
      const p = 1 - clamp(t.timer / mat.crackTime, 0, 1);
      drop = p * 4.5;
      scale = 1 - p * 0.05;
    }

    const cx = t.x;
    const cy = t.y + wob + drop;
    ctx.save();
    ctx.globalAlpha = alpha;

    // side / extrusion
    ctx.fillStyle = mat.side;
    this.cellPath(ctx, arena, cx, cy + depth * scale, size * 0.98 * scale);
    ctx.fill();

    // top face (slight per-tile tint keeps the floor from looking flat)
    const tint = (t.seed - 0.5) * 0.1;
    const grd = ctx.createLinearGradient(cx - size, cy - size, cx + size, cy + size);
    grd.addColorStop(0, mix(mat.top, 255, Math.max(0, tint)) || mat.top);
    grd.addColorStop(1, mix(mat.topAlt, 0, Math.max(0, -tint)) || mat.topAlt);
    ctx.fillStyle = grd;
    this.cellPath(ctx, arena, cx, cy, size * 0.96 * scale);
    ctx.fill();

    // material detail
    ctx.save();
    this.cellPath(ctx, arena, cx, cy, size * 0.96 * scale);
    ctx.clip();
    if (t.mat === MAT.ICE) {
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 3; i++) {
        const o = (i - 1) * size * 0.42;
        ctx.beginPath();
        ctx.moveTo(cx - size + o, cy - size * 0.6);
        ctx.lineTo(cx + o * 0.4, cy + size * 0.7);
        ctx.stroke();
      }
    } else if (t.mat === MAT.STEEL) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + t.seed * 3;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * size * 0.55, cy + Math.sin(a) * size * 0.55, 2, 0, TAU);
        ctx.fill();
      }
    } else if (t.mat === MAT.CRUMBLE) {
      ctx.fillStyle = 'rgba(90,40,10,0.35)';
      for (let i = 0; i < 6; i++) {
        const a = t.seed * TAU + i * 1.7;
        const rr = size * (0.18 + ((t.seed * 7 + i * 0.31) % 0.6));
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 1.8, 0, TAU);
        ctx.fill();
      }
    }
    // inner sheen
    const sheen = ctx.createRadialGradient(cx - size * 0.3, cy - size * 0.4, size * 0.05, cx, cy, size);
    sheen.addColorStop(0, 'rgba(255,255,255,0.22)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(cx - size, cy - size, size * 2, size * 2);
    ctx.restore();

    // cracks
    if (t.state === TILE.CRACKED || (t.state === TILE.SOLID && t.pressure > t.hp * 0.45)) {
      const p = t.state === TILE.CRACKED ? 1 - clamp(t.timer / mat.crackTime, 0, 1) : clamp(t.pressure / t.hp, 0, 1) * 0.5;
      this.drawCracks(ctx, cx, cy, size * scale, t.seed, p, t.state === TILE.CRACKED);
    }

    // rim
    ctx.lineWidth = 1.8;
    const rimPulse = t.state === TILE.CRACKED ? 0.4 + 0.6 * Math.abs(Math.sin(this.time * 16 + t.seed * 5)) : 0.55;
    ctx.strokeStyle = t.state === TILE.CRACKED ? `rgba(255,90,90,${rimPulse})` : hexToRgba(mat.edge, 0.5);
    this.hexPath(ctx, cx, cy, size * 0.96 * scale);
    ctx.stroke();

    // flash (positive = red hit, negative = blue heal)
    if (Math.abs(t.flash) > 0.01) {
      const f = clamp(Math.abs(t.flash), 0, 1);
      ctx.fillStyle = t.flash > 0 ? `rgba(255,120,90,${f * 0.5})` : `rgba(120,220,255,${f * 0.55})`;
      this.hexPath(ctx, cx, cy, size * 0.96 * scale);
      ctx.fill();
    }

    // occupied marker: subtle darkening under a standing body
    if (t.occupants > 0 && t.state === TILE.SOLID) {
      ctx.fillStyle = `rgba(0,0,0,${0.06 * t.occupants})`;
      this.hexPath(ctx, cx, cy, size * 0.9 * scale);
      ctx.fill();
    }

    ctx.restore();
  }

  drawCracks(ctx, cx, cy, size, seed, amount, danger) {
    ctx.save();
    ctx.lineWidth = danger ? 2.2 : 1.3;
    ctx.strokeStyle = danger ? `rgba(30,10,10,${0.35 + amount * 0.5})` : 'rgba(30,20,10,0.28)';
    const n = 3 + Math.floor(amount * 4);
    for (let i = 0; i < n; i++) {
      const a = seed * TAU + i * 2.399;
      const len = size * (0.35 + amount * 0.6);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      let x = cx;
      let y = cy;
      const segs = 3;
      for (let s = 1; s <= segs; s++) {
        const wobble = Math.sin(seed * 40 + i * 7 + s * 3) * 0.42;
        x += Math.cos(a + wobble) * (len / segs);
        y += Math.sin(a + wobble) * (len / segs);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    if (danger && amount > 0.55) {
      ctx.globalAlpha = (amount - 0.55) * 1.6;
      ctx.fillStyle = 'rgba(255,60,40,0.16)';
      this.hexPath(ctx, cx, cy, size * 0.94);
      ctx.fill();
    }
    ctx.restore();
  }

  drawPowerups(ctx, match, arena) {
    for (const pu of match.powerups) {
      const def = POWERUPS[pu.type];
      const bob = Math.sin(pu.t * 3 + pu.q) * 4;
      const y = pu.y - 16 + bob;
      const fade = pu.life < 3 ? 0.45 + 0.55 * Math.abs(Math.sin(pu.life * 7)) : 1;
      ctx.save();
      ctx.globalAlpha = fade;

      // glow
      const g = ctx.createRadialGradient(pu.x, y, 2, pu.x, y, 34);
      g.addColorStop(0, hexToRgba(def.color, 0.55));
      g.addColorStop(1, hexToRgba(def.color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(pu.x, y, 34, 0, TAU);
      ctx.fill();

      // rotating hex badge
      ctx.translate(pu.x, y);
      ctx.rotate(pu.t * 0.8);
      ctx.fillStyle = 'rgba(8,12,26,0.85)';
      this.hexPath(ctx, 0, 0, 15);
      ctx.fill();
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = def.color;
      this.hexPath(ctx, 0, 0, 15);
      ctx.stroke();
      ctx.rotate(-pu.t * 0.8);

      ctx.fillStyle = def.color;
      ctx.font = 'bold 16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(def.icon, 0, 1);
      ctx.restore();
    }
  }

  drawPlayers(ctx, match, dt) {
    const alive = match.players.filter((p) => p.alive || p.fallT < PLAYER.saveWindow + PLAYER.fallDuration + 0.8);
    // draw falling players first so survivors read on top
    alive.sort((a, b) => (a.alive ? 1 : 0) - (b.alive ? 1 : 0) || a.y - b.y);

    for (const p of alive) {
      // dash trail
      for (const d of p.dashTrail) {
        const a = clamp(d.life / 0.35, 0, 1);
        ctx.fillStyle = hexToRgba(p.color, a * 0.32);
        ctx.beginPath();
        ctx.arc(d.x, d.y, p.radius * (0.5 + a * 0.6), 0, TAU);
        ctx.fill();
      }

      const sink = clamp(p.fallT / (PLAYER.saveWindow + PLAYER.fallDuration), 0, 1);
      const deadT = p.alive ? 0 : p.fallT - (PLAYER.saveWindow + PLAYER.fallDuration);
      const deadFade = clamp(1 - deadT / 0.7, 0, 1);
      const hop = clamp(p.hopT / PLAYER.dashTime, 0, 1);
      const lift = hop > 0 ? Math.sin(hop * Math.PI) * 16 : 0;
      const scale = (1 - sink * 0.8) * (1 + p.squash * 0.25) * (deadFade > 0 ? 0.4 + deadFade * 0.6 : 1);
      const alpha = clamp((1 - sink * sink) * deadFade, 0, 1);
      const px = p.x;
      const py = p.y - lift + sink * 30;

      if (alpha <= 0.01) continue;
      ctx.save();
      ctx.globalAlpha = alpha;

      // shadow
      const shadowScale = clamp(1 - lift / 40 - sink * 0.5, 0.25, 1);
      ctx.fillStyle = `rgba(0,0,0,${0.34 * shadowScale})`;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + 6, p.radius * 1.05 * shadowScale, p.radius * 0.5 * shadowScale, 0, 0, TAU);
      ctx.fill();

      // effect auras
      if (p.titanT > 0) {
        ctx.strokeStyle = hexToRgba(POWERUPS.titan.color, 0.8);
        ctx.lineWidth = 3;
        this.hexPath(ctx, px, py, p.radius * 1.85 * scale);
        ctx.stroke();
      }
      if (p.freezeT > 0) {
        ctx.fillStyle = hexToRgba(POWERUPS.freeze.color, 0.14);
        ctx.beginPath();
        ctx.arc(px, py, p.radius * 2.1 * scale, 0, TAU);
        ctx.fill();
      }
      if (p.speedT > 0) {
        ctx.strokeStyle = hexToRgba(POWERUPS.speed.color, 0.55);
        ctx.lineWidth = 2;
        for (let i = 1; i <= 2; i++) {
          ctx.beginPath();
          ctx.arc(px - Math.cos(p.facing) * i * 9, py - Math.sin(p.facing) * i * 9, p.radius * scale * (1 - i * 0.16), 0, TAU);
          ctx.stroke();
        }
      }

      ctx.translate(px, py);
      if (!p.alive || sink > 0) ctx.rotate(sink * 5 + deadT * 3);
      // squash & stretch along the movement direction
      const spd = Math.hypot(p.vx || 0, p.vy || 0);
      const stretch = p.alive ? clamp(spd / 900, 0, 0.3) : 0;
      if (stretch > 0.01) {
        ctx.rotate(p.facing);
        ctx.scale(scale * (1 + stretch), scale * (1 - stretch * 0.55));
        ctx.rotate(-p.facing);
      } else {
        ctx.scale(scale, scale);
      }

      // body
      const bg = ctx.createRadialGradient(-p.radius * 0.35, -p.radius * 0.45, p.radius * 0.15, 0, 0, p.radius * 1.25);
      bg.addColorStop(0, lighten(p.color, 0.45));
      bg.addColorStop(0.6, p.color);
      bg.addColorStop(1, darken(p.color, 0.45));
      ctx.globalAlpha = alpha * (p.phantomT > 0 ? 0.62 : 1);
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(0, 0, p.radius, 0, TAU);
      ctx.fill();

      ctx.globalAlpha = alpha;
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = 'rgba(6,10,22,0.85)';
      ctx.beginPath();
      ctx.arc(0, 0, p.radius, 0, TAU);
      ctx.stroke();

      // facing wedge ("nose")
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      const fx = Math.cos(p.facing);
      const fy = Math.sin(p.facing);
      ctx.moveTo(fx * p.radius * 0.95, fy * p.radius * 0.95);
      ctx.lineTo(fx * p.radius * 0.25 - fy * p.radius * 0.5, fy * p.radius * 0.25 + fx * p.radius * 0.5);
      ctx.lineTo(fx * p.radius * 0.25 + fy * p.radius * 0.5, fy * p.radius * 0.25 - fx * p.radius * 0.5);
      ctx.closePath();
      ctx.fill();

      // eyes
      ctx.fillStyle = 'rgba(8,12,24,0.9)';
      const ex = -fy * p.radius * 0.42;
      const ey = fx * p.radius * 0.42;
      const fwd = p.radius * 0.28;
      ctx.beginPath();
      ctx.arc(fx * fwd + ex, fy * fwd + ey, 2.5, 0, TAU);
      ctx.arc(fx * fwd - ex, fy * fwd - ey, 2.5, 0, TAU);
      ctx.fill();

      // emote bubble
      if (p.emote && p.emoteT > 0) {
        const ea = clamp(p.emoteT / 0.5, 0, 1);
        ctx.save();
        ctx.globalAlpha = alpha * ea;
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.beginPath();
        ctx.arc(0, -p.radius - 26, 15, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#101a33';
        ctx.font = '15px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.emote, 0, -p.radius - 25);
        ctx.restore();
      }

      // team badge (A/B) for team modes
      if (match.teamMode && p.alive && (p.team === 0 || p.team === 1)) {
        const bx = p.radius * 0.95;
        const by = -p.radius * 0.95;
        ctx.save();
        ctx.fillStyle = p.team === 0 ? '#4dd0ff' : '#ff5d73';
        ctx.beginPath();
        ctx.arc(bx, by, 9, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#08101f';
        ctx.font = '900 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.team === 0 ? 'A' : 'B', bx, by + 0.5);
        ctx.restore();
      }

      // dash cooldown ring
      if (p.alive && p.dashCd > 0) {
        const cd = clamp(1 - p.dashCd / PLAYER.dashCooldown, 0, 1);
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(0, 0, p.radius + 5, -Math.PI / 2, -Math.PI / 2 + cd * TAU);
        ctx.stroke();
      } else if (p.alive) {
        ctx.strokeStyle = hexToRgba(p.color, 0.35 + 0.25 * Math.sin(this.time * 5));
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, p.radius + 5, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();

      // danger warning while falling
      if (p.falling && p.alive) {
        const w = clamp(p.fallT / PLAYER.saveWindow, 0, 1.6);
        ctx.save();
        ctx.globalAlpha = clamp(1 - w * 0.5, 0, 1) * (0.5 + 0.5 * Math.sin(this.time * 22));
        ctx.strokeStyle = p.doomed ? '#ff3b5c' : '#ffd23f';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * (1.5 + w * 0.9), 0, TAU);
        ctx.stroke();
        ctx.restore();
      }

      // name tag
      if (p.alive || deadFade > 0.4) {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = `600 ${12}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        const label = p.isLocal && !p.isBot ? `${p.name}` : p.name;
        const wpx = ctx.measureText(label).width + 12;
        const ny = p.y - p.radius - 16 - lift;
        ctx.fillStyle = 'rgba(6,10,22,0.62)';
        roundRect(ctx, p.x - wpx / 2, ny - 12, wpx, 16, 8);
        ctx.fill();
        ctx.fillStyle = p.color;
        ctx.fillText(label, p.x, ny);
        ctx.restore();
      }
    }
  }

  drawParticles(ctx, dt, layer) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.t += dt;
      if (p.t >= p.life) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += (p.g || 0) * dt;
      p.vx *= Math.exp(-1.6 * dt);
      const a = 1 - p.t / p.life;
      const over = p.kind === 'spark' || p.kind === 'shard' || p.kind === 'confetti' || p.kind === 'beam';
      if ((layer === 'over') !== over) continue;
      ctx.save();
      ctx.globalAlpha = a;
      if (p.kind === 'confetti') {
        p.rot += p.vr * dt;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      } else if (p.kind === 'beam') {
        const k = p.t / p.life;
        const hgt = 150 * (1 - k * 0.3);
        const g2 = ctx.createLinearGradient(p.x, p.y, p.x, p.y - hgt);
        g2.addColorStop(0, p.color);
        g2.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.globalAlpha = (1 - k) * 0.7;
        ctx.fillStyle = g2;
        ctx.fillRect(p.x - p.size * (1 - k * 0.5) / 2, p.y - hgt, p.size * (1 - k * 0.5), hgt);
      } else if (p.kind === 'shard') {
        p.rot += p.vr * dt;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7);
      } else if (p.kind === 'spark') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02);
        ctx.stroke();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.4 + a * 0.8), 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      if (r.t >= r.life) {
        this.rings.splice(i, 1);
        continue;
      }
      if (layer !== 'over') continue;
      const k = easeOutCubic(r.t / r.life);
      ctx.save();
      ctx.globalAlpha = 1 - r.t / r.life;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width * (1 - k * 0.6);
      ctx.beginPath();
      ctx.arc(r.x, r.y, lerp(r.r0, r.r1, k), 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawFloaters(ctx, dt) {
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.t += dt;
      if (f.t >= f.life) {
        this.floaters.splice(i, 1);
        continue;
      }
      f.y += f.vy * dt;
      f.vy *= Math.exp(-2.2 * dt);
      const k = f.t / f.life;
      ctx.save();
      ctx.globalAlpha = clamp(1 - k * k, 0, 1);
      ctx.font = `800 ${f.size}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(4,7,16,0.85)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
      ctx.restore();
    }
  }

  drawOverlayFx(ctx, match) {
    // vignette
    const vg = ctx.createRadialGradient(this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.35, this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, this.w, this.h);

    // your own danger tint
    const me = match.players.find((p) => !p.isBot && p.alive);
    if (me && (me.falling || (me.tile && me.tile.state === TILE.CRACKED))) {
      const pulse = Math.sin(this.time * 18) * 0.5 + 0.5;
      ctx.fillStyle = `rgba(255,40,70,${0.06 + pulse * 0.09})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }

    if (this.flash > 0.002) {
      ctx.save();
      ctx.globalAlpha = clamp(this.flash, 0, 0.7);
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.restore();
      this.flash *= Math.exp(-9 * (1 / 60));
    }
  }
}

/* ------------------------------------------------------------------ helpers */

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function hexToRgba(hex, a = 1) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

function mix(hex, target, amount) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const r = Math.round(lerp((n >> 16) & 255, target, amount));
  const g = Math.round(lerp((n >> 8) & 255, target, amount));
  const b = Math.round(lerp(n & 255, target, amount));
  return `rgb(${r},${g},${b})`;
}

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export const lighten = (hex, a) => mix(hex, 255, a);
export const darken = (hex, a) => mix(hex, 0, a);
