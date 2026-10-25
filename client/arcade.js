// Pip's Arcade: the surface module that runs in the pane. It draws a menu and
// three small games, shows what Claude is doing on the top row, and keeps the
// round's state with the hooks module so an approval pause never loses it.
//
// The hooks module takes this Client out of the pane while Claude asks for
// approval, so the keyboard goes back to the question. It hands the saved
// round back in `props.resume` when Claude moves on.

import { Canvas, encode, tree, blit, font3, font3Width, font5, font5Width, mix, hex } from './lib/gfx.js'
import { C, PIP } from './lib/palette.js'
import * as P from './lib/pip.js'
import * as J from './lib/juice.js'
import * as claw from './games/claw.js'
import * as rocket from './games/rocket.js'
import * as runner from './games/runner.js'

const GAMES = { claw, rocket, runner }
const ORDER = ['runner', 'rocket', 'claw', 'read']
const DT = 1 / 30

const KEYS = {
  left: 'left', a: 'left', h: 'left',
  right: 'right', d: 'right', l: 'right',
  up: 'up', w: 'up', k: 'up',
  down: 'down', s: 'down', j: 'down',
  space: 'action', ' ': 'action', return: 'action',
  x: 'alt', z: 'alt',
}

const SFX = {
  drop: 'tick', miss: 'tick', grab: 'grab', thud: 'thud', cash: 'coin', 'cash-big': 'jackpot', 'cash-low': 'thud',
  boom: 'boom', dynamite: 'boom', bonus: 'bonus', clear: 'clear', over: 'over', buy: 'coin', nope: 'tick',
  shoot: null, hit: 'hit', kill: 'pop', hurt: 'hurt', power: 'bonus', bomb: 'boom', boss: 'warn',
  jump: 'jump', land: null, fish: 'coin', stomp: 'pop', fall: 'hurt', slide: 'tick', start: 'start',
}

// ---------- entry ----------

export default function Arcade(props, surface) {
  if (surface.state === undefined) boot(props, surface)
  const S = surface.state
  // fallback input from the pane's hotkey buttons (classic renderer, no clicks)
  if (props.input && props.input.seq !== S.inputSeq) {
    if (S.inputSeq !== undefined && props.input.key) S.queue.push(props.input.key)
    S.inputSeq = props.input.seq
  }
  if (props.boot && props.boot.seq !== S.bootSeq) {
    if (S.bootSeq !== undefined) openFromProps(S, props)
    S.bootSeq = props.boot.seq
  }
  S.props = props
  return view(S, props, surface)
}

function boot(props, surface) {
  const S = {
    scene: 'menu',
    gameId: null,
    world: null,
    fx: J.makeFx(),
    t: 0,
    menuSel: 0,
    queue: [],
    saveT: 0,
    banner: null,
    claudeSeen: props.claude ? props.claude.state : 'idle',
    over: null,
    inputSeq: props.input ? props.input.seq : undefined,
    bootSeq: props.boot ? props.boot.seq : undefined,
    out: null,
    focused: false,
    props,
  }
  S.fx.reduced = !!(props.cfg && props.cfg.reduceMotion)
  surface.setState(S)
  openFromProps(S, props)
  surface.every(33, () => {
    tick(S, surface)
    surface.setState(S)
  })
  surface.onKey(k => {
    S.focused = true
    S.queue.push(k.key)
    surface.setState(S)
  })
  surface.onPointer(p => {
    if (p.type !== 'down') return
    S.focused = true
    S.queue.push('click')
    surface.setState(S)
  })
}

function openFromProps(S, props) {
  const r = props.resume
  if (r && r.game && GAMES[r.game] && r.world) {
    S.gameId = r.game
    // props arrive frozen; the game mutates its world, so take a copy
    S.world = JSON.parse(JSON.stringify(r.world))
    S.scene = 'resume'
    S.sceneT = 0
    return
  }
  const want = props.boot && props.boot.game
  if (want && GAMES[want]) start(S, want)
}

// ---------- flow ----------

function start(S, id) {
  S.gameId = id
  S.scene = 'play'
  S.sceneT = 0
  S.fx = J.makeFx()
  S.fx.reduced = !!(S.props && S.props.cfg && S.props.cfg.reduceMotion)
  S.world = null // created on the next frame at the field's size
  S.over = null
  send(S, { sfx: ['start'] })
}

