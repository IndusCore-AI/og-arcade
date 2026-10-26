// Brick Break (打砖块): the bouncing-ball brick breaker. Breakout's rules on a
// night sky, the iPod's Brick in spirit, and the Ballz rush when a multi-ball
// capsule turns one ball into a dozen.
//
// A terminal reports key presses only, so the paddle moves like Little
// Rocket: a press nudges it at once and glides, and holding the key keeps the
// glide going. Rules use det.js maths and the world's own seeded random
// numbers, so the weekly board can replay a run move by move.
//
// Danger has one colour, red: only the hearts and a lost ball wear it. Bricks
// take the warm-to-cool rainbow, power-up capsules each have their own colour.

import { C } from '../lib/palette.js'
import { font5, font5Width, shade } from '../lib/gfx.js'
import * as J from '../lib/juice.js'
import * as D from '../lib/det.js'

export const meta = {
  id: 'brick',
  title: 'Brick Break',
  zh: '打砖块',
  blurb: 'Bounce the ball, break the wall, catch the power-ups.',
  keys: [['← →', 'move'], ['space', 'launch']],
  accent: C.cyan,
}

// ---------- layout ----------

const COLS = 8, ROWS = 7
const BX = 4, BY = 5 // top-left of the brick grid
const BW = 7, BH = 2 // a brick
const PX = 8, PY = 3 // pitch: one pixel of mortar between bricks
const TOP = 2 // the top wall's pixel row; the ball stays below it
const RIGHT = 71 // the right wall's pixel column
const PAD_Y = 37 // the paddle's top edge
const PAD_W = 11, PAD_WIDE = 17
const SERVE_AFTER = 3
const MAX_BALLS = 12

// warm at the top, cool at the bottom; never pure red
const ROW_C = [C.pink, C.orange, C.amber, C.yellow, C.lime, C.cyan, C.sky]

const CAPS = {
  multi: { c: C.cyan, name: 'multi' },
  wide: { c: C.lime, name: 'wide' },
  slow: { c: C.butter, name: 'slow' },
  fire: { c: C.orange, name: 'fire' },
}

// Layout letters: n normal (row colour), t tough (two hits), s steel (never
// breaks); capital letters are normal bricks with a colour of their own.
const CH = {
  n: { k: 'normal' },
  t: { k: 'tough' },
  s: { k: 'steel' },
  B: { k: 'normal', c: C.blue },
  H: { k: 'normal', c: C.blueHi },
  W: { k: 'normal', c: C.white },
  K: { k: 'normal', c: 0x3a4170 },
  O: { k: 'normal', c: C.amber },
  P: { k: 'normal', c: C.pink },
  R: { k: 'normal', c: C.rose },
  L: { k: 'normal', c: C.lime },
}

const LAYOUTS = [
  { name: 'The wall', rows: ['nnnnnnnn', 'nnnnnnnn', 'nnnnnnnn', 'nnnnnnnn', 'nnnnnnnn'] },
  { name: 'Pyramid', rows: ['...tt...', '..nnnn..', '.nnnnnn.', 'nnnnnnnn', 'nnnnnnnn', 'nnnnnnnn'] },
  { name: 'Heart', rows: ['.RR..RR.', 'RPPRRPPR', 'RPPPPPPR', '.RPPPPR.', '..RPPR..', '...RR...'] },
  { name: 'Checkers', rows: ['n.n.n.n.', '.n.n.n.n', 'n.n.n.n.', '.t.t.t.t', 'n.n.n.n.', '.n.n.n.n', 'n.n.n.n.'] },
  { name: 'Invader', rows: ['..L..L..', '.LLLLLL.', 'LL.LL.LL', 'LLLLLLLL', '.L.LL.L.', 'L......L'] },
  { name: "Pip's face", rows: ['..BBBB..', '.BHBBBB.', 'BHWWWWBB', 'BWKWWKWB', 'BWWOOWWB', 'BPWWWWPB', '.BBWWBB.'] },
  { name: 'Fortress', rows: ['tttttttt', 'nnnnnnnn', 's.nnnn.s', 'nnnnnnnn', 'nn.ss.nn', 'nnnnnnnn'] },
  { name: 'Diamond', rows: ['...tt...', '..nnnn..', '.nnnnnn.', 'nnnnnnnn', '.nnnnnn.', '..nnnn..', '...nn...'] },
]

