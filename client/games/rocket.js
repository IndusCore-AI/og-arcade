// Little Rocket (小火箭): Pip flies a tiny rocket against bugs. Galaga's shape
// (waves fly into a formation, then dive at you, a boss to finish the stage)
// with auto-fire and one axis of movement, since a terminal only reports key
// presses. Holding a key glides: the first press carries the rocket past the
// keyboard's repeat delay, each repeat extends it a little.
//
// Danger has one colour, red, and only enemies and their bullets wear it.
// Pip's snowballs are ice blue. Fish are power-ups.

import { C, PIP } from '../lib/palette.js'
import { font5, font5Width, mix } from '../lib/gfx.js'
import * as J from '../lib/juice.js'

export const meta = {
  id: 'rocket',
  title: 'Little Rocket',
  zh: '小火箭',
  blurb: 'Dodge, auto-fire, beat the Heisenbug.',
  keys: [['← →', 'move'], ['space', 'snow bomb']],
}

const STAGE_TIME = 45

// ---------- sprites ----------
const SHIP = ['...W...', '..WPW..', '..WEW..', '.RWWWR.', 'RRWBWRR', 'R.WWW.R', '..O.O..']
const SHIP_PAL = { W: C.white, P: C.blue, E: C.amber, R: 0x4e6ad8, B: C.blueHi, O: C.amber }
const FLAME = [['..Y.Y..', '...O...'], ['..O.O..', '..Y.Y..'], ['.Y...Y.', '..O.O..']]
const BUG = [
  ['K...K', '.KRK.', 'RWRWR', 'RKRKR', 'K.R.K'],
  ['.K.K.', '.KRK.', 'RWRWR', 'RKRKR', '.K.K.'],
]
const MOTH = [
  ['M.....M', 'MMRRRMM', '.MRWRM.', 'MMRRRMM', 'M.....M'],
  ['.......', 'MMRRRMM', 'MMRWRMM', 'MMRRRMM', '.......'],
]
const BEETLE = [
  ['..A.A..', '.PPPPP.', 'PPWPWPP', 'PPPPPPP', '.PPPPP.', 'P.P.P.P'],
  ['.A...A.', '.PPPPP.', 'PPWPWPP', 'PPPPPPP', '.PPPPP.', '.P.P.P.'],
]
const BOSS = [
  '..A.......A..',
  '...A.....A...',
  '..RRRRRRRRR..',
  '.RRRRRRRRRRR.',
  'RRWWRRRRRWWRR',
  'RRWKRRRRRWKRR',
  'RRRRRMMMRRRRR',
  '.RRRMMMMMRRR.',
  'R.RRRRRRRRR.R',
  'R..R.R.R.R..R',
]
const FISH = ['.YY..Y', 'YYYYYY', '.YY..Y']
const EP = { R: C.red, W: C.white, K: 0x3a1030, M: C.crimson, P: 0xa13aa8, A: C.pink }
const EP_HURT = { ...EP, P: C.red }

const KIND = {
  bug: { hp: 1, spr: BUG, pts: [50, 100], w: 5, h: 5 },
  moth: { hp: 1, spr: MOTH, pts: [80, 160], w: 7, h: 5 },
  beetle: { hp: 2, spr: BEETLE, pts: [150, 400], w: 7, h: 6 },
}

// ---------- world ----------

export function create(w, h, seed, carry = {}) {
  return {
    kind: 'rocket',
    w, h,
    seed: seed | 0,
    t: 0,
    stage: carry.level || 1,
    phase: 'ready',
    phaseT: 0,
    time: STAGE_TIME,
    p: { x: w / 2, vx: 0, glide: 0, lastMove: -9, dir: 0, hp: 3, inv: 0, power: 1, fireT: 0, bombs: 1, kick: 0, hitT: 0 },
    shots: [],
    bullets: [],
    foes: [],
    fish: [],
    boss: null,
    waves: 0,
    next: 0.6,
    diveT: 2.5,
    score: 0,
    grazes: 0,
    kills: 0,
    nextId: 1,
  }
}

const shipY = world => world.h - 9