function toMenu(S) {
  if (S.world && S.gameId) send(S, { save: { game: S.gameId, world: null } })
  S.scene = 'menu'
  S.gameId = null
  S.world = null
  S.over = null
  S.sceneT = 0
}

function send(S, msg) {
  S.out = S.out || {}
  for (const [k, v] of Object.entries(msg)) {
    if (k === 'sfx') S.out.sfx = [...(S.out.sfx || []), ...v]
    else S.out[k] = v
  }
}

function field(S, surface) {
  const cols = Math.max(20, surface.columns || 76)
  const rows = Math.max(8, surface.rows || 24)
  return { cols, rows, w: cols, h: (rows - 2) * 2 }
}

function tick(S, surface) {
  S.t += DT
  S.sceneT = (S.sceneT || 0) + DT
  const props = S.props || {}
  const { w, h } = field(S, surface)

  // Claude finished while we play: say so once
  const cs = props.claude ? props.claude.state : 'idle'
  if (cs !== S.claudeSeen) {
    if (cs === 'done' && S.claudeSeen !== 'done') S.banner = { text: "✓ Claude's done · r reads it with Pip", t: 0, c: C.lime }
    if (cs === 'working' && S.claudeSeen === 'done') S.banner = null
    S.claudeSeen = cs
  }
  if (S.banner) {
    S.banner.t += DT
    if (S.banner.t > 4.2) S.banner = null
  }

  // input for this tick
  const raw = S.queue.splice(0)
  const acts = []
  for (const k of raw) {
    const key = String(k).toLowerCase()
    if (key === 'click') continue
    if (key === 'm') { send(S, { cfg: { sound: !(props.cfg && props.cfg.sound !== false) } }); continue }
    if (S.scene === 'menu') { menuKey(S, key); continue }
    if (key === 'q') { toMenu(S); continue }
    if (key === 'r' && cs === 'done') { send(S, { read: true }); continue }
    if (key === 'p' && (S.scene === 'play' || S.scene === 'pause')) {
      S.scene = S.scene === 'play' ? 'pause' : 'play'
      continue
    }
    if (S.scene === 'pause' || S.scene === 'resume') {
      if (KEYS[key] === 'action' || key === 'p') { S.scene = 'play'; S.sceneT = 0; S.fx.stop = 0.25 }
      continue
    }
    if (S.scene === 'over') {
      if (S.sceneT > 0.35 && KEYS[key] === 'action') {
        if (S.over && S.over.next) {
          S.world = GAMES[S.gameId].nextLevel(S.world)
          S.scene = 'play'
          S.sceneT = 0
          S.over = null
        } else start(S, S.gameId)
      }
      continue
    }
    if (KEYS[key]) acts.push(KEYS[key])
  }
  // a click on a paused game resumes it too
  if (raw.includes('click') && (S.scene === 'resume' || S.scene === 'pause')) { S.scene = 'play'; S.sceneT = 0; S.fx.stop = 0.25 }

  if (S.scene === 'menu') return flush(S, surface)
  const G = GAMES[S.gameId]
  if (!G) return flush(S, surface)
  if (!S.world) S.world = G.create(w, h, Math.floor(Math.random() * 1e9), {
    code: props.code, best: props.best ? props.best[S.gameId] : 0, level: props.carry && props.carry[S.gameId] && props.carry[S.gameId].level,
  })
  const world = S.world
  if (world.w !== w || world.h !== h) {
    if (G.resize) G.resize(world, w, h)
    else { world.w = w; world.h = h }
  }
  if (G.feed) G.feed(world, props.code)

  if (S.scene === 'play') {
    if (S.fx.stop > 0) {
      S.fx.stop -= DT
      // presses during a freeze still count, one tick late
      if (acts.length) S.queue.push(...raw.filter(k => KEYS[String(k).toLowerCase()]))
    } else {
      const events = G.update(world, DT, acts, S.fx, { claudeDone: cs !== 'working' }) || []
      const sounds = events.map(e => SFX[e]).filter(Boolean)
      if (sounds.length) send(S, { sfx: sounds })
      if (events.includes('next') && G.nextLevel) { S.world = G.nextLevel(world); S.over = null }
      else if (events.includes('clear') || events.includes('over') || events.includes('end')) finish(S, events)
    }
    J.stepFx(S.fx, DT)
    S.saveT += DT
    if (S.saveT > 0.5) {
      S.saveT = 0
      send(S, { save: { game: S.gameId, world } })
    }
  } else if (S.scene === 'over') {
    if (G.update && G.idle) G.idle(world, DT)
    J.stepFx(S.fx, DT)
  }
  flush(S, surface)
}

