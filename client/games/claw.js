// Claw Rush (抓金子): the Gold Miner rules, our own art. Pip works a winch on
// the snow; the claw swings like a pendulum; drop it, reel in what it grabs.
// Heavier things reel in slower, so a big nugget costs seconds. TNT explodes.
//
// Constants come from the open-source Gold Miner clones (swing ±70-75 deg,
// reel speed falling with mass, goals rising per level), cut down for a 40 s
// level: faster swing and reel, and a flatter weight curve so the worst grab
// costs about 5 s, not 15.
//
// A run goes level after level through the trading post until a level misses
// its goal. The score is everything banked over the run, so spending at the
// trading post never costs a place on the board. Rules use det.js maths so a
// posted run replays to the same score on the board's server.

import { C, PIP } from '../lib/palette.js'
import { MINER, CHEER, FRONT } from '../lib/pip.js'
import { font3, font3Width, font5, font5Width, mix, shade } from '../lib/gfx.js'
import * as J from '../lib/juice.js'
import * as D from '../lib/det.js'

export const meta = {
  id: 'claw',
  title: 'Claw Rush',
  zh: '抓金子',
  blurb: 'Drop the claw, reel in gold. Heavy is slow. TNT goes boom.',
  keys: [['↓', 'drop'], ['↑', 'dynamite']],
  accent: C.gold,
}

const LEVEL_TIME = 40
// Each level's goal rises by more than the last (+700, +1000, +1300, ...), and
// a level holds about the same gold, so every run ends somewhere: a casual
// run around level 5, a sharp one past level 12.
export const goalFor = lv => 450 + 400 * (lv - 1) + 150 * (lv - 1) * lv

const SWING = (70 * Math.PI) / 180
const PERIOD = 3.1 // seconds for a full swing
const OUT = 1.0 // dig heights per second
const BACK = 1.3

// ---------- item sprites (palette letters, local) ----------
const GP = { Y: 0xfff3a6, G: C.yellow, A: C.amber, R: C.clay, W: 0xffffff }
const RP = { L: C.mist, M: C.slate, D: C.steel, K: C.iron }
const DP = { W: 0xffffff, c: C.cyan, b: C.sky, d: 0x1a6fd0 }
const BP = { T: C.red, S: C.sand, s: 0x7d6457, L: C.peach, W: C.white }
const XP = { R: C.red, r: C.crimson, W: C.white, F: C.gold, K: C.iron }

const KINDS = {
  nugget: { v: 50, m: 2, r: 2, pal: GP, spr: ['.YG.', 'YGGA', '.AA.'] },
  gold: { v: 150, m: 3.5, r: 3, pal: GP, spr: ['..YY..', '.YGGG.', 'YGWGGA', '.GGGAA', '..AA..'] },
  big: {
    v: 500, m: 7, r: 5, pal: GP,
    spr: ['...YYYY...', '..YGGGGG..', '.YGWGGGGA.', 'YGGGGGGGAA', 'YGGGGGGGAA', '.GGGGGGAA.', '..AAGGAAR.', '...RAAR...'],
  },
  rock: { v: 15, m: 6, r: 3.5, pal: RP, spr: ['..LLM..', '.LMMMD.', 'LMMMMMD', 'MMMMMDD', '.DDDDK.'] },
  boulder: {
    v: 40, m: 10, r: 5.5, pal: RP,
    spr: ['...LLLM....', '..LMMMMMD..', '.LMMMMMMMD.', 'LMMMMMMMMDD', 'MMMMMMMMDDD', 'MMMMMMMDDDK', '.DDMMDDDDK.', '..KDDDDKK..'],
  },
  diamond: { v: 600, m: 1.5, r: 2.5, pal: DP, spr: ['.ccc.', 'cWccb', '.cbd.', '..d..'] },
  bag: { v: 0, m: 3, r: 3, pal: BP, spr: ['..TT..', '.LSSL.', 'SSLSSs', 'SSSSSs', 'SSSSss', '.ssss.'] },
  tnt: { v: 2, m: 0.6, r: 3, pal: XP, spr: ['..F...', '.rKr..', 'RWWWWR', 'RRRRRr', 'RRRRRr', 'RWWWWR', '.RRRr.'] },
}