export function resize(world, w, h) {
  const kx = w / world.w, ky = h / world.h
  world.p.x *= kx
  for (const list of [world.shots, world.bullets, world.foes, world.fish]) for (const o of list) { o.x *= kx; o.y *= ky; if (o.sx !== undefined) { o.sx *= kx; o.sy *= ky } }
  if (world.boss) { world.boss.x *= kx; world.boss.y *= ky }
  world.w = w
  world.h = h
}

function slots(world) {
  // formation slots: row 0 beetles, row 1 moths, row 2 bugs
  const W = world.w
  const rows = [
    { kind: 'beetle', n: 4, y: 7 },
    { kind: 'moth', n: 6, y: 14 },
    { kind: 'bug', n: 8, y: 20 },
  ]
  const out = []
  for (const r of rows) {
    const gap = Math.min(9, Math.floor((W - 8) / r.n))
    const x0 = W / 2 - ((r.n - 1) * gap) / 2
    for (let i = 0; i < r.n; i++) out.push({ kind: r.kind, sx: x0 + i * gap, sy: r.y })
  }
  return out
}

function spawnWave(world) {
  const all = slots(world)
  const taken = new Set(world.foes.map(f => f.slot))
  const wave = world.waves++
  let pickKinds
  if (wave === 0) pickKinds = ['bug']
  else if (wave === 1) pickKinds = ['bug', 'moth']
  else pickKinds = ['beetle', 'moth', 'bug']
  const free = all.map((s, i) => ({ ...s, i })).filter(s => !taken.has(s.i) && pickKinds.includes(s.kind))
  const n = Math.min(free.length, wave === 2 ? 6 : 8)
  const fromLeft = wave % 2 === 0
  const flagged = Math.floor(J.rng(world) * n)
  for (let k = 0; k < n; k++) {
    const s = free[k]
    const left = (k % 2 === 0) === fromLeft
    world.foes.push({
      id: world.nextId++, slot: s.i, kind: s.kind, hp: KIND[s.kind].hp + (world.stage > 2 && s.kind === 'moth' ? 1 : 0),
      sx: s.sx, sy: s.sy,
      x: left ? -6 : world.w + 6, y: world.h * 0.35,
      state: 'enter', st: -k * 0.16, ox: left ? -6 : world.w + 6, oy: world.h * 0.35,
      flag: k === flagged, hurt: 0, shot: false,
    })
  }
}

// ---------- update ----------

