// Game feel, kept small on purpose: every effect has a tier (small, medium,
// large) and returns to rest. Timings follow the arcade rulebook: 30 fps ticks,
// hit-stop of 1-4 ticks, directional shake of 1-3 px that settles in 150-300 ms,
// particles that live 200-500 ms, number pops that stay at least 650 ms.
//
// Everything here is plain data, so a game's state can be posted to the hooks
// module and restored after an approval pause.

import { font3, font3Width } from './gfx.js'

export const TICK = 1 / 30

export const ease = {
  linear: t => t,
  outCubic: t => 1 - (1 - t) ** 3,
  inCubic: t => t * t * t,
  inOutSine: t => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: t => {
    const c1 = 1.70158, c3 = c1 + 1
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2
  },
  outElastic: t => (t <= 0 ? 0 : t >= 1 ? 1 : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
export const lerp = (a, b, t) => a + (b - a) * t

// ---------- seeded random (mulberry32), state kept in the world ----------

export function rng(world) {
  let a = (world.seed = (world.seed + 0x6d2b79f5) | 0)
  a = Math.imul(a ^ (a >>> 15), a | 1)
  a ^= a + Math.imul(a ^ (a >>> 7), a | 61)
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296
}
export const rand = (world, a, b) => a + (b - a) * rng(world)
export const pick = (world, list) => list[Math.floor(rng(world) * list.length) % list.length]

// ---------- effects state ----------

export function makeFx() {
  return {
    parts: [], // { x, y, vx, vy, life, max, c, g }
    pops: [], // { x, y, s, c, life, max, big }
    sx: 0, sy: 0, svx: 0, svy: 0, // spring shake
    trauma: 0,
    stop: 0, // hit-stop seconds left
    flash: 0, // white flash seconds left
    flashes: [], // times of recent large flashes (cap 3 per second)
    t: 0,
    reduced: false,
  }
}

const MAX_PARTS = 48

/** A burst of n pixels from (x, y). */
export function burst(fx, x, y, n, colors, { speed = 40, life = 0.35, gravity = 60, up = 0, spread = Math.PI * 2, dir = -Math.PI / 2 } = {}) {
  if (fx.reduced) n = Math.ceil(n / 2)
  for (let i = 0; i < n; i++) {
    if (fx.parts.length >= MAX_PARTS) fx.parts.shift()
    const a = dir + (Math.random() - 0.5) * spread
    const s = speed * (0.4 + Math.random() * 0.8)
    const l = life * (0.6 + Math.random() * 0.6)
    fx.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - up, life: l, max: l, c: colors[i % colors.length], g: gravity })
  }
}

/** A floating number or word, e.g. "+$500". */
export function pop(fx, x, y, s, c, { life = 0.8, big = false } = {}) {
  fx.pops.push({ x, y, s, c, life, max: life, big })
  if (fx.pops.length > 6) fx.pops.shift()
}

/** Directional kick in px (screen shake as a spring, not random jitter). */
export function kick(fx, dx, dy) {
  if (fx.reduced) return
  fx.svx += dx * 18
  fx.svy += dy * 18
}

export function shake(fx, amount) {
  if (fx.reduced) return
  fx.trauma = Math.min(1, fx.trauma + amount)
}

export function hitstop(fx, ticks) {
  fx.stop = Math.max(fx.stop, ticks * TICK)
}

/** One white flash, at most three large flashes a second. */
export function flash(fx, ticks = 1) {
  if (fx.reduced) return
  fx.flashes = fx.flashes.filter(t => fx.t - t < 1)
  if (fx.flashes.length >= 3) return
  fx.flashes.push(fx.t)
  fx.flash = Math.max(fx.flash, ticks * TICK)
}

export function stepFx(fx, dt) {
  fx.t += dt
  for (const p of fx.parts) {
    p.vy += p.g * dt
    p.x += p.vx * dt
    p.y += p.vy * dt
    p.life -= dt
  }
  fx.parts = fx.parts.filter(p => p.life > 0)
  for (const p of fx.pops) {
    p.life -= dt
  }
  fx.pops = fx.pops.filter(p => p.life > 0)
  // spring back to rest: stiff, well damped (settles in ~200 ms)
  const k = 520, d = 26
  fx.svx += (-k * fx.sx - d * fx.svx) * dt
  fx.svy += (-k * fx.sy - d * fx.svy) * dt
  fx.sx += fx.svx * dt
  fx.sy += fx.svy * dt
  fx.trauma = Math.max(0, fx.trauma - 2.2 * dt)
  fx.flash = Math.max(0, fx.flash - dt)
}

/** The whole-pixel camera offset for this frame. */
export function offset(fx) {
  const tr = fx.trauma * fx.trauma
  const jx = tr * 3 * Math.sin(fx.t * 71.3)
  const jy = tr * 2 * Math.sin(fx.t * 53.9 + 1.7)
  return { x: Math.round(fx.sx + jx), y: Math.round(fx.sy + jy) }
}

// ---------- drawing ----------

export function drawFx(fx, cv) {
  for (const p of fx.parts) {
    const t = p.life / p.max
    cv.tint(p.x, p.y, p.c, t > 0.5 ? 1 : 0.35 + t)
  }
  for (const p of fx.pops) {
    const age = 1 - p.life / p.max
    const rise = ease.outCubic(Math.min(1, age * 1.6)) * (p.big ? 8 : 5)
    const alpha = age < 0.7 ? 1 : 1 - (age - 0.7) / 0.3
    const scale = p.big ? 2 : 1
    const w = font3Width(p.s, scale)
    font3(cv, p.s, Math.round(p.x - w / 2), Math.round(p.y - rise), p.c, scale, 0x0d1330, alpha)
  }
  if (fx.flash > 0) cv.wash(0xffffff, 0.75)
}