// ---------- world ----------

export function create(w, h, seed, carry = {}) {
  const world = {
    kind: 'claw',
    w, h,
    seed: seed | 0,
    level: carry.level || 1,
    money: carry.money || 0,
    earned: carry.earned || 0, // banked over the whole run: the score
    dynamite: carry.dynamite ?? 1,
    strong: false,
    time: LEVEL_TIME,
    phase: 'ready',
    phaseT: 0,
    claw: { ph: Math.PI / 2, a: 0, state: 'swing', len: 0, held: null, holdT: 0, shut: 0 },
    items: [],
    scorch: [],
    pip: { mood: 'idle', t: 0 },
    total: 0, // money banked this level, for the results card
    shop: null,
  }
  fill(world)
  return world
}

function geom(world) {
  const ground = Math.max(12, Math.min(16, Math.round(world.h * 0.26)))
  const dig = world.h - ground
  return { ground, dig, px: Math.floor(world.w / 2), py: ground - 1, max: D.hypot(world.w / 2, dig) + 4 }
}

/** Lays out a fresh level by depth band; never blocks the straight drop completely. */
function fill(world) {
  const items = []
  const lv = world.level
  const bands = [
    [0.1, 0.38, ['nugget', 'nugget', 'nugget', 'gold', 'rock', 'rock']],
    [0.38, 0.68, ['gold', 'gold', 'gold', 'bag', 'rock', 'tnt', ...(lv > 1 ? ['diamond', 'tnt'] : [])]],
    [0.66, 0.95, ['big', 'big', 'boulder', 'diamond', 'bag', 'gold', ...(lv > 2 ? ['big', 'tnt'] : [])]],
  ]
  for (const [v0, v1, kinds] of bands) {
    for (const k of kinds) {
      const K = KINDS[k]
      for (let tries = 0; tries < 30; tries++) {
        const u = J.rand(world, 0.06, 0.94)
        const v = J.rand(world, v0, v1)
        const ok = items.every(o => {
          const du = (o.u - u) * world.w, dv = (o.v - v) * (world.h * 0.74)
          return D.hypot(du, dv) > o.r + K.r + 2.5
        })
        if (ok) {
          items.push({ k, u, v, r: K.r, id: items.length + 1, wob: 0 })
          break
        }
      }
    }
  }
  // a TNT tends to sit beside a rich target: put the first one next to the diamond
  world.items = items
}

function itemPos(world, it) {
  const g = geom(world)
  return { x: it.u * world.w, y: g.ground + it.v * g.dig }
}

function tip(world) {
  const g = geom(world)
  const L = world.claw.len * g.dig
  return { x: g.px + D.sin(world.claw.a) * L, y: g.py + D.cos(world.claw.a) * L, g }
}

// ---------- update ----------