export function update(world, dt, input, fx) {
  const ev = []
  world.t += dt
  world.phaseT += dt
  const p = world.p
  const has = a => input.includes(a)

  // movement (glide model)
  for (const a of input) {
    if (a === 'left' || a === 'right') {
      const d = a === 'left' ? -1 : 1
      const fresh = world.t - p.lastMove > 0.6 || p.dir !== d
      if (p.dir !== d) p.vx = 0
      p.dir = d
      p.x += d * 2
      p.glide = world.t + (fresh ? 0.38 : 0.14)
      p.lastMove = world.t
    } else if (a === 'down') {
      p.glide = 0
      p.dir = 0
    }
  }
  const V = 0.62 * world.w
  if (world.t < p.glide) p.vx = p.dir * V
  else p.vx *= Math.max(0, 1 - dt / 0.05)
  p.x = J.clamp(p.x + p.vx * dt, 4, world.w - 4)
  p.kick = Math.max(0, p.kick - dt * 30)

  if (world.phase === 'ready') {
    if (world.phaseT > 1.2) { world.phase = 'play'; world.phaseT = 0 }
    return ev
  }
  if (world.phase === 'over' || world.phase === 'clear') return ev

  world.time = Math.max(0, world.time - dt)
  p.inv = Math.max(0, p.inv - dt)
  p.hitT = Math.max(0, p.hitT - dt)

  // bomb: clears bullets, hurts everything
  if ((has('action') || has('up')) && p.bombs > 0) {
    p.bombs--
    world.bullets = []
    for (const f of world.foes) damage(world, f, 2, fx, ev)
    if (world.boss) hurtBoss(world, 6, fx, ev)
    J.flash(fx, 1)
    J.shake(fx, 0.5)
    J.burst(fx, p.x, shipY(world), 24, [C.white, C.ice, C.cyan], { speed: 80, life: 0.45, gravity: 0 })
    ev.push('bomb')
  }

  // auto-fire
  p.fireT -= dt
  if (p.fireT <= 0) {
    p.fireT = 1 / 7
    const y = shipY(world) - 1
    if (world.shots.length < 8) {
      if (p.power === 1) world.shots.push({ x: p.x, y, vx: 0, born: world.t })
      else if (p.power === 2) world.shots.push({ x: p.x - 2, y, vx: 0, born: world.t }, { x: p.x + 2, y, vx: 0, born: world.t })
      else world.shots.push({ x: p.x, y, vx: 0, born: world.t }, { x: p.x - 1, y, vx: -0.2, born: world.t }, { x: p.x + 1, y, vx: 0.2, born: world.t })
      p.kick = 1
    }
  }
  for (const s of world.shots) {
    s.y -= 1.6 * world.h * dt
    s.x += s.vx * world.h * dt
  }
  world.shots = world.shots.filter(s => s.y > -2)

  // waves on a clock; the boss comes at 26 s or once three waves are cleared
  world.next -= dt
  if (world.waves < 3 && (world.next <= 0 || world.foes.length === 0)) {
    spawnWave(world)
    world.next = 8
  }
  if (!world.boss && (world.time < STAGE_TIME - 26 || (world.waves >= 3 && world.foes.length === 0)) && world.phase === 'play') {
    world.boss = { x: world.w / 2, y: -12, hp: 40 + 8 * (world.stage - 1), max: 40 + 8 * (world.stage - 1), t: 0, pat: 0, patT: 0, hurt: 0, dir: 1 }
    world.phase = 'boss'
    ev.push('boss')
  }

  // foes
  const diveEvery = Math.max(0.6, 1.4 - 0.15 * (world.stage - 1) - (world.waves >= 3 ? 0.4 : 0))
  world.diveT -= dt
  const sway = Math.sin(world.t * 1.3) * 3
  for (const f of world.foes) {
    f.hurt = Math.max(0, f.hurt - dt)
    if (f.state === 'enter') {
      f.st += dt
      const k = J.clamp(f.st / 1.3, 0, 1)
      if (f.st < 0) continue
      const e = J.ease.inOutSine(k)
      // a swoop: out to the side, then into the slot
      const midX = world.w / 2 + (f.ox < 0 ? -1 : 1) * world.w * 0.15
      const midY = world.h * 0.62
      const a = 1 - e
      f.x = a * a * f.ox + 2 * a * e * midX + e * e * (f.sx + sway)
      f.y = a * a * f.oy + 2 * a * e * midY + e * e * f.sy
      if (k >= 1) f.state = 'form'
    } else if (f.state === 'form') {
      f.x = f.sx + sway
      f.y = f.sy + Math.sin(world.t * 2 + f.slot) * 0.6
    } else if (f.state === 'dive') {
      f.st += dt
      f.y += (0.42 + 0.05 * world.stage) * world.h * dt
      f.x = f.dx + Math.sin(f.st * 3.2) * world.w * 0.12 + (f.tx - f.dx) * Math.min(1, f.st / 1.4)
      if (!f.shot && f.y > world.h * 0.38) {
        f.shot = true
        aim(world, f.x, f.y + 2, p.x, shipY(world), 0.45 + 0.04 * world.stage)
      }
      if (f.y > world.h + 6) {
        f.state = 'enter'
        f.st = 0
        f.ox = f.x
        f.oy = -8
        f.shot = false
      }
    }
  }
  if (world.diveT <= 0) {
    world.diveT = diveEvery
    const ready = world.foes.filter(f => f.state === 'form')
    if (ready.length) {
      const f = J.pick(world, ready)
      f.state = 'dive'
      f.st = 0
      f.dx = f.x
      f.tx = p.x
    }
  }

  // boss
  const b = world.boss
  if (b) {
    b.t += dt
    b.hurt = Math.max(0, b.hurt - dt)
    if (b.y < 9) b.y += 14 * dt
    else {
      b.x += b.dir * world.w * 0.18 * dt
      if (b.x < 10 || b.x > world.w - 10) b.dir *= -1
      b.patT += dt
      const pat = b.pat % 3
      if (pat === 0 && b.patT > 0.9) {
        b.patT = 0
        for (const s of [-0.25, 0, 0.25]) aim(world, b.x, b.y + 6, p.x + s * world.w, shipY(world), 0.4)
        if (Math.floor(b.t / 0.9) % 4 === 3) b.pat++
      } else if (pat === 1 && b.patT > 2.0) {
        b.patT = 0
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2 + b.t
          world.bullets.push({ x: b.x, y: b.y + 4, vx: Math.cos(a) * 0.22 * world.h, vy: Math.abs(Math.sin(a)) * 0.22 * world.h + 4, g: false })
        }
        b.pat++
      } else if (pat === 2) {
        if (b.patT > 0.12) {
          b.patT = 0
          b.burst = (b.burst || 0) + 1
          world.bullets.push({ x: b.x + Math.sin(b.t * 6) * 4, y: b.y + 6, vx: Math.sin(b.t * 3) * 0.15 * world.h, vy: 0.42 * world.h, g: false })
          if (b.burst > 12) { b.burst = 0; b.pat++ }
        }
      }
    }
  }

  // enemy bullets, grazes and hits
  const py = shipY(world) + 3
  for (const e of world.bullets) {
    e.x += e.vx * dt
    e.y += e.vy * dt
    const d = Math.hypot(e.x - p.x, e.y - py)
    if (d < 1.2 && p.inv <= 0) { hit(world, fx, ev); e.dead = true }
    else if (d < 3 && !e.g && p.inv <= 0) {
      e.g = true
      world.grazes++
      world.score += 10
      J.burst(fx, e.x, e.y, 2, [C.white, C.ice], { speed: 18, life: 0.15, gravity: 0 })
    }
  }
  world.bullets = world.bullets.filter(e => !e.dead && e.y < world.h + 2 && e.x > -2 && e.x < world.w + 2 && e.y > -4)
  if (world.bullets.length > 40) world.bullets.splice(0, world.bullets.length - 40)

  // my shots against foes and the boss
  for (const s of world.shots) {
    for (const f of world.foes) {
      const K = KIND[f.kind]
      if (Math.abs(s.x - f.x) <= K.w / 2 + 0.5 && Math.abs(s.y - f.y) <= K.h / 2 + 1) {
        s.dead = true
        damage(world, f, 1, fx, ev)
        break
      }
    }
    if (!s.dead && b && Math.abs(s.x - b.x) <= 7 && Math.abs(s.y - b.y) <= 5) {
      s.dead = true
      hurtBoss(world, 1, fx, ev)
    }
  }
  world.shots = world.shots.filter(s => !s.dead)
  world.foes = world.foes.filter(f => f.hp > 0)

  // body contact on a dive
  for (const f of world.foes) {
    if (f.state === 'dive' && Math.abs(f.x - p.x) < 4 && Math.abs(f.y - (shipY(world) + 3)) < 3 && p.inv <= 0) {
      hit(world, fx, ev)
      damage(world, f, 9, fx, ev)
    }
  }
  world.foes = world.foes.filter(f => f.hp > 0)

  // fish power-ups drift down
  for (const fi of world.fish) {
    fi.y += 0.25 * world.h * dt
    fi.x += Math.sin(world.t * 4 + fi.y) * 0.2
    if (Math.abs(fi.x - p.x) < 4 && Math.abs(fi.y - (shipY(world) + 2)) < 3) {
      fi.dead = true
      if (p.power < 3) p.power++
      else world.score += 500
      J.pop(fx, p.x, shipY(world) - 3, p.power < 3 ? 'POWER' : '+500', C.yellow)
      J.burst(fx, p.x, shipY(world), 8, [C.yellow, C.butter], { speed: 30, life: 0.3, gravity: 0 })
      ev.push('power')
    }
  }
  world.fish = world.fish.filter(fi => !fi.dead && fi.y < world.h + 3)

  if (p.hp <= 0 && world.phase !== 'over') {
    world.phase = 'over'
    world.phaseT = 0
    ev.push('over')
  } else if (world.time <= 0 && world.phase !== 'over') {
    world.phase = 'over'
    world.escaped = !!world.boss
    world.phaseT = 0
    ev.push('over')
  }
  return ev
}