function finish(S, events) {
  const G = GAMES[S.gameId]
  const score = G.score(S.world)
  const best = Math.max(score, (S.props.best && S.props.best[S.gameId]) || 0)
  const clear = events.includes('clear')
  S.over = {
    score,
    best,
    isBest: score > ((S.props.best && S.props.best[S.gameId]) || 0) && score > 0,
    next: clear && S.gameId === 'claw',
    clear,
    title: G.overTitle ? G.overTitle(S.world, clear) : clear ? 'Cleared!' : "Time's up",
  }
  if (clear && S.gameId === 'claw') claw.openShop(S.world)
  S.scene = clear && S.gameId === 'claw' ? 'play' : 'over'
  S.sceneT = 0
  send(S, { score: { game: S.gameId, score }, save: { game: S.gameId, world: null } })
}

function menuKey(S, key) {
  const n = ORDER.length
  if (KEYS[key] === 'left' || KEYS[key] === 'up') S.menuSel = (S.menuSel + n - 1) % n
  else if (KEYS[key] === 'right' || KEYS[key] === 'down') S.menuSel = (S.menuSel + 1) % n
  else if (key >= '1' && key <= String(n)) choose(S, ORDER[Number(key) - 1])
  else if (KEYS[key] === 'action') choose(S, ORDER[S.menuSel])
  else if (key === 'r') choose(S, 'read')
}

function choose(S, id) {
  S.menuSel = ORDER.indexOf(id)
  if (id === 'read') send(S, { read: true })
  else start(S, id)
}

function flush(S, surface) {
  if (S.out) {
    surface.post(S.out)
    S.out = null
  }
}

// ---------- view ----------

function view(S, props, surface) {
  const el = surface.elements
  const { cols, rows, w, h } = field(S, surface)
  if (cols < 40 || rows < 12) {
    const { Box, Text } = el
    return Box({ flexDirection: 'column', children: [Text({ children: ["Pip's Arcade needs a bit more room."] }), Text({ dimColor: true, children: ['Widen the pane with ctrl+x then ←.'] })] })
  }
  const cv = new Canvas(cols, rows * 2, C.night)
  const fcv = new Canvas(w, h, C.night)

  if (S.scene === 'menu' || !S.gameId) drawMenu(S, fcv, props)
  else drawGame(S, fcv, props)

  blit(cv, fcv, 0, 1)
  drawStatus(S, cv, props)
  drawHints(S, cv, props)
  return tree(el, encode(cv))
}

function drawGame(S, fcv, props) {
  const G = GAMES[S.gameId]
  const world = S.world
  if (!world) return
  const off = J.offset(S.fx)
  fcv.ox = off.x
  fcv.oy = off.y
  G.draw(world, fcv, S.fx, S.t)
  J.drawFx(S.fx, fcv)

  if (S.banner) {
    const k = S.banner.t
    const yIn = J.ease.outBack(Math.min(1, k / 0.35))
    const yOut = k > 3.8 ? J.ease.inCubic(Math.min(1, (k - 3.8) / 0.4)) : 0
    const row = Math.round(-2 + 3 * yIn - 3 * yOut)
    if (row >= 0) fcv.textCenter(row, ' ' + S.banner.text + ' ', C.night, S.banner.c, true)
  }
  if (S.scene === 'pause') card(fcv, 'Paused', 'space to play on', C.white)
  if (S.scene === 'resume') card(fcv, 'Welcome back', 'click or space to pick up where you left off', C.butter)
  if (S.scene === 'over' && S.over) overCard(S, fcv)
}

/** A centred title in the 5x7 font, or the 3x5 one when the pane is too narrow. */
function bigTitle(cv, title, y, color) {
  const t = title.toUpperCase()
  const w5 = font5Width(t)
  if (w5 + 4 <= cv.w) return font5(cv, t, Math.round((cv.w - w5) / 2), y, color, 0x07091a)
  const w3 = font3Width(t, 1)
  font3(cv, t, Math.round((cv.w - w3) / 2), y + 1, color, 1, 0x07091a)
}

