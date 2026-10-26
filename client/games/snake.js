// Snake (贪吃蛇): the Nokia classic on a dark checkerboard. Eat fish, grow,
// never bite the walls or your own tail. The speed climbs as you eat, a golden
// fish turns up with every fifth one for a few seconds, and each week picks
// one of five mazes, so everyone on the board plays the same field.
//
// The rules run on whole numbers: a grid of cells, ticks for time, and a speed
// counted in thousandths of a cell per tick. A replay lands on the same score
// on any JavaScript engine. Drawing reads the world and never writes to it.

import { C } from '../lib/palette.js'
import { font5, font5Width, mix, shade } from '../lib/gfx.js'
import * as J from '../lib/juice.js'

export const meta = {
  id: 'snake',
  title: 'Snake',
  zh: '贪吃蛇',
  blurb: 'Eat the fish, grow long, never bite your tail.',
  keys: [['arrows', 'turn']],
  accent: C.lime,
}

const COLS = 36 // cells of 2x2 px; the outer ring is wall
const ROWS = 19
const TOP = 2 // the grid starts under the HUD row
const READY = 36 // ticks before the snake sets off on its own
const DIE = 30 // ticks for the segments to pop, head to tail
const GOLD_TICKS = 180 // a golden fish stays 6 s
const SPEED0 = 250 // thousandths of a cell per tick: 7.5 cells a second
const SPEED_MAX = 500 // 15 cells a second
const RAMP = 45 // fish to reach full speed
const GROW = 2 // segments per fish
const FULL_BONUS = 1000

const DX = [1, 0, -1, 0]
const DY = [0, 1, 0, -1]
const DIR = { right: 0, down: 1, left: 2, up: 3 }

// ---------- mazes (one a week, chosen by the week's seed) ----------

function box(add, x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) add(x, y)
}

// Every maze keeps row 9 clear ahead of the start (head at column 12)
const MAZES = [
  { name: 'Open Field', build() {} },
  {
    name: 'Four Pillars',
    build(add) {
      for (const [x, y] of [[8, 4], [26, 4], [8, 13], [26, 13]]) box(add, x, y, x + 1, y + 1)
    },
  },
  {
    name: 'Twin Bars',
    build(add) {
      box(add, 8, 4, 27, 4)
      box(add, 8, 14, 27, 14)
    },
  },
  {
    name: 'Corner Brackets',
    build(add) {
      box(add, 4, 3, 9, 3); box(add, 4, 3, 4, 6)
      box(add, 26, 3, 31, 3); box(add, 31, 3, 31, 6)
      box(add, 4, 15, 9, 15); box(add, 4, 12, 4, 15)
      box(add, 26, 15, 31, 15); box(add, 31, 12, 31, 15)
    },
  },
  {
    name: 'The Cross',
    build(add) {
      box(add, 17, 1, 18, 5)
      box(add, 17, 13, 18, 17)
      box(add, 2, 9, 6, 9)
      box(add, 29, 9, 33, 9)
    },
  },
]

export const mazes = MAZES.map(m => m.name)

// ---------- world ----------

export function create(w, h, seed) {
  const world = {
    kind: 'snake',
    w, h,
    seed: seed | 0,
    maze: 0,
    grid: '',
    body: [], // cell indices, head first
    dir: 0,
    queue: [], // up to three turns, applied one per move
    acc: 0,
    speed: SPEED0,
    grow: 0,
    fish: -1,
    gold: null, // { at, left, max }
    eaten: 0,
    tier: 1,
    tierAt: -99,
    score: 0,
    phase: 'ready',
    phaseT: 0,
    tick: 0,
    steps: 0,
    gulps: [], // the step each fish was eaten on, for the bulge running down the body
    cause: null,
    bonus: 0,
  }
  world.maze = Math.floor(J.rng(world) * MAZES.length) % MAZES.length
  const g = []
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) g.push(x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 ? '#' : '.')
  MAZES[world.maze].build((x, y) => { g[y * COLS + x] = '#' })
  world.grid = g.join('')
  for (let i = 0; i < 4; i++) world.body.push(9 * COLS + 12 - i)
  world.fish = spawn(world)
  return world
}

/** A free cell picked by the world's random numbers, or -1 when the board is full. */
function spawn(world) {
  const free = []
  for (let i = 0; i < world.grid.length; i++) {
    if (world.grid[i] === '#' || i === world.fish || (world.gold && world.gold.at === i)) continue
    if (world.body.indexOf(i) >= 0) continue
    free.push(i)
  }
  if (!free.length) return -1
  return free[Math.floor(J.rng(world) * free.length) % free.length]
}

const center = idx => ({ x: (idx % COLS) * 2 + 1, y: TOP + Math.floor(idx / COLS) * 2 + 1 })