export function update(world, dt, input, fx) {
  const cl = world.claw
  world.pip.t += dt
  world.phaseT += dt
  const pressed = a => input.includes(a)
  const drop = pressed('down') || pressed('action')

  if (world.phase === 'ready') {
    if (world.phaseT > 1.1 || drop) {
      world.phase = 'play'
      world.phaseT = 0
    }
    swing(world, dt)
    return []
  }
  if (world.phase === 'clear') {
    // a moment for the goal, then the trading post
    if (world.phaseT > 1.4) openShop(world)
    return []
  }
  if (world.phase === 'fail') return []
  if (world.phase === 'shop') {
    return updateShop(world, input)
  }

  const events = []
  world.time = Math.max(0, world.time - dt)
  cl.shut = Math.max(0, cl.shut - dt)

  if (cl.state === 'swing') {
    swing(world, dt)
    if (drop) {
      cl.state = 'out'
      events.push('drop')
    }
  } else if (cl.state === 'out') {
    cl.len += OUT * dt
    const { x, y, g } = tip(world)
    // grab?
    for (const it of world.items) {
      const p = itemPos(world, it)
      if (D.hypot(p.x - x, p.y - y) <= it.r + 1.2) {
        grab(world, it, fx, events)
        break
      }
    }
    if (cl.state === 'out' && (x < 1 || x > world.w - 2 || y > world.h - 1 || cl.len * g.dig > g.max)) {
      cl.state = 'back'
      events.push('miss')
    }
  } else if (cl.state === 'back') {
    const m = cl.held ? cl.held.m : 0
    let v = cl.held ? Math.min(BACK, (BACK * 1.6) / (m + 0.6)) : BACK
    if (world.strong) v = Math.min(BACK * 1.25, v * 1.5)
    cl.len -= v * dt
    if (cl.held && (pressed('up') || pressed('alt')) && world.dynamite > 0) {
      world.dynamite--
      const { x, y } = tip(world)
      J.burst(fx, x, y, 14, [C.amber, C.yellow, C.white, C.smoke], { speed: 50, life: 0.4 })
      J.kick(fx, 0, -1)
      J.hitstop(fx, 2)
      cl.held = null
      events.push('dynamite')
    }
    if (cl.len <= 0) {
      cl.len = 0
      if (cl.held) bank(world, fx, events)
      cl.state = cl.held || cl.holdT > 0 ? 'hold' : 'swing'
    }
  } else if (cl.state === 'hold') {
    cl.holdT -= dt
    swingIdle(world, dt)
    if (cl.holdT <= 0) cl.state = 'swing'
  }

  // TNT chains on a timer
  for (const it of world.items) {
    if (it.fuse !== undefined) {
      it.fuse -= dt
      if (it.fuse <= 0) explode(world, it, fx, events)
    }
    if (it.wob > 0) it.wob = Math.max(0, it.wob - dt)
  }
  world.items = world.items.filter(it => !it.gone)

  if (world.time <= 0 && cl.state !== 'back' && cl.state !== 'hold') {
    world.phase = world.money >= goalFor(world.level) ? 'clear' : 'fail'
    world.phaseT = 0
    events.push(world.phase === 'clear' ? 'clear' : 'over')
  }
  return events
}

function swing(world, dt) {
  const cl = world.claw
  cl.ph += ((2 * Math.PI) / PERIOD) * dt
  cl.a = D.sin(cl.ph) * SWING
}
function swingIdle(world, dt) {
  swing(world, dt * 0.6)
}

function grab(world, it, fx, events) {
  const cl = world.claw
  const K = KINDS[it.k]
  cl.state = 'back'
  cl.shut = 0.2
  if (it.k === 'tnt') {
    explode(world, it, fx, events)
    cl.held = { k: 'debris', v: 2, m: 0.5 }
    return
  }
  let v = K.v, m = K.m, bonus = null
  if (it.k === 'bag') {
    const r = J.rng(world)
    if (r < 0.15) { bonus = 'dynamite'; v = 0; m = 1 }
    else if (r < 0.3) { bonus = 'strong'; v = 0; m = 1 }
    else { v = 50 * (1 + Math.floor(J.rng(world) * 15)); m = 1 + Math.floor(J.rng(world) * 8) }
  }
  cl.held = { k: it.k, v, m, bonus }
  it.gone = true
  const p = itemPos(world, it)
  // medium tier: short freeze, a kick, a few glints
  J.hitstop(fx, it.k === 'big' || it.k === 'boulder' ? 2 : 1)
  J.kick(fx, Math.sign(D.sin(cl.a)) * 0.6, 0.8)
  if (it.k === 'diamond' || it.k === 'big') J.burst(fx, p.x, p.y, 8, [0xffffff, C.butter, C.cyan], { speed: 28, life: 0.3, gravity: 0 })
  else if (it.k === 'rock' || it.k === 'boulder') J.burst(fx, p.x, p.y, 5, [C.slate, C.steel], { speed: 22, life: 0.3, gravity: 80 })
  events.push(it.k === 'rock' || it.k === 'boulder' ? 'thud' : 'grab')
}