// ---------- world ----------

export function create(w, h, seed, carry = {}) {
  const world = {
    kind: 'brick',
    w, h,
    seed: seed | 0,
    level: carry.level || 1,
    score: carry.score || 0,
    lives: carry.lives ?? 3,
    t: 0,
    phase: 'ready',
    phaseT: 0,
    layout: 0,
    name: '',
    lastLayout: carry.lastLayout ?? -1,
    cells: [], // COLS * ROWS: null or { k, hp, col, hitT }
    left: 0, // breakable bricks still standing
    pad: { x: w / 2, vx: 0, glide: 0, lastMove: -9, dir: 0, w: PAD_W, hitT: -9 },
    balls: [], // { x, y, vx, vy, tr: [[x, y], ...] }
    serve: true,
    serveT: 0,
    caps: [], // falling capsules { x, y, k }
    wideT: 0,
    slowT: 0,
    fireT: 0,
    combo: 0,
    hits: 0, // bricks broken this level; the ball speeds up with them
    breaks: [], // recent breaks, flashed white where the brick stood
    bonus: 0,
  }
  build(world)
  serveBall(world)
  return world
}

function build(world) {
  let idx = 0
  if (world.level > 1) {
    do idx = 1 + Math.floor(J.rng(world) * (LAYOUTS.length - 1))
    while (idx === world.lastLayout)
  }
  const L = LAYOUTS[idx]
  world.layout = idx
  world.name = L.name
  // later levels turn some plain bricks tough
  const tough = world.level >= 3 ? Math.min(0.4, (world.level - 2) * 0.08) : 0
  world.cells = new Array(COLS * ROWS).fill(null)
  let left = 0
  L.rows.forEach((row, r) => {
    for (let c = 0; c < COLS; c++) {
      const spec = CH[row[c]]
      if (!spec) continue
      let k = spec.k
      if (k === 'normal' && spec.c === undefined && tough > 0 && J.rng(world) < tough) k = 'tough'
      world.cells[r * COLS + c] = { k, hp: k === 'tough' ? 2 : 1, col: spec.c ?? ROW_C[r], hitT: -9 }
      if (k !== 'steel') left++
    }
  })
  world.left = left
}

function serveBall(world) {
  world.serve = true
  world.serveT = 0
  world.balls = [{ x: world.pad.x, y: PAD_Y - 1, vx: 0, vy: 0, tr: [] }]
}

function speedOf(world) {
  const s = Math.min(70, 34 + 4 * (world.level - 1) + 0.45 * world.hits)
  return world.slowT > 0 ? s * 0.65 : s
}

function launch(world) {
  world.serve = false
  const b = world.balls[0]
  const r = J.rng(world)
  // a moving paddle throws the ball its way
  const side = world.pad.dir && world.t < world.pad.glide ? world.pad.dir : r < 0.5 ? -1 : 1
  const a = side * (0.25 + 0.3 * J.rng(world))
  const s = speedOf(world)
  b.vx = D.sin(a) * s
  b.vy = -D.cos(a) * s
}

/** Index of the brick under a point, or -1. */
function cellAt(world, x, y) {
  const fx = x - BX, fy = y - BY
  if (fx < 0 || fy < 0) return -1
  const c = Math.floor(fx / PX), r = Math.floor(fy / PY)
  if (c >= COLS || r >= ROWS) return -1
  if (fx - c * PX >= BW || fy - r * PY >= BH) return -1
  const i = r * COLS + c
  return world.cells[i] ? i : -1
}

// ---------- update ----------

