// Code Runner (代码跑酷): Pip runs across the code Claude is writing. Each
// line becomes a platform with the real text on it; indentation sets its
// height and blank lines open gaps. The level grows as Claude writes, and the
// words under Pip's feet light up, the same light the reading guide uses.
//
// Jump is one fixed height (no key release to read), with coyote time, a jump
// buffer and a hang at the top of the arc, so late key presses still land.

import { C, PIP } from '../lib/palette.js'
import { WALK, JUMP, SLIDE, FRONT, CHEER } from '../lib/pip.js'
import { font5, font5Width, mix } from '../lib/gfx.js'
import * as J from '../lib/juice.js'

export const meta = {
  id: 'runner',
  title: 'Code Runner',
  zh: '代码跑酷',
  blurb: "Run along the code Claude is writing. Jump the gaps, stomp the bugs.",
  keys: [['space', 'jump'], ['↓', 'belly slide']],
}

const WARMUP = [
  "// Pip's warm-up lap",
  'function waddle(pip) {',
  '  const fish = catchFish()',
  '  if (fish.length > 3) {',
  '    return pip.celebrate()',
  '  }',
  '',
  "  await slide(pip, 'downhill')",
  '}',
]

const G = 210 // px/s²
const JUMP_V = -66
const JUMP2_V = -54
const COYOTE = 0.1
const BUFFER = 0.16