// ---------- update ----------

export function update(world, dt, input, fx) {
  const ev = []
  world.tick++
  world.phaseT++
  if (world.phase === 'over') return ev
  if (world.phase === 'dying') {
    dying(world, fx, ev)
    return ev
  }

  for (const a of input) if (DIR[a] !== undefined) turn(world, DIR[a])

  if (world.phase === 'ready') {
    const go = input.some(a => DIR[a] !== undefined || a === 'action')
    if (!go && world.phaseT < READY) return ev
    world.phase = 'play'
    world.phaseT = 0
    // a key sets off at once; the clock running out waits for the next step
    if (go) world.acc = 1000 - world.speed
  }

  if (world.gold && --world.gold.left <= 0) world.gold = null

  world.acc += world.speed
  if (world.acc >= 1000) {
    world.acc -= 1000
    move(world, fx, ev)
  }
  return ev
}

/** Queues a turn unless it repeats or reverses the last one queued. */
function turn(world, d) {
  const last = world.queue.length ? world.queue[world.queue.length - 1] : world.dir
  if (d === last || d === (last + 2) % 4 || world.queue.length >= 3) return
  world.queue.push(d)
}

function move(world, fx, ev) {
  if (world.queue.length) world.dir = world.queue.shift()
  const head = world.body[0]
  const x = (head % COLS) + DX[world.dir]
  const y = Math.floor(head / COLS) + DY[world.dir]
  const n = y * COLS + x
  if (world.grid[n] === '#') return die(world, fx, ev, x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 ? 'wall' : 'maze')
  // the tail leaves its cell this step unless the snake is growing
  const hit = world.body.indexOf(n)
  if (hit >= 0 && !(world.grow === 0 && hit === world.body.length - 1)) return die(world, fx, ev, 'tail')
  world.body.unshift(n)
  if (world.grow > 0) world.grow--
  else world.body.pop()
  world.steps++
  if (n === world.fish) eat(world, fx, ev)
  else if (world.gold && n === world.gold.at) eatGold(world, fx, ev)
}

function eat(world, fx, ev) {
  const p = center(world.fish)
  world.eaten++
  const pts = 10 * world.tier
  world.score += pts
  world.grow += GROW
  world.gulps.push(world.steps)
  if (world.gulps.length > 6) world.gulps.shift()
  // small tier: a number, a few scales, a nudge the way the snake is going
  J.pop(fx, Math.min(world.w - 7, Math.max(7, p.x)), Math.max(8, p.y - 2), '+' + pts, C.butter)
  J.burst(fx, p.x, p.y, 6, [C.yellow, C.gold, C.butter], { speed: 26, life: 0.3, gravity: 0 })
  J.kick(fx, DX[world.dir] * 0.4, DY[world.dir] * 0.4)
  ev.push('eat')

  world.speed = Math.min(SPEED_MAX, SPEED0 + Math.floor((world.eaten * (SPEED_MAX - SPEED0)) / RAMP))
  const tier = Math.min(10, 1 + Math.floor(world.eaten / 5))
  if (tier > world.tier) {
    world.tier = tier
    world.tierAt = world.tick // the HUD lights up the new speed
    ev.push('faster')
  }

  world.fish = spawn(world)
  if (world.eaten % 5 === 0 && !world.gold) {
    const at = spawn(world)
    if (at >= 0) world.gold = { at, left: GOLD_TICKS, max: GOLD_TICKS }
  }
  if (world.fish < 0) full(world, fx, ev)
}

function eatGold(world, fx, ev) {
  const p = center(world.gold.at)
  const secs = Math.ceil(world.gold.left / 30)
  const pts = 50 + 5 * secs
  world.score += pts
  world.gold = null
  // medium tier: a short freeze and a bigger shower
  J.hitstop(fx, 1)
  J.burst(fx, p.x, p.y, 12, [C.white, C.butter, C.yellow, C.gold], { speed: 40, life: 0.4, gravity: 0 })
  J.pop(fx, Math.min(world.w - 9, Math.max(9, p.x)), Math.max(10, p.y - 3), '+' + pts, C.yellow, { big: true, life: 0.9 })
  ev.push('gold')
}

function die(world, fx, ev, cause) {
  world.phase = 'dying'
  world.phaseT = 0
  world.cause = cause
  world.queue = []
  const p = center(world.body[0])
  // large tier: freeze, one flash, trauma, a kick the way it crashed
  J.hitstop(fx, 3)
  J.shake(fx, 0.6)
  J.flash(fx, 1)
  J.kick(fx, DX[world.dir] * 1.2, DY[world.dir] * 1.2)
  J.burst(fx, p.x + DX[world.dir], p.y + DY[world.dir], 16, [C.white, C.red, C.pink, C.lime], { speed: 45, life: 0.4, gravity: 0 })
  ev.push('die')
}