function card(cv, title, sub, color) {
  cv.wash(0x0d1330, 0.6)
  const y = Math.max(2, Math.floor(cv.h / 2) - 7)
  bigTitle(cv, title, y, color)
  cv.textCenter(Math.floor((y + 12) / 2), ' ' + clip(sub, cv.cols - 4) + ' ', 0xb9b3d6)
}

function overCard(S, cv) {
  const o = S.over
  cv.wash(0x0d1330, Math.min(0.62, S.sceneT * 2))
  const y = Math.max(2, Math.floor(cv.h / 2) - 10)
  bigTitle(cv, o.title, y, o.clear ? C.lime : C.butter)
  const r = Math.floor((y + 11) / 2)
  const sc = 'score ' + o.score.toLocaleString('en-US') + '   best ' + o.best.toLocaleString('en-US')
  cv.textCenter(r, ' ' + sc + ' ', C.white, undefined, true)
  if (o.isBest) {
    const blink = Math.floor(S.t * 3) % 2 === 0
    cv.textCenter(r + 1, ' ★ new best ', blink ? C.night : C.gold, blink ? C.gold : undefined, true)
  }
  const cs = S.props.claude ? S.props.claude.state : 'idle'
  const opts = 'space again · q menu' + (cs === 'done' ? ' · r read the answer' : '')
  cv.textCenter(r + 3, opts, 0x8f8fb3)
  // Pip celebrates or shrugs
  const spr = o.clear || o.isBest ? (Math.floor(S.t * 4) % 2 ? P.CHEER : P.FRONT) : P.FRONT
  cv.sprite(spr, PIP, Math.round(cv.w / 2 - 5), Math.min(cv.h - 12, (r + 5) * 2))
}

// ---------- status and hints rows ----------

function fmtTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}

function drawStatus(S, cv, props) {
  const cl = props.claude || { state: 'idle' }
  cv.rect(0, 0, cv.w, 2, 0x07091a)
  let col = 1
  if (cl.state === 'working') {
    const on = Math.floor(S.t * 2.5) % 2 === 0
    col = cv.text(col, 0, on ? '●' : '○', C.cyan, undefined, true)
    const what = cl.label ? 'Claude is ' + cl.label : 'Claude is working'
    const since = cl.since ? '  ' + fmtTime(Date.now() - cl.since) : ''
    col = cv.text(col + 1, 0, clip(what, cv.cols - 30), C.ice)
    cv.text(col, 0, since, 0x8f8fb3)
  } else if (cl.state === 'done') {
    col = cv.text(col, 0, "✓ Claude's done", C.lime, undefined, true)
    cv.text(col, 0, '  r read the answer with Pip', 0x9fd6a0)
  } else if (cl.state === 'needs') {
    cv.text(col, 0, '! Claude needs you below', C.gold, undefined, true)
  } else {
    cv.text(col, 0, 'Claude is idle', 0x8f8fb3)
  }
  const title = S.gameId ? GAMES[S.gameId].meta.title : "Pip's Arcade"
  const best = S.gameId && props.best && props.best[S.gameId] ? '  ★ ' + props.best[S.gameId].toLocaleString('en-US') : ''
  const right = title + best + ' '
  if (cv.cols - right.length > col + 6) {
    const x = cv.cols - right.length
    const end = cv.text(x, 0, title, C.butter, undefined, true)
    cv.text(end, 0, best, 0x8f8fb3)
  }
}

function clip(s, n) {
  return s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s
}