export function update(world, dt, input, fx) {
  const ev = []
  world.t += dt
  world.phaseT += dt
  if (world.breaks.length) world.breaks = world.breaks.filter(b => world.t - b.t < 0.2)
  movePaddle(world, dt, input)

  if (world.phase === 'over' || world.phase === 'done') return ev
  if (world.phase === 'dying') {
    if (world.phaseT > 1.1) {
      world.phase = 'over'
      ev.push('over')
    }
    return ev
  }
  if (world.phase === 'clear') {
    if (world.phaseT > 1.6) {
      world.phase = 'done'
      ev.push('next')
    }
    return ev
  }
  if (world.phase === 'ready') {
    stick(world)
    if (world.phaseT > 1.2) {
      world.phase = 'play'
      world.phaseT = 0
      world.serveT = 0
    }
    return ev
  }

  // play
  world.wideT = Math.max(0, world.wideT - dt)
  world.slowT = Math.max(0, world.slowT - dt)
  world.fireT = Math.max(0, world.fireT - dt)
  const p = world.pad
  const want = world.wideT > 0 ? PAD_WIDE : PAD_W
  p.w += J.clamp(want - p.w, -30 * dt, 30 * dt)

  if (world.serve) {
    stick(world)
    world.serveT += dt
    if (input.includes('action') || input.includes('up') || world.serveT > SERVE_AFTER) launch(world)
  } else {
    const s = speedOf(world)
    for (const b of world.balls) moveBall(world, b, s, dt, fx, ev)
    world.balls = world.balls.filter(b => !b.lost)
  }

  // capsules fall; the paddle catches them
  for (const cp of world.caps) {
    cp.y += 18 * dt
    if (cp.y + 2 >= PAD_Y && cp.y <= PAD_Y + 1 && Math.abs(cp.x - p.x) <= p.w / 2 + 1.5) {
      cp.got = true
      power(world, cp.k, fx, ev)
    }
  }
  world.caps = world.caps.filter(cp => !cp.got && cp.y < world.h)

  if (world.left <= 0) clearLevel(world, fx, ev)
  else if (!world.serve && world.balls.length === 0) loseBall(world, fx, ev)
  return ev
}

function stick(world) {
  const b = world.balls[0]
  if (!b) return
  b.x = world.pad.x
  b.y = PAD_Y - 1
  b.tr = []
}

function movePaddle(world, dt, input) {
  const p = world.pad
  if (world.phase === 'dying' || world.phase === 'over') return
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
  const V = 0.9 * world.w
  if (world.t < p.glide) p.vx = p.dir * V
  else p.vx *= Math.max(0, 1 - dt / 0.05)
  const half = p.w / 2
  p.x = J.clamp(p.x + p.vx * dt, 1 + half, RIGHT - half)
}

function moveBall(world, b, s, dt, fx, ev) {
  // hold the speed the rules ask for
  const cur = Math.sqrt(b.vx * b.vx + b.vy * b.vy) || 1
  b.vx *= s / cur
  b.vy *= s / cur
  b.tr.unshift([b.x, b.y])
  if (b.tr.length > 3) b.tr.length = 3
  const n = Math.max(1, Math.ceil((s * dt) / 0.5))
  for (let k = 0; k < n && !b.lost; k++) {
    // across: walls, then bricks
    let nx = b.x + (b.vx * dt) / n
    if (nx < 1) {
      nx = 2 - nx
      b.vx = Math.abs(b.vx)
    } else if (nx >= RIGHT) {
      nx = Math.min(RIGHT - 0.001, 2 * RIGHT - nx)
      b.vx = -Math.abs(b.vx)
    }
    const ix = cellAt(world, nx, b.y)
    if (ix >= 0) {
      const through = world.fireT > 0 && world.cells[ix].k !== 'steel'
      hitBrick(world, ix, fx, ev)
      if (through) b.x = nx
      else b.vx = -b.vx
    } else b.x = nx

    // down: top wall, paddle, bricks, the floor
    let ny = b.y + (b.vy * dt) / n
    if (ny < TOP + 1) {
      ny = 2 * (TOP + 1) - ny
      b.vy = Math.abs(b.vy)
    }
    const p = world.pad
    if (b.vy > 0 && b.y < PAD_Y && ny >= PAD_Y && Math.abs(b.x - p.x) <= p.w / 2 + 0.75) {
      paddleBounce(world, b, s, fx, ev)
      ny = PAD_Y - 0.01
    }
    const iy = cellAt(world, b.x, ny)
    if (iy >= 0) {
      const through = world.fireT > 0 && world.cells[iy].k !== 'steel'
      hitBrick(world, iy, fx, ev)
      if (through) b.y = ny
      else b.vy = -b.vy
    } else b.y = ny
    if (b.y > world.h) b.lost = true
  }
}