function aim(world, x, y, tx, ty, speed) {
  const a = Math.atan2(ty - y, tx - x)
  world.bullets.push({ x, y, vx: Math.cos(a) * speed * world.h, vy: Math.sin(a) * speed * world.h, g: false })
}

function damage(world, f, n, fx, ev) {
  if (f.hp <= 0) return
  f.hp -= n
  f.hurt = 0.1
  if (f.hp > 0) {
    J.burst(fx, f.x, f.y, 3, [C.white, C.pink], { speed: 20, life: 0.15, gravity: 0 })
    ev.push('hit')
    return
  }
  const K = KIND[f.kind]
  const pts = f.state === 'dive' ? K.pts[1] : K.pts[0]
  world.score += pts
  world.kills++
  J.burst(fx, f.x, f.y, f.kind === 'beetle' ? 12 : 8, [C.white, C.red, C.pink, C.amber], { speed: 36, life: 0.35, gravity: 10 })
  if (f.state === 'dive') J.pop(fx, f.x, f.y - 3, '+' + pts, C.butter)
  J.hitstop(fx, f.kind === 'beetle' ? 1 : 0)
  if (f.flag) world.fish.push({ x: f.x, y: f.y })
  ev.push('kill')
}

function hurtBoss(world, n, fx, ev) {
  const b = world.boss
  if (!b || b.y < 9) return
  b.hp -= n
  b.hurt = 0.08
  if (b.hp <= 0) {
    world.score += 2000 + (world.p.hp === 3 ? 1000 : 0)
    J.flash(fx, 1)
    J.hitstop(fx, 4)
    J.shake(fx, 0.9)
    for (let i = 0; i < 3; i++) J.burst(fx, b.x + (i - 1) * 4, b.y, 14, [C.white, C.red, C.amber, C.yellow, C.pink], { speed: 60, life: 0.5, gravity: 20 })
    J.pop(fx, b.x, b.y - 4, '+2000', C.yellow, { big: true, life: 1.1 })
    world.boss = null
    world.bullets = []
    world.phase = 'clear'
    world.phaseT = 0
    ev.push('clear')
  } else if (Math.floor(b.hp) % 4 === 0) {
    J.burst(fx, b.x, b.y + 2, 2, [C.white], { speed: 20, life: 0.12, gravity: 0 })
  }
}