function full(world, fx, ev) {
  world.bonus = FULL_BONUS
  world.score += FULL_BONUS
  world.phase = 'dying'
  world.phaseT = 0
  world.cause = 'full'
  J.flash(fx, 1)
  J.pop(fx, world.w / 2, world.h / 2, '+' + FULL_BONUS, C.yellow, { big: true, life: 1.2 })
  ev.push('gold')
}

const popped = (len, t) => Math.min(len, Math.max(0, Math.ceil((len * t) / DIE)))

function dying(world, fx, ev) {
  const len = world.body.length
  const from = popped(len, world.phaseT - 1)
  const to = popped(len, world.phaseT)
  const cols = world.cause === 'full' ? [C.yellow, C.butter, C.white] : [C.lime, C.leaf, C.white]
  for (let i = from; i < to; i++) {
    if (len > 24 && i % 3) continue
    const p = center(world.body[i])
    J.burst(fx, p.x, p.y, 2, cols, { speed: 18, life: 0.25, gravity: 0 })
  }
  if (world.phaseT >= DIE + 8) {
    world.phase = 'over'
    world.phaseT = 0
    ev.push('over')
  }
}

export function score(world) {
  return world.score
}

export function overTitle(world) {
  if (world.cause === 'full') return 'Snake out of room'
  if (world.cause === 'tail') return 'Tail bite'
  if (world.cause === 'maze') return 'Bonk'
  return 'Ouch, a wall'
}

// ---------- draw ----------

const FIELD_A = 0x0f1a33
const FIELD_B = 0x13213d
const RING = [0x3d4866, 0x333c57, 0x2b3349, 0x232a3d] // top-left, top-right, bottom-left, bottom-right
const BLOCK = [0x8da0bd, C.steel, 0x4a5b74, C.iron]
const HEAD = C.lime
const MID = C.green
const TAIL = C.pine

function bodyColor(k) {
  return k < 0.5 ? mix(HEAD, MID, k * 2) : mix(MID, TAIL, (k - 0.5) * 2)
}

function cellPx(cv, idx, pal) {
  const X = (idx % COLS) * 2, Y = TOP + Math.floor(idx / COLS) * 2
  cv.set(X, Y, pal[0])
  cv.set(X + 1, Y, pal[1])
  cv.set(X, Y + 1, pal[2])
  cv.set(X + 1, Y + 1, pal[3])
}

/** The direction from cell a to its neighbour b. */
function towards(a, b) {
  const d = b - a
  return d === 1 ? 0 : d === COLS ? 1 : d === -1 ? 2 : 3
}

export function draw(world, cv, fx, t) {
  const W = world.w
  cv.rect(0, 0, W, TOP, C.void)

  // checkerboard, ring and this week's maze
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const i = y * COLS + x
      if (world.grid[i] === '#') cellPx(cv, i, x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 ? RING : BLOCK)
      else cv.rect(x * 2, TOP + y * 2, 2, 2, (x + y) % 2 ? FIELD_A : FIELD_B)
    }

  const occupied = i => world.grid[i] === '#' || world.body.indexOf(i) >= 0
  if (world.fish >= 0) drawFish(cv, world.fish, world.tick, false, occupied)
  if (world.gold) drawFish(cv, world.gold.at, world.tick, world.gold, occupied)
  drawSnake(world, cv)
  drawHud(world, cv, t)

  if (world.phase === 'ready') {
    cv.wash(0x0d1330, 0.35)
    const s = 'SNAKE'
    font5(cv, s, Math.round((W - font5Width(s)) / 2), 5, C.lime, 0x0a2a1a, C.butter)
    cv.textCenter(7, ' this week: ' + MAZES[world.maze].name + ' ', C.butter, 0x0d1330)
    cv.textCenter(13, ' arrows turn · eat the fish ', 0xb9b3d6, 0x0d1330)
  }
}

function drawFish(cv, idx, tick, gold, occupied) {
  const X = (idx % COLS) * 2, Y = TOP + Math.floor(idx / COLS) * 2
  if (gold && gold.left < 60 && Math.floor(gold.left / 4) % 2 === 0) return
  const flick = Math.floor(tick / 6) % 2
  if (gold) {
    // a twinkle that walks round its corners, so it reads as the special one
    const k = Math.floor(tick / 4) % 4
    const [sx, sy] = [[-1, -1], [2, -1], [2, 2], [-1, 2]][k]
    cv.set(X + sx, Y + sy, C.white)
    cv.tint(X + (sx < 0 ? sx + 1 : sx - 1), Y + sy, C.butter, 0.5)
    cv.tint(X + sx, Y + (sy < 0 ? sy + 1 : sy - 1), C.butter, 0.5)
  }
  const pal = gold ? [C.white, C.white, C.butter, C.yellow] : [C.butter, C.yellow, C.gold, C.amber]
  cv.set(X, Y, pal[0])
  cv.set(X + 1, Y, pal[1])
  cv.set(X, Y + 1, pal[2])
  cv.set(X + 1, Y + 1, pal[3])
  // the tail flicks between rows, into the next cell when that one is free
  const right = idx + 1
  if (!occupied(right)) cv.set(X + 2, Y + flick, gold ? C.yellow : C.orange)
}

