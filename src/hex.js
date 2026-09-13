/**
 * Pointy-top hexagon grid maths (axial coordinates q, r).
 * Pure math — no DOM, safe to import from headless tests.
 */

export const SQRT3 = Math.sqrt(3);

/** The six axial neighbour directions, clockwise starting east. */
export const HEX_DIRS = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

export function axialToPixel(q, r, size) {
  return {
    x: size * SQRT3 * (q + r / 2),
    y: size * 1.5 * r,
  };
}

export function pixelToAxialFrac(x, y, size) {
  return {
    q: ((SQRT3 / 3) * x - (1 / 3) * y) / size,
    r: ((2 / 3) * y) / size,
  };
}

export function cubeRound(q, r) {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}

export function pixelToAxial(x, y, size) {
  const f = pixelToAxialFrac(x, y, size);
  return cubeRound(f.q, f.r);
}

export function hexDistance(q1, r1, q2, r2) {
  const dq = q1 - q2;
  const dr = r1 - r2;
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
}

/** Corner offsets for a pointy-top hex of the given size. */
export function hexCorners(size) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push([Math.cos(a) * size, Math.sin(a) * size]);
  }
  return pts;
}

/** All hexes whose distance from origin is exactly `radius`. */
export function hexRing(radius) {
  if (radius <= 0) return [{ q: 0, r: 0 }];
  const out = [];
  let q = -radius;
  let r = radius;
  for (let side = 0; side < 6; side++) {
    for (let i = 0; i < radius; i++) {
      out.push({ q, r });
      q += HEX_DIRS[side][0];
      r += HEX_DIRS[side][1];
    }
  }
  return out;
}

/** All hexes within `radius`, centre first, ring by ring. */
export function hexSpiral(radius) {
  const out = [];
  for (let d = 0; d <= radius; d++) out.push(...hexRing(d));
  return out;
}
