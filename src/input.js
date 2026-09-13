/**
 * Keyboard + touch input. Produces a Map of player-controls-index -> input.
 * Dash is edge triggered with a small buffer so taps are never swallowed.
 */

const KEYS = new Set();
const DASH_BUFFER = 0.16;

const P1_KEYS = {
  up: ['KeyW'],
  down: ['KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
  dash: ['Space', 'ShiftLeft', 'KeyF'],
};
const P2_KEYS = {
  up: ['ArrowUp'],
  down: ['ArrowDown'],
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  dash: ['Enter', 'ShiftRight', 'Numpad0', 'Period'],
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.states = [
      { mx: 0, my: 0, dash: false, dashQueued: 0 },
      { mx: 0, my: 0, dash: false, dashQueued: 0 },
    ];
    this.onAction = null; // (name) => void — pause / mute / confirm
    this.touch = { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0, dash: false, dashQueued: 0 };
    this.look = null; // right-side look drag (mobile) / right-mouse drag (desktop)
    this._yawAcc = 0;
    this.isTouchDevice = false;
    this.bind();
  }

  bind() {
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.repeat) {
          if (this.isGameKey(e.code)) e.preventDefault();
          return;
        }
        KEYS.add(e.code);
        if (this.isGameKey(e.code)) e.preventDefault();
        if (e.code === 'Space' || e.code === 'Enter' || e.code === 'Numpad0' || e.code === 'Period') {
          this.queueDash(e.code);
        }
        if (e.code === 'Escape' || e.code === 'KeyP') this.emitAction('pause');
        if (e.code === 'KeyM') this.emitAction('mute');
        if (e.code === 'KeyR') this.emitAction('restart');
        if (e.code === 'Enter') this.emitAction('confirm');
        if (e.code === 'KeyH') this.emitAction('help');
        this.isTouchDevice = false;
        document.body.classList.toggle('touch', false);
      },
      { passive: false }
    );

    window.addEventListener('keyup', (e) => {
      KEYS.delete(e.code);
    });

    window.addEventListener('blur', () => KEYS.clear());

    // --- touch: left half = stick, right half = dash ---------------------
    const el = this.canvas;
    const onStart = (e) => {
      this.isTouchDevice = true;
      document.body.classList.toggle('touch', true);
      for (const t of e.changedTouches) {
        if (t.clientX < window.innerWidth * 0.55) {
          if (this.touch.id === null) {
            this.touch.id = t.identifier;
            this.touch.active = true;
            this.touch.ox = t.clientX;
            this.touch.oy = t.clientY;
            this.touch.x = t.clientX;
            this.touch.y = t.clientY;
          }
        } else if (this.look === null) {
          // look zone: drag = camera yaw, quick tap = dash/jump
          this.look = { id: t.identifier, x: t.clientX, t0: performance.now(), moved: false };
        }
      }
      e.preventDefault();
    };
    const onMove = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.touch.id) {
          this.touch.x = t.clientX;
          this.touch.y = t.clientY;
        } else if (this.look && t.identifier === this.look.id) {
          const dx = t.clientX - this.look.x;
          this.look.x = t.clientX;
          if (Math.abs(dx) > 6) this.look.moved = true;
          this._yawAcc -= dx * 0.006;
        }
      }
      e.preventDefault();
    };
    const onEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.touch.id) {
          this.touch.id = null;
          this.touch.active = false;
        } else if (this.look && t.identifier === this.look.id) {
          if (!this.look.moved && performance.now() - this.look.t0 < 260) {
            this.touch.dash = true;
            this.touch.dashQueued = DASH_BUFFER;
            this.queueDash('Space');
          }
          this.look = null;
        }
      }
      e.preventDefault();
    };
    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: false });
    el.addEventListener('touchcancel', onEnd, { passive: false });

    // --- desktop look: right-mouse drag rotates the camera ---------------
    window.addEventListener('mousemove', (e) => {
      if (e.buttons & 2) this._yawAcc -= (e.movementX || 0) * 0.0042;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  isGameKey(code) {
    return (
      P1_KEYS.up.includes(code) ||
      P1_KEYS.down.includes(code) ||
      P1_KEYS.left.includes(code) ||
      P1_KEYS.right.includes(code) ||
      P2_KEYS.up.includes(code) ||
      P2_KEYS.down.includes(code) ||
      P2_KEYS.left.includes(code) ||
      P2_KEYS.right.includes(code) ||
      code === 'Space'
    );
  }

  emitAction(name) {
    if (this.onAction) this.onAction(name);
  }

  queueDash(code) {
    if (P1_KEYS.dash.includes(code)) this.states[0].dashQueued = DASH_BUFFER;
    if (P2_KEYS.dash.includes(code)) this.states[1].dashQueued = DASH_BUFFER;
  }

  axis(map) {
    let x = 0;
    let y = 0;
    if (KEYS.has(map.left[0])) x -= 1;
    if (KEYS.has(map.right[0])) x += 1;
    if (KEYS.has(map.up[0])) y -= 1;
    if (KEYS.has(map.down[0])) y += 1;
    return { x, y };
  }

  /** Call once per frame; returns Map<controlsIndex, input>. */
  takeYaw() {
    const d = this._yawAcc || 0;
    this._yawAcc = 0;
    return d;
  }

  sample(dt) {
    const a = this.axis(P1_KEYS);
    let ax = a.x;
    let ay = a.y;

    if (this.touch.active) {
      const dx = this.touch.x - this.touch.ox;
      const dy = this.touch.y - this.touch.oy;
      const max = 58;
      const len = Math.hypot(dx, dy);
      if (len > 4) {
        const k = Math.min(1, len / max);
        ax = (dx / len) * k;
        ay = (dy / len) * k;
      }
    }

    const b = this.axis(P2_KEYS);
    const out = new Map();
    for (let i = 0; i < 2; i++) {
      const s = this.states[i];
      s.dashQueued = Math.max(0, s.dashQueued - dt);
      const dash = s.dashQueued > 0;
      if (dash) s.dashQueued = 0;
      const mx = i === 0 ? ax : b.x;
      const my = i === 0 ? ay : b.y;
      out.set(i, { mx, my, dash });
    }
    return out;
  }

  anyKey() {
    return KEYS.size > 0;
  }

  get touchStick() {
    return this.touch;
  }
}