function bank(world, fx, events) {
  const cl = world.claw
  const h = cl.held
  const g = geom(world)
  cl.held = null
  cl.holdT = 0.45
  if (h.bonus === 'dynamite') {
    world.dynamite++
    J.pop(fx, g.px + 12, g.ground - 4, '+TNT', C.coral)
    events.push('bonus')
    world.pip.mood = 'cheer'
  } else if (h.bonus === 'strong') {
    world.strong = true
    J.pop(fx, g.px + 14, g.ground - 4, 'STRONG!', C.lime)
    events.push('bonus')
    world.pip.mood = 'cheer'
  } else {
    world.money += h.v
    world.total += h.v
    world.earned += h.v
    const rich = h.v >= 250
    J.pop(fx, g.px + 12, g.ground - 4, '+' + h.v, rich ? C.yellow : h.v < 40 ? C.slate : C.gold, { life: 0.9, big: rich })
    if (rich) J.burst(fx, g.px, g.ground - 2, 12, [C.yellow, C.butter, 0xffffff], { speed: 45, life: 0.45, up: 20 })
    events.push(rich ? 'cash-big' : h.v < 40 ? 'cash-low' : 'cash')
    world.pip.mood = rich ? 'cheer' : 'idle'
  }
  world.pip.t = 0
}

function explode(world, it, fx, events) {
  if (it.gone) return
  it.gone = true
  delete it.fuse
  const p = itemPos(world, it)
  const g = geom(world)
  const R = Math.max(7, 0.25 * g.dig)
  world.scorch.push({ u: it.u, v: it.v, r: R * 0.7 })
  if (world.scorch.length > 8) world.scorch.shift()
  for (const o of world.items) {
    if (o.gone) continue
    const q = itemPos(world, o)
    if (D.hypot(q.x - p.x, q.y - p.y) <= R + o.r) {
      if (o.k === 'tnt') { if (o.fuse === undefined) o.fuse = 0.1 }
      else o.gone = true
    }
  }
  // large tier: one flash, a freeze, trauma, lots of debris, and the blast drawn full size
  J.flash(fx, 1)
  J.hitstop(fx, 3)
  J.shake(fx, 0.75)
  J.burst(fx, p.x, p.y, 30, [C.amber, C.yellow, C.orange, C.red, C.smoke, C.white], { speed: 70, life: 0.5, gravity: 50 })
  fx.blasts = fx.blasts || []
  fx.blasts.push({ x: p.x, y: p.y, r: R, life: 0.25, max: 0.25 })
  world.pip.mood = 'shock'
  world.pip.t = 0
  events.push('boom')
}

// ---------- shop (between levels) ----------

export function openShop(world) {
  const lv = world.level
  const offers = [
    { id: 'dynamite', name: 'TNT stick', price: 60 + Math.floor(J.rng(world) * 120) + 10 * lv },
    { id: 'strong', name: 'Strong tea', price: 100 + Math.floor(J.rng(world) * 150) },
  ]
  world.phase = 'shop'
  world.phaseT = 0
  world.shop = { offers, sel: 0, bought: [] }
}

function updateShop(world, input) {
  const s = world.shop
  const n = s.offers.length + 1
  if (input.includes('left')) s.sel = (s.sel + n - 1) % n
  if (input.includes('right')) s.sel = (s.sel + 1) % n
  if (input.includes('action') || input.includes('down')) {
    if (s.sel === s.offers.length) return ['next']
    const o = s.offers[s.sel]
    if (!s.bought.includes(o.id) && world.money >= o.price) {
      world.money -= o.price
      s.bought.push(o.id)
      if (o.id === 'dynamite') world.dynamite++
      if (o.id === 'strong') world.strongNext = true
      return ['buy']
    }
    return ['nope']
  }
  return []
}