function drawSnake(world, cv) {
  const body = world.body
  const len = body.length
  const over = world.phase === 'over'
  const dead = world.phase === 'dying' || over
  const gone = dead ? popped(len, over ? DIE : world.phaseT) : 0
  const playing = world.phase === 'play'
  const half = playing && world.acc >= 500
  const bulge = new Set()
  for (const g of world.gulps) {
    const k = world.steps - g
    if (k > 0 && k < len) bulge.add(k)
  }

  for (let i = len - 1; i >= gone; i--) {
    const idx = body[i]
    const X = (idx % COLS) * 2, Y = TOP + Math.floor(idx / COLS) * 2
    let c = bodyColor(len > 1 ? i / (len - 1) : 0)
    if (i % 2) c = shade(c, -0.07)
    if (dead && world.cause !== 'full') c = mix(c, 0x6a7a6a, 0.3)
    if (bulge.has(i)) c = mix(c, C.butter, 0.35) // a swallowed fish on its way down

    if (i === len - 1 && half && world.grow === 0 && len > 1) {
      // the tail slides out of its cell half a step early
      const d = towards(idx, body[i - 1])
      if (d === 0) cv.rect(X + 1, Y, 1, 2, c)
      else if (d === 2) cv.rect(X, Y, 1, 2, c)
      else if (d === 1) cv.rect(X, Y + 1, 2, 1, c)
      else cv.rect(X, Y, 2, 1, c)
    } else cv.rect(X, Y, 2, 2, c)
  }
  if (gone > 0) return

  // head: brighter than the body, half a step ahead when it is about to move
  const head = body[0]
  const d = playing && world.queue.length ? world.queue[0] : world.dir
  const X = (head % COLS) * 2, Y = TOP + Math.floor(head / COLS) * 2
  const next = head + DX[d] + DY[d] * COLS
  const hc = dead ? mix(HEAD, 0x6a7a6a, 0.3) : mix(HEAD, C.butter, 0.3)
  cv.rect(X, Y, 2, 2, hc)
  const snout = half && world.grid[next] !== '#' && (body.indexOf(next) < 0 || (world.grow === 0 && next === body[len - 1]))
  if (snout) {
    if (d === 0) cv.rect(X + 2, Y, 1, 2, hc)
    else if (d === 2) cv.rect(X - 1, Y, 1, 2, hc)
    else if (d === 1) cv.rect(X, Y + 2, 2, 1, hc)
    else cv.rect(X, Y - 1, 2, 1, hc)
  }
  // one eye, seen from the side, at the front of the head
  const eye = dead ? 0x3a1030 : C.deep
  if (d === 0) cv.set(X + 1, Y, eye)
  else if (d === 2) cv.set(X, Y, eye)
  else if (d === 1) cv.set(X + 1, Y + 1, eye)
  else cv.set(X + 1, Y, eye)

  // now and then a tongue flicks out
  if (playing && world.tick % 45 < 5) {
    const reach = snout ? 2 : 1
    const tx = d === 0 ? X + 1 + reach : d === 2 ? X - reach : X + 1
    const ty = d === 1 ? Y + 1 + reach : d === 3 ? Y - reach : Y + 1
    const tc = Math.floor((ty - TOP) / 2) * COLS + Math.floor(tx / 2)
    if (world.grid[tc] !== '#') cv.set(tx, ty, C.pink)
  }
}

function drawHud(world, cv, t) {
  cv.text(1, 0, ' ' + world.score.toLocaleString('en-US') + ' ', C.white, undefined, true)
  const sp = 'speed ' + world.tier + ' '
  const len = 'length ' + world.body.length + '   '
  let x = cv.cols - sp.length - 1
  const lit = world.tick - world.tierAt < 45
  cv.text(x, 0, sp, lit ? C.lime : 0xb9b3d6, undefined, lit)
  x -= len.length
  cv.text(x, 0, len, 0xb9b3d6)
  if (world.gold) {
    const g = '★ ' + Math.ceil(world.gold.left / 30) + 's   '
    x -= g.length
    cv.text(x, 0, g, C.yellow, undefined, true)
  }
}