function paddleBounce(world, b, s, fx, ev) {
  const p = world.pad
  // where it lands sets the angle: the middle sends it up, the ends out wide
  const o = J.clamp((b.x - p.x) / (p.w / 2 + 0.75), -1, 1)
  let a = o * 1.05
  if (Math.abs(a) < 0.12) a = (o < 0 || (o === 0 && b.vx < 0)) ? -0.12 : 0.12
  b.vx = D.sin(a) * s
  b.vy = -D.cos(a) * s
  p.hitT = world.t
  world.combo = 0
  ev.push('blip')
  J.burst(fx, b.x, PAD_Y, 3, [C.ice, C.white], { speed: 18, life: 0.18, gravity: 0, spread: 1.6 })
}

function hitBrick(world, i, fx, ev) {
  const cell = world.cells[i]
  const c = i % COLS, r = Math.floor(i / COLS)
  const x = BX + c * PX, y = BY + r * PY
  cell.hitT = world.t
  if (cell.k === 'steel') {
    J.burst(fx, x + 3.5, y + 1, 2, [C.white, C.slate], { speed: 16, life: 0.15, gravity: 0 })
    ev.push('tough')
    return
  }
  if (cell.k === 'tough' && cell.hp > 1 && world.fireT <= 0) {
    cell.hp--
    J.burst(fx, x + 3.5, y + 1, 3, [C.white, C.mist], { speed: 20, life: 0.18, gravity: 40 })
    ev.push('tough')
    return
  }
  world.cells[i] = null
  world.left--
  world.hits++
  world.combo++
  const mult = Math.min(8, world.combo)
  const pts = (ROWS - r) * 10 * (cell.k === 'tough' ? 2 : 1) * mult
  world.score += pts
  world.breaks.push({ x, y, t: world.t })
  J.burst(fx, x + 3.5, y + 1, 6, [cell.col, shade(cell.col, 0.45), C.white], { speed: 30, life: 0.32, gravity: 70 })
  // the multiplier pops under the brick, short, so it never covers the score row
  if (mult >= 2) J.pop(fx, x + 3.5, y + 4, 'x' + mult, mult >= 6 ? C.white : mult >= 4 ? C.yellow : C.butter)
  // medium tier, kept to milestones so a multi-ball rally doesn't stutter
  if (cell.k === 'tough' || mult === 4 || mult === 6 || mult === 8) {
    J.hitstop(fx, 1)
    J.kick(fx, 0, -0.5)
  }
  ev.push('brick')
  if (world.left > 0 && world.caps.length < 3 && J.rng(world) < 0.12) {
    const q = J.rng(world)
    const k = q < 0.35 ? 'multi' : q < 0.6 ? 'wide' : q < 0.8 ? 'slow' : 'fire'
    world.caps.push({ x: x + 3.5, y: y + 1, k })
  }
}

/** Keeps a ball from travelling nearly flat, which would rally forever. */
function steep(b, s) {
  const min = 0.4 * s
  if (Math.abs(b.vy) >= min) return
  b.vy = b.vy > 0 ? min : -min
  b.vx = (b.vx < 0 ? -1 : 1) * Math.sqrt(Math.max(0, s * s - min * min))
}

function power(world, k, fx, ev) {
  const p = world.pad
  if (k === 'wide') world.wideT = 12
  else if (k === 'slow') world.slowT = 8
  else if (k === 'fire') world.fireT = 6
  else if (k === 'multi') {
    if (world.serve) launch(world)
    const s = speedOf(world)
    const add = []
    for (const b of world.balls) {
      for (const a of [-0.42, 0.42]) {
        if (world.balls.length + add.length >= MAX_BALLS) break
        const ca = D.cos(a), sa = D.sin(a)
        const nb = { x: b.x, y: b.y, vx: b.vx * ca - b.vy * sa, vy: b.vx * sa + b.vy * ca, tr: [] }
        steep(nb, s)
        add.push(nb)
      }
    }
    world.balls.push(...add)
  }
  ev.push('power')
  J.pop(fx, p.x, PAD_Y - 5, CAPS[k].name, CAPS[k].c)
  J.burst(fx, p.x, PAD_Y, 8, [CAPS[k].c, C.white], { speed: 30, life: 0.3, gravity: 0, spread: 2.4 })
}