/** The next level, keeping money, dynamite and what was bought. */
export function nextLevel(world) {
  const carry = { level: world.level + 1, money: world.money, earned: world.earned, dynamite: world.dynamite }
  const nw = create(world.w, world.h, world.seed + 7919, carry)
  nw.strong = !!world.strongNext
  return nw
}

export function score(world) {
  return world.earned
}

export function overTitle(world) {
  return world.level > 1 ? 'Reached level ' + world.level : 'Short of the goal'
}

// ---------- draw ----------

const SKY_TOP = 0x1d2b53
const SKY_BOT = 0x7e6aa6
const SOIL = [0xb5683d, 0x9a4f31, 0x7a3a2a, 0x5e2c27, 0x432022, 0x2c1719]

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

export function draw(world, cv, fx, t) {
  const g = geom(world)
  const W = world.w, H = world.h
  // sky: dawn over the snow
  cv.vgrad(0, 0, W, g.ground, SKY_TOP, SKY_BOT, 5)
  // far ice hills
  for (let x = 0; x < W; x++) {
    const hh = Math.round(3 + 2 * Math.sin(x * 0.11 + 1.3) + 1.5 * Math.sin(x * 0.27))
    cv.rect(x, g.ground - 2 - hh, 1, hh, 0x9fb4d8)
  }
  // snow crust
  cv.rect(0, g.ground - 2, W, 2, C.white)
  for (let x = 0; x < W; x += 1) if (hash(x, 3) > 0.8) cv.set(x, g.ground - 3, C.white)
  // soil strata
  for (let y = g.ground; y < H; y++) {
    const d = (y - g.ground) / g.dig
    const band = Math.max(0, Math.min(SOIL.length - 1, Math.floor(d * SOIL.length + 0.15 * Math.sin(y * 0.7))))
    cv.rect(0, y, W, 1, SOIL[band])
  }
  // pebbles: static clusters, sparse
  for (let y = g.ground + 2; y < H; y += 3)
    for (let x = 1; x < W; x += 4) {
      const n = hash(x, y)
      if (n > 0.9) {
        const c = shade(cv.get(x, y), 0.12)
        cv.set(x, y, c)
        cv.set(x + 1, y, c)
      } else if (n < 0.05) cv.set(x, y, shade(cv.get(x, y), -0.18))
    }
  // scorch marks stay
  for (const s of world.scorch) {
    const cx = s.u * W, cy = g.ground + s.v * g.dig
    for (let y = Math.floor(cy - s.r); y <= cy + s.r; y++)
      for (let x = Math.floor(cx - s.r); x <= cx + s.r; x++) {
        const d = Math.hypot(x - cx, y - cy) / s.r
        if (d < 1 && y >= g.ground) cv.tint(x, y, 0x1a0f10, 0.45 * (1 - d * d))
      }
  }

  // items
  for (const it of world.items) {
    const K = KINDS[it.k]
    const p = itemPos(world, it)
    const sw = K.spr[0].length, sh = K.spr.length
    let x = p.x - sw / 2, y = p.y - sh / 2
    if (it.fuse !== undefined) x += Math.sin(t * 90) > 0 ? 1 : 0
    cv.sprite(K.spr, K.pal, x, y)
    // little glints on rich things
    if ((it.k === 'diamond' || it.k === 'big') && Math.floor(t * 2 + it.id) % 5 === 0) cv.set(x + sw - 1, y, 0xffffff)
    if (it.k === 'tnt' && Math.floor(t * 8) % 2 === 0) cv.set(x + 2, y - 1, C.yellow)
  }

  // surface: winch frame, rope, claw, Pip
  drawRig(world, cv, g, t)

  // blast rings (honest radius on the first tick)
  if (fx.blasts) {
    for (const b of fx.blasts) {
      const k = 1 - b.life / b.max
      cv.ring(b.x, b.y, b.r * (0.75 + 0.25 * k), k < 0.5 ? 0xffffff : C.amber, 1.4)
      b.life -= J.TICK
    }
    fx.blasts = fx.blasts.filter(b => b.life > 0)
  }

  drawHud(world, cv, g, t)
  if (world.phase === 'shop') drawShop(world, cv, t)
}