const KW = new Set(['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'import', 'export', 'from', 'class', 'new', 'await', 'async', 'def', 'try', 'catch', 'throw', 'switch', 'case', 'break', 'continue', 'type', 'interface', 'extends', 'public', 'private', 'static', 'self', 'this', 'true', 'false', 'null', 'None', 'True', 'False', 'fn', 'pub', 'use', 'mut', 'impl', 'struct', 'test', 'expect', 'describe', 'it'])
const FISHY = new Set(['return', 'await', 'async', 'test', 'expect', 'yield', 'def', 'fn'])

// ---------- world ----------

export function create(w, h, seed, carry = {}) {
  const world = {
    kind: 'runner',
    w, h,
    seed: seed | 0,
    t: 0,
    phase: 'ready',
    phaseT: 0,
    plats: [], // { x0, x1, row, text, toks, file, n }
    bugs: [],
    fish: [],
    signs: [],
    endX: 0,
    lastN: -1,
    warm: true,
    pip: { x: 6, y: 0, vy: 0, ground: true, coyote: 0, buf: 0, jumps: 0, slide: 0, inv: 0, lives: 3, land: 0, stretch: 0, hurt: 0, dead: 0 },
    cam: 0,
    typeQ: 0,
    speed: 24,
    dist: 0,
    fishN: 0,
    stomps: 0,
    lines: 0,
    waiting: false,
    done: false,
  }
  for (const t of WARMUP) addLine(world, t, 'warm-up', null)
  world.pip.y = platTop(world, world.plats[0])
  if (carry.code) feed(world, carry.code)
  return world
}

function baseRow(world) {
  return Math.max(6, Math.floor(world.h / 2) - 3)
}
function rowOf(world, indent) {
  return baseRow(world) - Math.min(4, indent) * 2
}
function platTop(world, p) {
  return p.row * 2 - 1
}

function tokenize(text) {
  const toks = []
  const re = /(\/\/.*$|#.*$)|("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|`[^`]*`?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|(\s+)|(.)/g
  let m
  while ((m = re.exec(text))) {
    if (m[1]) toks.push({ s: m[1], k: 'com' })
    else if (m[2]) toks.push({ s: m[2], k: 'str' })
    else if (m[3]) toks.push({ s: m[3], k: 'num' })
    else if (m[4]) toks.push({ s: m[4], k: KW.has(m[4]) ? 'kw' : 'id' })
    else if (m[5]) toks.push({ s: m[5], k: 'ws' })
    else toks.push({ s: m[6], k: 'p' })
  }
  return toks
}

/** Appends one line of code as a platform (or a gap for a blank line). */
function addLine(world, raw, file, n) {
  const text = String(raw).replace(/\t/g, '  ').replace(/[^\x20-\x7e]/g, '?').trimEnd()
  const lead = text.length - text.trimStart().length
  const body = text.trim().slice(0, 46)
  const last = world.plats[world.plats.length - 1]
  if (!body) {
    world.endX += 12 // a blank line is a pit to jump
    return
  }
  const indent = Math.floor(lead / 2)
  const gap = !last ? 0 : /[{(\[:]$/.test(last.text) ? 3 : 5
  const x0 = Math.max(world.endX + gap, last ? last.x1 + gap : 0)
  const w = Math.max(6, body.length + 2)
  const p = { x0, x1: x0 + w, row: rowOf(world, indent), indent, text: body, toks: tokenize(body), file, n, born: world.warm || n === null ? -9 : world.t + world.typeQ }
  if (n !== null && !world.warm) world.typeQ += body.length / 90
  if (last && last.file !== file && file) world.signs.push({ x: x0, file })
  world.plats.push(p)
  world.endX = p.x1
  world.lines++
  // fish over the keywords worth catching
  let c = x0 + 1
  for (const t of p.toks) {
    if (t.k === 'kw' && FISHY.has(t.s)) world.fish.push({ x: c + Math.floor(t.s.length / 2), y: platTop(world, p) - 8, got: false, gold: t.s === 'return' })
    c += t.s.length
  }
  // a bug on every fourth long line
  if (world.plats.length % 4 === 0 && w > 14) world.bugs.push({ x: x0 + Math.floor(w / 2), p: world.plats.length - 1, dir: -1, dead: 0, squash: 0 })
}

/** New code from the hooks module: { lines: [{ n, t, f }] }. */
export function feed(world, code) {
  if (!code || !Array.isArray(code.lines)) return
  const fresh = code.lines.filter(l => typeof l.n === 'number' && l.n > world.lastN)
  if (!fresh.length) return
  for (const l of fresh) {
    addLine(world, l.t, l.f || '', l.n)
    world.lastN = l.n
  }
  world.warm = false
}

export function resize(world, w, h) {
  const dy = baseRow({ h }) - baseRow(world)
  world.w = w
  world.h = h
  if (dy) {
    for (const p of world.plats) p.row = Math.max(1, p.row + dy)
    for (const f of world.fish) f.y += dy * 2
    world.pip.y += dy * 2
  }
}

// ---------- update ----------

function typed(world, p) {
  if (p.born <= world.t - 5) return p.text.length
  return Math.max(0, Math.min(p.text.length, Math.floor((world.t - p.born) * 90)))
}

function platAt(world, x, fromY, toY) {
  for (const p of world.plats) {
    if (p.born > world.t) continue
    if (x + 2 < p.x0 || x - 2 > p.x1) continue
    const top = platTop(world, p)
    if (fromY <= top + 0.5 && toY >= top) return p
  }
  return null
}

export function update(world, dt, input, fx, ctx = {}) {
  const ev = []
  world.t += dt
  world.typeQ = Math.max(0, world.typeQ - dt)
  world.phaseT += dt
  const p = world.pip
  const jumpPress = input.includes('action') || input.includes('up')
  if (world.phase === 'ready') {
    if (world.phaseT > 1.0 || jumpPress) { world.phase = 'play'; world.phaseT = 0 }
    return ev
  }
  if (world.phase !== 'play') return ev

  if (jumpPress) p.buf = BUFFER
  if (input.includes('down') && p.ground && p.slide <= 0) { p.slide = 0.6; ev.push('slide'); J.burst(fx, p.x - 3, p.y, 3, [C.ice, C.white], { speed: 20, life: 0.25, gravity: 20, dir: Math.PI }) }
  p.buf = Math.max(0, p.buf - dt)
  p.slide = Math.max(0, p.slide - dt)
  p.inv = Math.max(0, p.inv - dt)
  p.land = Math.max(0, p.land - dt)
  p.stretch = Math.max(0, p.stretch - dt)
  p.hurt = Math.max(0, p.hurt - dt)

  if (p.dead > 0) {
    p.dead -= dt
    if (p.dead <= 0) respawn(world)
    return ev
  }

  // run, unless we caught up with what Claude has written
  let edge = world.endX - 1
  for (const pl of world.plats) if (pl.born > world.t) { edge = Math.min(edge, pl.x0 - 4); break }
  world.speed = Math.min(40, 24 + world.dist / 120)
  const v = world.speed * (p.slide > 0 ? 1.6 : 1)
  const atEnd = p.x >= edge - 3 && p.ground
  world.waiting = false
  if (atEnd) {
    if (ctx.claudeDone || world.warm === false && ctx.claudeDone) {
      world.phase = 'clear'
      world.phaseT = 0
      ev.push('clear')
      return ev
    }
    world.waiting = true
  } else {
    p.x += v * dt
    world.dist += v * dt
  }

  // jump with coyote time and a buffer
  if (p.ground) { p.coyote = COYOTE; p.jumps = 0 } else p.coyote = Math.max(0, p.coyote - dt)
  if (p.buf > 0 && (p.coyote > 0 || p.jumps < 2) && !world.waiting) {
    const first = p.coyote > 0
    p.vy = first ? JUMP_V : JUMP2_V
    p.jumps = first ? 1 : 2
    p.ground = false
    p.coyote = 0
    p.buf = 0
    p.slide = 0
    p.stretch = 0.066
    ev.push('jump')
    if (!first) J.burst(fx, p.x, p.y, 4, [C.ice, C.white], { speed: 20, life: 0.25, gravity: 0, dir: Math.PI / 2 })
  } else if (p.buf > 0 && world.waiting) {
    // a hop in place while waiting for more code
    p.vy = JUMP2_V * 0.6
    p.ground = false
    p.buf = 0
  }

  // gravity with a hang at the apex
  const g = Math.abs(p.vy) < 14 ? G * 0.5 : G
  const prevY = p.y
  if (!p.ground) {
    p.vy = Math.min(120, p.vy + g * dt)
    p.y += p.vy * dt
    if (p.vy >= 0) {
      const land = platAt(world, p.x, prevY, p.y)
      if (land) {
        const fall = p.vy
        p.y = platTop(world, land)
        p.vy = 0
        p.ground = true
        p.land = fall > 70 ? 0.1 : 0.066
        J.burst(fx, p.x, p.y, fall > 70 ? 4 : 2, [0x9aa6c8, C.slate], { speed: 14, life: 0.25, gravity: 30, spread: Math.PI, dir: -Math.PI / 2 })
        ev.push('land')
      }
    }
  } else {
    // walked off an edge?
    const under = platAt(world, p.x, p.y - 0.5, p.y + 0.5)
    if (!under) p.ground = false
  }
  if (p.y > world.h + 8) {
    loseLife(world, fx, ev, 'fall')
    return ev
  }

  // fish
  for (const f of world.fish) {
    if (f.got) continue
    if (Math.abs(f.x - p.x) < 4 && Math.abs(f.y - (p.y - 5)) < 5) {
      f.got = true
      world.fishN++
      J.pop(fx, f.x - world.cam, f.y - 2, f.gold ? '+50' : '+10', f.gold ? C.yellow : C.butter)
      J.burst(fx, f.x - world.cam, f.y, 5, [C.butter, C.yellow, C.white], { speed: 24, life: 0.3, gravity: 0 })
      ev.push('fish')
    }
  }

  // bugs patrol their line
  for (const b of world.bugs) {
    const pl = world.plats[b.p]
    if (!pl) continue
    if (b.dead > 0) { b.dead -= dt; continue }
    b.x += b.dir * 6 * dt
    if (b.x < pl.x0 + 2 || b.x > pl.x1 - 3) b.dir *= -1
    const by = platTop(world, pl)
    if (b.squash === 0 && Math.abs(b.x - p.x) < 4 && p.y > by - 6 && p.y < by + 2) {
      if (p.vy > 10 && prevY < by - 2) {
        b.squash = 1
        b.dead = 0.4
        p.vy = JUMP_V * 0.8
        p.ground = false
        p.jumps = 1
        world.stomps++
        J.hitstop(fx, 1)
        J.kick(fx, 0, 1)
        J.burst(fx, b.x - world.cam, by - 2, 8, [C.red, C.pink, C.white], { speed: 30, life: 0.3 })
        J.pop(fx, b.x - world.cam, by - 6, '+25', C.pink)
        ev.push('stomp')
      } else if (p.inv <= 0 && p.slide <= 0) {
        loseLife(world, fx, ev, 'bug')
        return ev
      } else if (p.slide > 0 && p.inv <= 0) {
        // sliding bowls a bug over
        b.squash = 1
        b.dead = 0.4
        world.stomps++
        J.burst(fx, b.x - world.cam, by - 2, 6, [C.red, C.pink], { speed: 30, life: 0.3 })
        ev.push('stomp')
      }
    }
  }
  world.bugs = world.bugs.filter(b => !(b.squash && b.dead <= 0))

  // camera: Pip at a third of the width, eased
  const want = p.x - world.w * 0.32
  world.cam += (want - world.cam) * Math.min(1, dt * 6)
  if (world.cam < 0) world.cam = 0
  return ev
}

function loseLife(world, fx, ev, why) {
  const p = world.pip
  p.lives--
  p.dead = 0.7
  p.hurt = 0.1
  J.flash(fx, 1)
  J.hitstop(fx, 3)
  J.shake(fx, 0.5)
  J.burst(fx, p.x - world.cam, Math.min(world.h - 2, p.y - 4), 18, [C.white, C.blue, C.cyan, C.amber], { speed: 50, life: 0.45 })
  ev.push(why === 'fall' ? 'fall' : 'hurt')
  if (p.lives <= 0) {
    world.phase = 'over'
    world.phaseT = 0
    ev.push('over')
  }
}

function respawn(world) {
  const p = world.pip
  // back onto the next platform ahead
  const next = world.plats.find(pl => pl.x1 > p.x - 2) || world.plats[world.plats.length - 1]
  p.x = Math.max(next.x0 + 2, Math.min(p.x, next.x1 - 3))
  p.y = platTop(world, next)
  p.vy = 0
  p.ground = true
  p.inv = 1.4
  p.slide = 0
}

export function score(world) {
  return Math.floor(world.dist / 4) + world.fishN * 10 + world.stomps * 25
}

export function overTitle(world, clear) {
  return clear ? 'Level done!' : 'Out of lives'
}

// ---------- draw ----------

const TOK = { kw: C.pink, str: 0xb8e986, num: C.amber, com: 0x7a86b8, id: 0xe8ecff, p: 0x9aa6c8, ws: 0 }

export function draw(world, cv, fx, t) {
  const W = world.w, H = world.h
  const cam = Math.round(world.cam)
  // night over the ice, with far ridges that scroll slower
  cv.vgrad(0, 0, W, H, 0x0b1030, 0x24305e)
  for (let x = 0; x < W; x++) {
    const wx = x + cam * 0.25
    const hh = Math.round(6 + 4 * Math.sin(wx * 0.045) + 2 * Math.sin(wx * 0.13))
    cv.rect(x, H - hh - 4, 1, hh + 4, 0x2c3a6e)
    const wx2 = x + cam * 0.5
    const h2 = Math.round(3 + 2 * Math.sin(wx2 * 0.09 + 2) + Math.sin(wx2 * 0.21))
    cv.rect(x, H - h2, 1, h2, 0x35457e)
  }
  for (let i = 0; i < 18; i++) {
    const x = Math.floor((((i * 97) % 211) * 7 - cam * 0.1) % W + W) % W
    const y = (i * 37) % Math.floor(H * 0.5)
    cv.set(x, y, Math.sin(t * 1.5 + i) > 0.7 ? 0xffffff : 0x4b569a)
  }

  // signposts at file boundaries
  for (const s of world.signs) {
    const x = s.x - cam
    if (x < -20 || x > W) continue
    const p = world.plats.find(pl => pl.x0 === s.x)
    if (!p) continue
    const top = platTop(world, p)
    cv.rect(x, top - 7, 1, 7, 0x8a5a3c)
    cv.text(x + 1, Math.floor((top - 8) / 2), ' ' + s.file + ' ', C.night, C.butter)
  }

  // platforms: the code itself
  const px = world.pip.x
  for (const p of world.plats) {
    const x0 = p.x0 - cam
    if (x0 > W || p.x1 - cam < 0) continue
    if (p.born > world.t) continue
    const shown = typed(world, p)
    const typing = shown < p.text.length
    const top = platTop(world, p)
    // the slab's lit edge, brighter under Pip
    const xEnd = typing ? p.x0 + 1 + shown : p.x1
    for (let x = p.x0; x < xEnd; x++) {
      const sx = x - cam
      if (sx < 0 || sx >= W) continue
      const near = Math.abs(x - px) <= 3 && Math.abs(world.pip.y - top) < 1
      cv.set(sx, top, near ? C.butter : 0x5d6fb0)
    }
    // the text row, drawn as real characters
    const row = p.row
    let c = x0 + 1
    cv.text(x0, row, ' ', undefined, 0x1a2350)
    let k = 0
    for (const tk of p.toks) {
      for (const ch of tk.s) {
        if (k++ >= shown) break
        const lit = Math.abs(c + cam - px) <= 3 && Math.abs(world.pip.y - top) < 1
        if (c >= 0 && c < W) cv.text(c, row, ch, lit ? C.night : TOK[tk.k] || 0xe8ecff, lit ? C.butter : 0x1a2350, lit)
        c++
      }
    }
    if (typing) {
      if (c >= 0 && c < W && Math.floor(t * 4) % 2 === 0) cv.text(c, row, '▌', C.butter, 0x1a2350)
      continue
    }
    for (; c < p.x1 - cam; c++) if (c >= 0 && c < W) cv.text(c, row, ' ', undefined, 0x1a2350)
    // line number tab at the left edge
    if (p.n !== null && x0 - 3 >= 0 && p.text) cv.text(x0 - 3, row, String((p.n % 1000) + 1).padStart(3, ' ').slice(-3), 0x4b569a, undefined)
  }

  // fish
  for (const f of world.fish) {
    if (f.got || (f.born || 0) > world.t) continue
    const x = f.x - cam
    if (x < -4 || x > W + 4) continue
    const bob = Math.round(Math.sin(t * 4 + f.x) * 0.8)
    cv.sprite(['.YY..Y', 'YYKYYY', '.YY..Y'], { Y: f.gold ? C.yellow : C.cyan, K: C.night }, x - 3, f.y + bob)
  }

  // bugs
  for (const b of world.bugs) {
    const pl = world.plats[b.p]
    if (!pl) continue
    const x = Math.round(b.x - cam)
    const top = platTop(world, pl)
    if (b.squash) {
      cv.sprite(['RRRRR', 'R.R.R'], { R: C.red }, x - 2, top - 2)
      continue
    }
    const fr = Math.floor(t * 6) % 2 ? ['.R.R.', 'RRRRR', 'RWRWR', 'R.R.R'] : ['.R.R.', 'RRRRR', 'RWRWR', '.R.R.']
    cv.sprite(fr, { R: C.red, W: C.white }, x - 2, top - 4, b.dir > 0)
  }

  // Pip
  const p = world.pip
  if (p.dead <= 0 && !(p.inv > 0 && Math.floor(t * 12) % 2 === 0)) {
    const x = Math.round(p.x - cam)
    let spr, dx = -4, dy
    if (world.waiting) {
      spr = Math.floor(t * 1.5) % 4 === 0 ? FRONT.map((r, i) => (i === 3 ? '.BWWWWWWB.' : r)) : FRONT
      dx = -5
    } else if (p.slide > 0) { spr = SLIDE; dx = -5 }
    else if (!p.ground) spr = JUMP
    else spr = WALK[Math.floor(t * 10) % 4]
    dy = -spr.length + 1
    // squash on landing, stretch on take-off: one pixel, held two ticks
    if (p.land > 0) spr = [spr[0], ...spr.slice(2)]
    if (p.stretch > 0) spr = [spr[0], spr[1], ...spr.slice(1)]
    dy = -spr.length + 1
    if (p.hurt > 0) cv.silhouette(spr, x + dx, p.y + dy, 0xffffff)
    else cv.sprite(spr, PIP, x + dx, p.y + dy)
  }

  // HUD
  const hearts = '♥'.repeat(Math.max(0, p.lives)) + '♡'.repeat(Math.max(0, 3 - p.lives))
  cv.text(1, 0, ' ' + score(world).toLocaleString('en-US') + ' ', C.white, undefined, true)
  const info = 'lines ' + world.lines + '   fish ' + world.fishN + '   '
  cv.text(cv.cols - info.length - hearts.length - 1, 0, info, 0xb9b3d6)
  cv.text(cv.cols - hearts.length - 1, 0, hearts, C.red)
  if (world.waiting) {
    const msg = world.warm ? ' Claude has not written code yet, so this is a warm-up lap ' : ' waiting for Claude to write more… '
    cv.textCenter(1, msg, 0x8f8fb3, 0x0b1030)
  }
  if (world.phase === 'ready') {
    const s = world.warm ? 'WARM UP' : 'RUN!'
    font5(cv, s, Math.round((W - font5Width(s)) / 2), 5, C.white, 0x29366f)
  }
}