function loseBall(world, fx, ev) {
  const p = world.pad
  world.lives--
  world.combo = 0
  world.caps = []
  world.wideT = world.slowT = world.fireT = 0
  ev.push('lose')
  J.shake(fx, 0.5)
  J.kick(fx, 0, 1.2)
  if (world.lives <= 0) {
    world.phase = 'dying'
    world.phaseT = 0
    world.balls = []
    J.hitstop(fx, 3)
    J.burst(fx, p.x, PAD_Y, 22, [C.white, C.blueHi, C.ice, C.red], { speed: 50, life: 0.5, gravity: 60 })
  } else {
    J.burst(fx, p.x, PAD_Y + 2, 8, [C.red, C.pink], { speed: 30, life: 0.3, gravity: 30 })
    p.w = PAD_W
    serveBall(world)
  }
}

function clearLevel(world, fx, ev) {
  world.phase = 'clear'
  world.phaseT = 0
  world.bonus = 200 * world.level
  world.score += world.bonus
  world.caps = []
  for (const b of world.balls) J.burst(fx, b.x, b.y, 4, [C.white, C.yellow], { speed: 24, life: 0.3, gravity: 0 })
  world.balls = []
  J.hitstop(fx, 4)
  J.flash(fx, 1)
  J.shake(fx, 0.6)
  ev.push('clear')
}

export function score(world) {
  return world.score
}

export function overTitle(world) {
  return world.lives <= 0 ? 'Out of balls' : 'Game over'
}

/** The next level keeps the score and the lives left. */
export function nextLevel(world) {
  return create(world.w, world.h, world.seed + 104729, {
    level: world.level + 1,
    score: world.score,
    lives: world.lives,
    lastLayout: world.layout,
  })
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
  cv.vgrad(0, 0, W, H, 0x07091a, 0x1a1745, 6)
  // a still sky with a few slow twinkles
  for (let i = 0; i < 26; i++) {
    const x = 1 + Math.floor(hash(i) * (W - 2))
    const y = TOP + 1 + Math.floor(hash(i + 77) * (H - TOP - 6))
    const tw = Math.sin(t * 1.3 + i * 2.1) > 0.6
    cv.set(x, y, tw ? 0x5a64a8 : 0x2a3068)
  }

  // walls with rivets
  const wall = 0x34406e, rivet = 0x6f7ab8
  cv.rect(0, TOP, W, 1, wall)
  cv.rect(0, TOP, 1, H - TOP, wall)
  cv.rect(RIGHT, TOP, 1, H - TOP, wall)
  for (let x = 3; x < W; x += 6) cv.set(x, TOP, rivet)
  for (let y = TOP + 4; y < H; y += 6) {
    cv.set(0, y, rivet)
    cv.set(RIGHT, y, rivet)
  }

  // bricks
  for (let i = 0; i < world.cells.length; i++) if (world.cells[i]) drawBrick(cv, world, i, world.cells[i])
  // a white flash where a brick just broke
  for (const b of world.breaks) {
    const a = 1 - (world.t - b.t) / 0.2
    if (a <= 0) continue
    for (let y = b.y; y < b.y + BH; y++) for (let x = b.x; x < b.x + BW; x++) cv.tint(x, y, 0xffffff, a * 0.8)
  }

  // capsules: a little pill with a white glint
  for (const cp of world.caps) {
    const c = CAPS[cp.k].c
    const x = Math.round(cp.x - 1), y = Math.floor(cp.y)
    const glint = Math.floor(t * 6) % 2 === 0
    cv.rect(x, y, 3, 1, shade(c, 0.4))
    cv.set(x + 1, y, glint ? 0xffffff : shade(c, 0.6))
    cv.rect(x, y + 1, 3, 1, c)
  }

  // balls, with a short trail
  const fire = world.fireT > 0
  for (const b of world.balls) {
    const tail = fire ? C.orange : C.ice
    for (let k = b.tr.length - 1; k >= 0; k--) cv.tint(b.tr[k][0], b.tr[k][1], tail, [0.7, 0.42, 0.2][k])
    cv.set(b.x, b.y, fire ? C.yellow : 0xffffff)
  }

  drawPaddle(cv, world, t)
  drawHud(cv, world, t)

  // overlays
  if (world.phase === 'ready') {
    const s = 'LEVEL ' + world.level
    font5(cv, s, Math.round((W - font5Width(s)) / 2), 26, C.white, 0x29366f)
    cv.textCenter(17, ' ' + world.name + ' ', C.butter)
  } else if (world.phase === 'play' && world.serve && world.serveT > 0.8) {
    cv.textCenter(16, 'space launches', 0x8f8fb3)
  } else if (world.phase === 'clear' || world.phase === 'done') {
    font5(cv, 'CLEAR!', Math.round((W - font5Width('CLEAR!')) / 2), 26, C.lime, 0x29366f, 0xd8ff8a)
    cv.textCenter(17, ' level bonus +' + world.bonus.toLocaleString('en-US') + ' ', C.butter)
  } else if (world.phase === 'dying' || world.phase === 'over') {
    cv.wash(0x0d1330, Math.min(0.35, world.phaseT * 0.5))
  }
}