function drawHints(S, cv, props) {
  const row = cv.rows - 1
  cv.rect(0, row * 2, cv.w, 2, 0x07091a)
  const sound = !(props.cfg && props.cfg.sound === false)
  let keys
  if (S.scene === 'menu') keys = [['← →', 'choose'], ['space', 'play'], ['1-4', 'pick']]
  else if (S.scene === 'over') keys = [['space', 'again'], ['q', 'menu']]
  else keys = [...(GAMES[S.gameId] ? GAMES[S.gameId].meta.keys : []), ['p', 'pause'], ['q', 'menu']]
  let col = 1
  if (!S.focused) {
    col = cv.text(col, row, 'click here to play', C.butter, undefined, true)
    col = cv.text(col, row, '  ', undefined)
  }
  for (const [k, what] of keys) {
    if (col + k.length + what.length + 3 > cv.cols - 12) break
    col = cv.text(col, row, k, C.white, undefined, true)
    col = cv.text(col, row, ' ' + what + '   ', 0x8f8fb3)
  }
  const snd = sound ? '♪ on · m' : '♪ off · m'
  cv.text(cv.cols - snd.length - 1, row, snd, 0x6f6f93)
}

// ---------- menu ----------

const CARDS = {
  runner: { title: 'Code Runner', zh: '代码跑酷', c: C.cyan },
  rocket: { title: 'Little Rocket', zh: '小火箭', c: C.coral },
  claw: { title: 'Claw Rush', zh: '抓金子', c: C.gold },
  read: { title: 'Read with Pip', zh: '跟读', c: C.lime },
}

function drawMenu(S, cv, props) {
  const t = S.t
  const W = cv.w, H = cv.h, R = cv.rows
  const grid = W < 84
  const cardH = 10
  const cols = grid ? 2 : ORDER.length
  const cw = grid ? Math.min(30, Math.floor((W - 6) / 2) - 2) : Math.min(18, Math.floor((W - 6) / ORDER.length) - 3)
  const rowsOfCards = grid ? 2 : 1
  // rows, top to bottom: title, tagline, cards (+ labels), tip, snow
  const titleY = 3
  const tagRow = 6
  const cardTop = 16
  const cardStep = cardH + 8 // px between card rows, room for the label row
  const anyBest = ORDER.some(id => props.best && props.best[id])
  const lastLabel = Math.floor((cardTop + (rowsOfCards - 1) * cardStep + cardH + 3) / 2)
  let tipRow = lastLabel + (anyBest ? 3 : 2)
  let ground = Math.max((tipRow + 1) * 2 + 5, H - 10)
  if (ground > H - 8) {
    // no room for the tip: let the snow have it
    tipRow = -1
    ground = Math.max((lastLabel + (anyBest ? 2 : 1)) * 2 + 4, H - 10)
  }

  // aurora night: a gradient sky, a ribbon of light, stars that twinkle
  cv.vgrad(0, 0, W, ground, 0x07091a, 0x1d2b53, 6)
  for (let x = 0; x < W; x++) {
    const base = 11 + Math.sin(x * 0.07 + t * 0.6) * 2.5 + Math.sin(x * 0.023 - t * 0.3) * 3
    for (let k = 0; k < 8; k++) {
      const y = Math.round(base + k)
      const glow = (1 - k / 8) * (0.5 + 0.3 * Math.sin(x * 0.05 + t * 0.8))
      cv.tint(x, y, k < 3 ? 0x3cf0a8 : 0x7a6cf0, glow * 0.42)
    }
  }
  const textRows = new Set([tagRow, tipRow, ...Array.from({ length: rowsOfCards }, (_, k) => Math.floor((cardTop + k * cardStep + cardH + 3) / 2))])
  for (let i = 0; i < 30; i++) {
    const x = (i * 53 + 11) % W
    const y = (i * 29 + 3) % Math.max(4, ground - 4)
    if (textRows.has(Math.floor(y / 2))) continue
    if (Math.sin(t * 1.7 + i * 1.3) > -0.2) cv.set(x, y, Math.sin(t * 2.3 + i) > 0.75 ? 0xffffff : 0x56609a)
  }
  // snow field with a far ridge
  for (let x = 0; x < W; x++) {
    const hh = Math.round(2 + 2 * Math.sin(x * 0.09) + Math.sin(x * 0.31))
    cv.rect(x, ground - hh, 1, hh, 0x8ea4cf)
  }
  cv.vgrad(0, ground, W, H - ground, C.white, 0xaebfe3, 3)

  // title
  const title = "PIP'S ARCADE"
  const tw = font5Width(title)
  if (tw + 4 <= W) font5(cv, title, Math.round((W - tw) / 2), titleY, C.gold, 0x29366f, C.butter)
  else {
    const t3 = font3Width(title, 1)
    font3(cv, title, Math.round((W - t3) / 2), titleY + 1, C.gold, 1, 0x29366f)
  }
  cv.textCenter(tagRow, 'games for while Claude works', 0xb9b3d6)

  // cards
  const totalW = cols * cw + (cols - 1) * 4
  const x0 = Math.round((W - totalW) / 2)
  ORDER.forEach((id, i) => {
    const sel = i === S.menuSel
    const cx = i % cols, cy = Math.floor(i / cols)
    const x = x0 + cx * (cw + 4)
    const y = cardTop + cy * cardStep - (sel ? 1 : 0)
    const accent = CARDS[id].c
    cv.rect(x - 1, y - 1, cw + 2, cardH + 2, sel ? accent : 0x29366f)
    cv.rect(x, y, cw, cardH, sel ? 0x1d2b53 : 0x111d35)
    icon(cv, id, x, y, cw, cardH, t, sel)
    const label = (i + 1) + ' ' + CARDS[id].title
    const row = Math.floor((y + cardH + 3) / 2)
    const lx = Math.round(x + cw / 2 - label.length / 2)
    const end = cv.text(Math.max(0, lx), row, String(i + 1), sel ? C.white : 0x6f6f93, undefined, true)
    cv.text(end + 1, row, CARDS[id].title, sel ? accent : 0xa0a6c8, undefined, sel)
    const best = props.best && props.best[id]
    if (best) {
      const b = '★ ' + best.toLocaleString('en-US')
      cv.text(Math.round(x + cw / 2 - b.length / 2), row + 1, b, sel ? C.butter : 0x6f6f93)
    }
  })

  const sub = props.claude && props.claude.state === 'working' ? 'Claude is on it. Pip pauses the game when Claude needs you.' : 'Pip pauses the game whenever Claude needs you.'
  if (tipRow > 0) cv.textCenter(tipRow, clip(sub, W - 4), 0x8f8fb3)

  // Pip waddles across the snow
  const span = W - 14
  const ph = (t * 9) % (span * 2)
  const px = ph < span ? ph : span * 2 - ph
  const faceLeft = ph >= span
  const fr = P.WALK[Math.floor(t * 8) % 4]
  cv.sprite(fr, PIP, 3 + px, Math.min(H - 11, ground + 1), faceLeft)
}