function hit(world, fx, ev) {
  const p = world.p
  p.hp--
  p.inv = 1.2
  p.hitT = 0.12
  if (p.power > 1) p.power--
  J.hitstop(fx, 2)
  J.shake(fx, 0.45)
  J.kick(fx, 0, 1.2)
  J.burst(fx, p.x, shipY(world) + 2, 14, [C.white, C.amber, C.red], { speed: 45, life: 0.4 })
  world.bullets = world.bullets.filter(e => Math.hypot(e.x - p.x, e.y - shipY(world)) > 10)
  ev.push('hurt')
}

export function score(world) {
  return world.score
}

export function overTitle(world, clear) {
  if (world.phase === 'clear' || clear) return 'Bug squashed!'
  if (world.p.hp <= 0) return 'Rocket down'
  return world.escaped ? 'It got away' : "Time's up"
}

export function nextLevel(world) {
  return create(world.w, world.h, world.seed + 31, { level: world.stage + 1 })
}

// ---------- draw ----------

function hash(i) {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

export function draw(world, cv, fx, t) {
  const W = world.w, H = world.h
  cv.vgrad(0, 0, W, H, 0x07091a, 0x1d1240)
  // two-layer starfield, scrolling down
  for (let i = 0; i < 40; i++) {
    const near = i < 12
    const sp = near ? 22 : 8
    const x = Math.floor(hash(i) * W)
    const y = Math.floor((hash(i + 99) * H + world.t * sp) % H)
    cv.set(x, y, near ? 0x9aa6e8 : 0x3a4280)
    if (near) cv.set(x, y - 1, 0x2a3070)
  }

  // fish
  for (const fi of world.fish) cv.sprite(FISH, { Y: Math.floor(t * 6) % 2 ? C.yellow : C.butter }, fi.x - 3, fi.y - 1)

  // foes
  for (const f of world.foes) {
    const K = KIND[f.kind]
    const fr = K.spr[Math.floor(t * 4 + f.slot) % 2]
    if (f.hurt > 0) cv.silhouette(fr, f.x - K.w / 2, f.y - K.h / 2, 0xffffff)
    else cv.sprite(fr, f.kind === 'beetle' && f.hp < 2 ? EP_HURT : EP, f.x - K.w / 2, f.y - K.h / 2)
  }

  // boss, glitching
  const b = world.boss
  if (b) {
    const rows = BOSS.map((r, i) => (Math.sin(t * 13 + i * 3.1) > 0.92 ? '.' + r.slice(0, -1) : r))
    if (b.hurt > 0) cv.silhouette(rows, b.x - 6, b.y - 5, 0xffffff)
    else cv.sprite(rows, { ...EP, M: Math.floor(t * 8) % 2 ? C.crimson : C.plum }, b.x - 6, b.y - 5)
    // health bar
    const bw = Math.min(W - 10, 40)
    const bx = Math.round((W - bw) / 2)
    cv.rect(bx, 1, bw, 1, 0x3a1030)
    cv.rect(bx, 1, Math.round((bw * b.hp) / b.max), 1, C.red)
  }

  // bullets: red with a dim tail
  for (const e of world.bullets) {
    cv.set(e.x, e.y - 1, 0x6a1030)
    cv.set(e.x, e.y, Math.floor(t * 12) % 2 ? C.pink : C.red)
  }
  // shots: ice blue snowballs, round on the first tick
  for (const s of world.shots) {
    const fresh = world.t - s.born < 0.05
    cv.set(s.x, s.y, C.white)
    cv.set(s.x, s.y + 1, C.cyan)
    if (fresh) { cv.set(s.x - 1, s.y + 1, C.ice); cv.set(s.x + 1, s.y + 1, C.ice) }
  }

  // the ship
  const p = world.p
  const sy = shipY(world) + Math.round(p.kick)
  const blink = p.inv > 0 && Math.floor(t * 12) % 2 === 0
  if (!blink) {
    if (p.hitT > 0) cv.silhouette(SHIP, p.x - 3, sy, 0xffffff)
    else {
      cv.sprite(SHIP, SHIP_PAL, p.x - 3, sy)
      // the 1 px core is the hitbox, and it shows
      cv.set(p.x, sy + 3, 0xffffff)
    }
    const fl = FLAME[Math.floor(t * 15) % 3]
    cv.sprite(fl, { Y: C.yellow, O: C.amber }, p.x - 3, sy + 7)
    if (p.power >= 2) { cv.set(p.x - 4, sy + 4, C.cyan); cv.set(p.x + 4, sy + 4, C.cyan) }
  }

  // HUD (text)
  cv.text(1, 0, ' ' + world.score.toLocaleString('en-US') + ' ', C.white, undefined, true)
  const hearts = '♥'.repeat(Math.max(0, p.hp)) + '♡'.repeat(Math.max(0, 3 - p.hp))
  const right = 'stage ' + world.stage + '  bomb ' + p.bombs + '  ' + Math.ceil(world.time) + 's '
  cv.text(cv.cols - right.length - hearts.length - 3, 0, hearts, C.red)
  cv.text(cv.cols - right.length - 1, 0, right, 0xb9b3d6)
  if (world.phase === 'ready') {
    const s = 'STAGE ' + world.stage
    font5(cv, s, Math.round((W - font5Width(s)) / 2), Math.round(H * 0.4), C.white, 0x29366f)
  }
  if (b && b.y < 9) {
    const s = 'HEISENBUG'
    if (Math.floor(t * 4) % 2) font5(cv, s, Math.round((W - font5Width(s)) / 2), Math.round(H * 0.4), C.red, 0x2a0a20)
  }
}