function drawBrick(cv, world, i, cell) {
  const c = i % COLS, r = Math.floor(i / COLS)
  const x = BX + c * PX, y = BY + r * PY
  let base, top
  if (cell.k === 'steel') {
    base = C.steel
    top = C.slate
  } else if (cell.k === 'tough') {
    base = cell.hp > 1 ? C.mist : 0x9a9ba8
    top = cell.hp > 1 ? 0xf2f2f6 : 0xc8c9d0
  } else {
    base = cell.col
    top = shade(cell.col, 0.38)
  }
  if (world.t - cell.hitT < 0.07) base = top = 0xffffff
  cv.rect(x, y, BW, 1, top)
  cv.rect(x, y + 1, BW, 1, base)
  cv.set(x, y, shade(top, 0.3))
  cv.set(x + BW - 1, y + 1, shade(base, -0.28))
  if (cell.k === 'steel') {
    cv.set(x + 1, y + 1, 0xc2c3c7)
    cv.set(x + BW - 2, y + 1, 0xc2c3c7)
  } else if (cell.k === 'tough' && cell.hp === 1) {
    const k = shade(base, -0.45)
    cv.set(x + 2, y, k)
    cv.set(x + 3, y + 1, k)
    cv.set(x + 4, y, k)
  }
}

function drawPaddle(cv, world, t) {
  const p = world.pad
  if (world.phase === 'over') return
  if (world.phase === 'dying' && (world.phaseT > 0.35 || Math.floor(t * 16) % 2)) return
  const squash = world.t - p.hitT < 0.1 ? 1 : 0
  const w = Math.round(p.w) + squash * 2
  const x = Math.round(p.x - w / 2)
  const y = PAD_Y + squash
  const body = world.fireT > 0 ? C.orange : C.blueHi
  cv.rect(x, y, w, 1, C.white)
  cv.rect(x, y + 1, w, 1, body)
  cv.set(x, y, C.ice)
  cv.set(x + w - 1, y, C.ice)
  cv.set(x, y + 1, C.indigo)
  cv.set(x + w - 1, y + 1, C.indigo)
}

function drawHud(cv, world, t) {
  let col = cv.text(1, 0, ' ' + world.score.toLocaleString('en-US') + ' ', C.white, undefined, true)
  if (world.combo >= 2 && world.phase === 'play') cv.text(col, 0, 'x' + Math.min(8, world.combo), world.combo >= 4 ? C.yellow : C.butter, undefined, true)
  const right = 'level ' + world.level + ' '
  const xr = cv.cols - right.length - 1
  cv.text(xr, 0, right, 0xb9b3d6)
  const hearts = '♥'.repeat(Math.max(0, world.lives)) + '♡'.repeat(Math.max(0, 3 - world.lives))
  let x = xr - hearts.length - 2
  cv.text(x, 0, hearts, C.red)
  // active power-ups, each in its capsule's colour, blinking as they run out
  for (const [k, left] of [['slow', world.slowT], ['wide', world.wideT], ['fire', world.fireT]]) {
    if (left <= 0) continue
    x -= k.length + 2
    if (left > 2 || Math.floor(t * 4) % 2 === 0) cv.text(x, 0, k, CAPS[k].c)
  }
}