function drawRig(world, cv, g, t) {
  const cl = world.claw
  const px = g.px, py = g.py
  // winch: two posts and a spool
  const wood = 0x8a5a3c, woodD = 0x5c3a2b
  cv.rect(px - 4, g.ground - 9, 1, 8, woodD)
  cv.rect(px + 3, g.ground - 9, 1, 8, woodD)
  cv.rect(px - 4, g.ground - 10, 8, 1, wood)
  const spin = cl.state === 'back' ? Math.floor(t * 18) % 2 : cl.state === 'out' ? Math.floor(t * 12) % 2 : 0
  cv.rect(px - 2, g.ground - 8, 4, 3, spin ? 0xd08a4f : 0xb87445)
  cv.rect(px - 2, g.ground - 7, 4, 1, 0x6b3f26)
  // rope
  const { x: tx, y: ty } = tip(world)
  const heavy = cl.held ? Math.min(1, cl.held.m / 10) : 0
  const ropeC = mix(0xd9c7a0, C.clay, heavy)
  const sag = cl.held ? heavy * 1.5 * Math.sin(t * 9) : 0
  const L = Math.hypot(tx - px, ty - (g.ground - 6))
  const steps = Math.max(2, Math.ceil(L))
  for (let i = 0; i <= steps; i++) {
    const k = i / steps
    const x = px + (tx - px) * k + Math.sin(k * Math.PI) * sag
    const y = g.ground - 6 + (ty - (g.ground - 6)) * k
    cv.set(x, y, ropeC)
  }
  // claw head and prongs, turned along the rope
  const dx = Math.sin(cl.a), dy = Math.cos(cl.a)
  const nx = dy, ny = -dx
  const tremble = cl.held && cl.held.m > 5 ? (Math.floor(t * 30) % 2 ? 0.5 : -0.5) : 0
  const hx = tx + nx * tremble, hy = ty
  const metal = 0xd7dbe6, metalD = 0x7a8296
  cv.rect(hx - 1, hy - 1, 3, 2, metal)
  const open = cl.held || cl.shut > 0 ? 0.6 : 1.6
  for (const side of [-1, 1]) {
    const bx = hx + nx * side * 1.5, by = hy + ny * side * 1.5
    cv.line(bx, by, bx + dx * 2.5 + nx * side * open, by + dy * 2.5 + ny * side * open, metalD)
    cv.set(bx + dx * 3 + nx * side * (open - 0.8), by + dy * 3 + ny * side * (open - 0.8), metal)
  }
  // what the claw holds hangs under it
  if (cl.held && KINDS[cl.held.k]) {
    const K = KINDS[cl.held.k]
    cv.sprite(K.spr, K.pal, hx + dx * 3 - K.spr[0].length / 2, hy + dy * 3 + 1 - 1)
  } else if (cl.held && cl.held.k === 'debris') {
    cv.set(hx + dx * 3, hy + dy * 3 + 1, C.smoke)
    cv.set(hx + dx * 3 + 1, hy + dy * 3 + 2, C.iron)
  }
  // Pip on the left of the winch, cranking
  const mood = world.pip.mood
  const pt = world.pip.t
  let spr = MINER
  let bob = 0
  if (mood === 'cheer' && pt < 1.0) {
    spr = CHEER_MINER
    bob = Math.floor(pt * 8) % 2 ? -1 : 0
  } else if (mood === 'shock' && pt < 0.9) {
    spr = SHOCK_MINER
    bob = pt < 0.2 ? -2 : 0
  } else if (cl.state === 'back') {
    bob = Math.floor(t * 9) % 2 ? -1 : 0
  } else if (Math.floor(t * 0.7) % 6 === 0 && (t * 0.7) % 1 < 0.08) spr = MINER_BLINK
  cv.sprite(spr, PIP, px - 16, g.ground - 2 - spr.length + bob)
  // the crank handle Pip turns
  const hand = cl.state === 'back' ? [[-6, -6], [-5, -8], [-6, -5], [-7, -7]][Math.floor(t * 12) % 4] : [-6, -6]
  cv.set(px - 4 + hand[0] + 4, g.ground + hand[1] + 0, 0x6b3f26)
}