function icon(cv, id, x, y, w, h, t, sel) {
  const cx = Math.round(x + w / 2), cy = Math.round(y + h / 2)
  if (id === 'claw') {
    cv.rect(x, y + h - 4, w, 4, 0x7a3a2a)
    cv.line(cx, y + 1, cx + Math.round(Math.sin(t * 2) * 3), y + 5, 0xd9c7a0)
    cv.sprite(['..YY..', '.YGGG.', 'YGWGGA', '.GGGAA'], { Y: 0xfff3a6, G: C.yellow, A: C.amber, W: 0xffffff }, cx - 2, y + h - 5)
    cv.set(cx + Math.round(Math.sin(t * 2) * 3), y + 6, 0xd7dbe6)
  } else if (id === 'rocket') {
    for (let i = 0; i < 6; i++) cv.set(x + ((i * 5 + Math.floor(t * 20)) % w), y + ((i * 3) % h), 0x6f7ab8)
    const fl = Math.floor(t * 12) % 2
    cv.sprite(['..W..', '.WBW.', '.WCW.', 'RWWWR', 'R.F.R', fl ? '..F..' : '.....'], { W: C.white, B: C.blue, C: C.cyan, R: C.red, F: C.amber }, cx - 2, cy - 3)
  } else if (id === 'runner') {
    cv.rect(x + 1, y + h - 3, 6, 1, C.cyan)
    cv.rect(x + 8, y + h - 5, 6, 1, C.pink)
    cv.sprite(P.TINY, PIP, x + 2 + (Math.floor(t * 6) % 2), y + h - 9)
  } else {
    // a line of text with one word lit
    for (let r = 0; r < 3; r++) cv.rect(x + 2, y + 3 + r * 2, w - 4, 1, 0x566c86)
    const k = Math.floor(t * 2) % 3
    cv.rect(x + 2 + k * 4, y + 5, 4, 1, C.butter)
    cv.sprite(P.TINY, PIP, x + 1 + k * 4, y - 1 + 0)
  }
}