const CHEER_MINER = ['D.RRRRR..D', 'DRRRYRRR.D', 'RRRRRRRRR.', ...CHEER.slice(3)]
const SHOCK_MINER = ['..RRRRR...', '.RRRYRRR..', 'RRRRRRRRR.', '.BWWWWWWB.', '.BWKOOKWB.', '.BPWOOWPB.', ...FRONT.slice(6)]
const MINER_BLINK = MINER.map((r, i) => (i === 3 ? '.BWWWWWWB.' : r))

function money(n) {
  return '$' + n.toLocaleString('en-US')
}

function drawHud(world, cv, g, t) {
  const goal = goalFor(world.level)
  const reached = world.money >= goal
  const secs = Math.ceil(world.time)
  // left: money toward the goal
  let c = cv.text(1, 0, ' ' + money(world.money) + ' ', reached ? C.lime : C.gold, undefined, true)
  c = cv.text(c, 0, reached ? '✓ goal ' + money(goal) : '/ ' + money(goal), reached ? C.lime : 0xb9b3d6)
  // right: level, dynamite, clock
  const low = secs <= 10 && world.phase === 'play'
  const clock = String(secs).padStart(2, ' ') + 's '
  const right = 'level ' + world.level + '   TNT ' + world.dynamite + '   '
  const x = cv.cols - clock.length - right.length - 1
  cv.text(x, 0, right, 0xb9b3d6)
  cv.text(x + right.length, 0, clock, low && Math.floor(t * 2) % 2 ? C.red : C.white, undefined, low)
  if (world.strong) cv.text(1, 1, ' strong tea ', C.lime)

  if (world.phase === 'ready') {
    const s = 'LEVEL ' + world.level
    const w = font5Width(s)
    font5(cv, s, Math.round((world.w - w) / 2), g.ground + 5, C.white, 0x2c1719)
    const sub = 'reach ' + money(goal) + ' in ' + LEVEL_TIME + ' seconds'
    cv.textCenter(Math.floor((g.ground + 16) / 2), ' ' + sub + ' ', C.butter, 0x2c1719)
  }
  if (world.phase === 'clear') {
    const s = 'GOAL!'
    font5(cv, s, Math.round((world.w - font5Width(s)) / 2), g.ground + 5, C.lime, 0x2c1719)
    cv.textCenter(Math.floor((g.ground + 16) / 2), ' ' + money(world.total) + ' this level · trading post next ', C.butter, 0x2c1719)
  }
}

function drawShop(world, cv, t) {
  const s = world.shop
  cv.wash(0x0d1330, 0.55)
  const top = Math.floor(cv.rows / 2) - 3
  cv.textCenter(top, ' Trading post ', C.butter, undefined, true)
  cv.textCenter(top + 1, ' ' + money(world.money) + ' to spend ', 0xb9b3d6)
  const cards = [...s.offers.map(o => (s.bought.includes(o.id) ? '✓ ' + o.name : o.name + ' ' + money(o.price))), 'Next level ▸']
  const widths = cards.map(c => c.length + 4)
  let x = Math.floor((cv.cols - widths.reduce((a, b) => a + b + 2, -2)) / 2)
  cards.forEach((c, i) => {
    const sel = i === s.sel
    const afford = i === s.offers.length || s.bought.includes(s.offers[i].id) || world.money >= s.offers[i].price
    cv.text(x, top + 3, '  ' + c + '  ', sel ? C.night : afford ? C.white : C.steel, sel ? C.gold : 0x29366f, sel)
    x += widths[i] + 2
  })
  cv.textCenter(top + 5, '← → choose · space buy', 0x8f8fb3)
}
