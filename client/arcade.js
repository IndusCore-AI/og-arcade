// OG's Arcade: the surface module that runs in the pane. A menu, four classic
// games, this week's board, and the top row that says what Claude is doing.
//
// Every game runs through sim.js on the same 72 x 40 pixel screen, seeded by
// the week, so everyone plays the same levels and a run can be replayed from
// its keys alone. That is what lets the weekly board trust a posted score.
//
// The hooks module takes this Client out of the pane while Claude asks for
// approval, so the keyboard goes back to the question, and hands the saved run
// back in `props.resume` when Claude moves on.

import { Canvas, encode, tree, blit, font3, font3Width, font5, font5Width, mix } from './lib/gfx.js'
import { C, PIP } from './lib/palette.js'
import * as P from './lib/pip.js'
import * as J from './lib/juice.js'
import { GAMES, ORDER, FIELD, DT, newRun, step, mask, record, score, weekOf, weekEnd } from './sim.js'

const KEYS = {
  left: 'left', a: 'left', h: 'left',
  right: 'right', d: 'right', l: 'right',
  up: 'up', w: 'up', k: 'up',
  down: 'down', s: 'down', j: 'down',
  space: 'action', ' ': 'action', return: 'action',
  x: 'alt', z: 'alt',
}

const SFX = {
  // Claw Rush
  drop: 'tick', miss: 'tick', grab: 'grab', thud: 'thud', cash: 'coin', 'cash-big': 'jackpot', 'cash-low': 'thud',
  boom: 'boom', dynamite: 'boom', bonus: 'bonus', buy: 'coin', nope: 'tick',
  // Little Rocket
  hit: 'hit', kill: 'pop', hurt: 'hurt', power: 'bonus', bomb: 'boom', boss: 'warn',
  // Snake
  eat: 'coin', gold: 'jackpot', faster: 'bonus', die: 'hurt',
  // Brick Break
  blip: 'tick', brick: 'pop', tough: 'hit', lose: 'hurt',
  // everyone
  clear: 'clear', over: 'over', start: 'start',
}

const CARD = {
  snake: { short: 'Snake', icon: 'snake' },
  brick: { short: 'Brick', icon: 'brick' },
  rocket: { short: 'Rocket', icon: 'rocket' },
  claw: { short: 'Claw', icon: 'claw' },
}

const DIM = 0x8f8fb3
const SOFT = 0xb9b3d6
const BAR = 0x07091a

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
    S.bootSeq = props.boot.seq
    openFromProps(S, { ...props, resume: null })
  }
  S.props = props
  return view(S, props, surface)
}

function boot(props, surface) {
  const S = {
    scene: 'menu',
    gameId: null,
    run: null,
    fx: J.makeFx(),
    t: 0,
    sceneT: 0,
    menuSel: 0,
    queue: [],
    saveT: 0,
    banner: null,
    claudeSeen: props.claude ? props.claude.state : 'idle',
    over: null,
    inputSeq: props.input ? props.input.seq : undefined,
    bootSeq: props.boot ? props.boot.seq : null,
    out: null,
    focused: false,
    props,
    surfacePost: d => surface.post(d),
  }
  S.fx.reduced = !!(props.cfg && props.cfg.reduceMotion)
  surface.setState(S)
  openFromProps(S, props)
  surface.every(33, () => {
    tick(S)
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
  if (r && r.run && GAMES[r.run.game] && r.run.world) {
    // props arrive frozen; the game mutates its world, so take a copy
    S.run = JSON.parse(JSON.stringify(r.run))
    S.gameId = S.run.game
    S.scene = 'resume'
    S.sceneT = 0
    return
  }
  const want = props.boot && props.boot.game
  if (want === 'board') openBoard(S)
  else if (want && GAMES[want]) start(S, want)
}

// ---------- flow ----------

function start(S, id) {
  S.gameId = id
  S.menuSel = Math.max(0, ORDER.indexOf(id))
  S.scene = 'play'
  S.sceneT = 0
  S.fx = J.makeFx()
  S.fx.reduced = !!(S.props && S.props.cfg && S.props.cfg.reduceMotion)
  S.run = newRun(id, weekOf(Date.now()))
  S.over = null
  send(S, { sfx: ['start'] })
}

function toMenu(S) {
  if (S.run && !S.run.done) send(S, { save: null })
  S.scene = 'menu'
  S.gameId = null
  S.run = null
  S.over = null
  S.sceneT = 0
}

function openBoard(S) {
  S.scene = 'board'
  S.sceneT = 0
  send(S, { board: 'refresh' })
}

function send(S, msg) {
  S.out = S.out || {}
  for (const [k, v] of Object.entries(msg)) {
    if (k === 'sfx') S.out.sfx = [...(S.out.sfx || []), ...v]
    else S.out[k] = v
  }
}

function flush(S) {
  if (S.out) {
    S.surfacePost(S.out)
    S.out = null
  }
}

function tick(S) {
  S.t += DT
  S.sceneT += DT
  const props = S.props || {}

  // Claude finished while we play: say so once
  const cs = props.claude ? props.claude.state : 'idle'
  if (cs !== S.claudeSeen) {
    if (cs === 'done' && S.claudeSeen !== 'done') S.banner = { text: "✓ Claude's done · esc goes back", t: 0, c: C.lime }
    if (cs === 'working' && S.claudeSeen === 'done') S.banner = null
    S.claudeSeen = cs
  }
  if (S.banner) {
    S.banner.t += DT
    if (S.banner.t > 4.2) S.banner = null
  }

  // keys for this update: one of each act; a repeat waits for the next update
  const raw = S.queue.splice(0)
  const acts = []
  const later = []
  for (const k of raw) {
    const key = String(k).toLowerCase()
    if (key === 'click') continue
    if (key === 'm') { send(S, { cfg: { sound: !(props.cfg && props.cfg.sound !== false) } }); continue }
    if (S.scene === 'menu') { menuKey(S, key); continue }
    if (S.scene === 'board') {
      if (key === 'q' || key === 'b' || KEYS[key] === 'action') toMenu(S)
      continue
    }
    if (key === 'q') { toMenu(S); continue }
    if (key === 'p' && (S.scene === 'play' || S.scene === 'pause')) {
      S.scene = S.scene === 'play' ? 'pause' : 'play'
      continue
    }
    if (S.scene === 'pause' || S.scene === 'resume') {
      if (KEYS[key] === 'action' || key === 'p') resume(S)
      continue
    }
    if (S.scene === 'over') {
      if (key === 'b' && postable(S)) send(S, { post: S.gameId })
      else if (S.sceneT > 0.4 && KEYS[key] === 'action') start(S, S.gameId)
      continue
    }
    const a = KEYS[key]
    if (!a) continue
    if (acts.includes(a)) later.push(key)
    else acts.push(a)
  }
  if (raw.includes('click') && (S.scene === 'resume' || S.scene === 'pause')) resume(S)

  const run = S.run
  if (run && S.scene === 'play') {
    if (S.fx.stop > 0) {
      // presses during a freeze still count, one update late
      S.fx.stop -= DT
      S.queue.push(...raw.filter(k => KEYS[String(k).toLowerCase()]))
    } else {
      S.queue.push(...later)
      const events = step(run, mask(acts), S.fx)
      const sounds = events.map(e => SFX[e]).filter(Boolean)
      if (sounds.length) send(S, { sfx: sounds })
      if (run.done) finish(S)
    }
    J.stepFx(S.fx, DT)
    S.saveT += DT
    if (S.saveT > 0.5 && !run.done) {
      S.saveT = 0
      send(S, { save: { run } })
    }
  } else if (run && S.scene === 'over') {
    const G = GAMES[run.game]
    if (G.idle) G.idle(run.world, DT)
    J.stepFx(S.fx, DT)
  }
  flush(S)
}

function resume(S) {
  S.scene = 'play'
  S.sceneT = 0
  S.fx.stop = 0.25
}

function finish(S) {
  const run = S.run
  const G = GAMES[run.game]
  const sc = score(run)
  const props = S.props || {}
  const allBest = (props.best && props.best[run.game]) || 0
  const wk = props.week && props.week.key === run.week && props.week.best ? props.week.best[run.game] : null
  const weekBest = wk ? wk.score : 0
  S.over = {
    score: sc,
    week: run.week,
    isBest: sc > allBest && sc > 0,
    isWeekBest: sc > weekBest && sc > 0,
    best: Math.max(sc, allBest),
    title: G.overTitle ? G.overTitle(run.world) : 'Game over',
  }
  S.scene = 'over'
  S.sceneT = 0
  send(S, { score: { game: run.game, score: sc }, run: record(run), save: null })
}

/** The over card offers to post when this game's best run of the week hasn't gone up yet. */
function postable(S) {
  const props = S.props || {}
  const o = S.over
  if (!o || !props.week || props.week.key !== o.week) return false
  const wb = props.week.best && props.week.best[S.gameId]
  return !!wb && wb.score > 0 && wb.posted !== 'posted' && wb.posted !== 'posting'
}

function menuKey(S, key) {
  const n = ORDER.length
  if (KEYS[key] === 'left' || KEYS[key] === 'up') S.menuSel = (S.menuSel + n - 1) % n
  else if (KEYS[key] === 'right' || KEYS[key] === 'down') S.menuSel = (S.menuSel + 1) % n
  else if (key >= '1' && key <= String(n)) start(S, ORDER[Number(key) - 1])
  else if (KEYS[key] === 'action') start(S, ORDER[S.menuSel])
  else if (key === 'b') openBoard(S)
}

// ---------- view ----------

function area(surface) {
  const cols = Math.max(20, surface.columns || 76)
  const rows = Math.max(8, surface.rows || 24)
  return { cols, rows, w: cols, h: (rows - 2) * 2 }
}

function view(S, props, surface) {
  const el = surface.elements
  const { cols, rows, w, h } = area(surface)
  if (cols < FIELD.w || h < FIELD.h) {
    const { Box, Text } = el
    return Box({
      flexDirection: 'column',
      children: [
        Text({ bold: true, children: ["OG's Arcade needs a little more room"] }),
        Text({ children: ['The games need ' + FIELD.w + ' × ' + (FIELD.h / 2 + 2) + ' cells; this pane has ' + cols + ' × ' + rows + '.'] }),
        Text({ dimColor: true, children: ['Make the terminal a bit bigger, or widen the pane with ctrl+x then ←.'] }),
      ],
    })
  }
  const cv = new Canvas(cols, rows * 2, BAR)
  const acv = new Canvas(w, h, C.night)

  if (S.scene === 'menu' || !S.run) {
    if (S.scene === 'board') drawBoard(S, acv, props)
    else drawMenu(S, acv, props)
  } else {
    const fcv = new Canvas(FIELD.w, FIELD.h, C.night)
    drawGame(S, fcv, props)
    cabinet(acv, fcv, S, props)
  }

  blit(cv, acv, 0, 1)
  drawStatus(S, cv, props)
  drawHints(S, cv, props)
  return tree(el, encode(cv))
}

/** The fixed game screen, centred, in a thin frame when the pane has room for one. */
function cabinet(acv, fcv, S, props) {
  const x = Math.floor((acv.w - fcv.w) / 2)
  const rowOff = Math.floor((acv.rows - fcv.rows) / 2)
  const y = rowOff * 2
  acv.rect(0, 0, acv.w, acv.h, BAR)
  if (x >= 1 || rowOff >= 1) {
    // the menu cards' indigo
    acv.rect(x - 1, y - 1, fcv.w + 2, fcv.h + 2, 0x29366f)
  }
  blit(acv, fcv, x, rowOff)
  if (rowOff >= 3) {
    const wb = props.week && props.week.best && props.week.best[S.gameId]
    const place = wb && wb.score ? placeFor(props.board, S.gameId, wb.score, props.login) : 0
    const bits = ['week ' + Number((S.run.week || '').slice(-2)) + ' levels']
    if (wb && wb.score) bits.push('your best ' + fmt(wb.score))
    if (place) bits.push('#' + place + ' on the board')
    const leader = props.board && props.board.week === S.run.week && props.board.games && (props.board.games[S.gameId] || [])[0]
    if (leader && leader.login !== props.login) bits.push('top: @' + leader.login + ' ' + fmt(leader.score))
    acv.textCenter(rowOff + fcv.rows + 1, clip(bits.join(' · '), acv.cols - 4), DIM)
  }
}

function drawGame(S, fcv, props) {
  const run = S.run
  const G = GAMES[run.game]
  const off = J.offset(S.fx)
  fcv.ox = off.x
  fcv.oy = off.y
  G.draw(run.world, fcv, S.fx, S.t)
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
  if (S.scene === 'over' && S.over) overCard(S, fcv, props)
}

/** A centred title in the 5x7 font, or the 3x5 one when it would not fit. */
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
  cv.textCenter(Math.floor((y + 12) / 2), ' ' + clip(sub, cv.cols - 4) + ' ', SOFT)
}

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US')
}

/** Where a score would land on this week's board for a game (1-based), or 0 if unknown. */
function placeFor(board, game, sc, login) {
  if (!board || !board.games || !Array.isArray(board.games[game])) return 0
  const others = board.games[game].filter(e => e.login !== login)
  return others.filter(e => e.score >= sc).length + 1
}

function overCard(S, cv, props) {
  const o = S.over
  const k = Math.min(1, S.sceneT * 3)
  cv.wash(0x0d1330, 0.66 * k)
  // the text band sits on near-solid night, so nothing in the game shows through a letter
  for (let y = 12; y < 32 && y < cv.h; y++) for (let x = 0; x < cv.w; x++) cv.tint(x, y, 0x0d1330, 0.9 * k)
  bigTitle(cv, o.title, 3, o.isWeekBest ? C.lime : C.butter)
  let r = 7
  cv.textCenter(r, ' score ' + fmt(o.score) + ' ', C.white, undefined, true)
  r++
  if (o.isWeekBest) {
    const blink = Math.floor(S.t * 3) % 2 === 0
    cv.textCenter(r, o.isBest ? ' ★ new best ever ' : ' ★ your best this week ', blink ? C.night : C.gold, blink ? C.gold : undefined, true)
  } else {
    const wb = props.week && props.week.best && props.week.best[S.gameId]
    const week = wb ? wb.score : o.score
    cv.textCenter(r, 'best this week ' + fmt(week) + ' · ever ' + fmt(Math.max(o.best, week)), DIM)
  }
  r += 2
  // the board: post it, or say where it stands
  const wk = props.week && props.week.key === o.week ? props.week : null
  const wb = wk && wk.best ? wk.best[S.gameId] : null
  const who = props.login ? ' as @' + props.login : ''
  if (wb && wb.score > 0) {
    if (wb.posted === 'posted') cv.textCenter(r, '✓ posted ' + fmt(wb.score) + ' · the board checks it within a few minutes', C.lime)
    else if (wb.posted === 'posting') cv.textCenter(r, 'posting to the board…', C.butter)
    else if (wb.posted === 'error') cv.textCenter(r, clip(wb.msg || 'could not post', cv.cols - 4), C.coral)
    else {
      const end = 'post ' + fmt(wb.score) + ' to the weekly board' + who
      const n = end.length + 2
      const x = Math.floor((cv.cols - n) / 2)
      const c = cv.text(x, r, 'b', C.night, C.gold, true)
      cv.text(c + 1, r, end, C.gold)
    }
    r++
    const place = placeFor(props.board, S.gameId, wb.score, props.login)
    if (place) cv.textCenter(r, place === 1 ? "that's #1 this week" : "that's #" + place + ' on this week\'s ' + GAMES[S.gameId].meta.title + ' board', SOFT)
  }
  r += 2
  cv.textCenter(r, 'space again · q menu', DIM)
  // Pip celebrates or shrugs
  const room = cv.h - (r + 1) * 2
  if (room >= 12) {
    const spr = o.isWeekBest ? (Math.floor(S.t * 4) % 2 ? P.CHEER : P.FRONT) : P.FRONT
    cv.sprite(spr, PIP, Math.round(cv.w / 2 - 5), cv.h - 12)
  }
}

// ---------- status and hints rows ----------

function fmtTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}

function left(ms) {
  const m = Math.max(0, Math.floor(ms / 60000))
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60)
  return d > 0 ? d + 'd ' + h + 'h' : h > 0 ? h + 'h ' + (m % 60) + 'm' : (m % 60) + 'm'
}

function clip(s, n) {
  s = String(s)
  return s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s
}

function drawStatus(S, cv, props) {
  const cl = props.claude || { state: 'idle' }
  cv.rect(0, 0, cv.w, 2, BAR)
  let col = 1
  if (cl.state === 'working') {
    const on = Math.floor(S.t * 2.5) % 2 === 0
    col = cv.text(col, 0, on ? '●' : '○', C.cyan, undefined, true)
    const what = cl.label ? 'Claude is ' + cl.label : 'Claude is working'
    const since = cl.since ? '  ' + fmtTime(Date.now() - cl.since) : ''
    col = cv.text(col + 1, 0, clip(what, cv.cols - 32), C.ice)
    col = cv.text(col, 0, since, DIM)
  } else if (cl.state === 'done') {
    col = cv.text(col, 0, "✓ Claude's done", C.lime, undefined, true)
    col = cv.text(col, 0, '  esc goes back to it', 0x9fd6a0)
  } else if (cl.state === 'needs') {
    col = cv.text(col, 0, '! Claude needs you below', C.gold, undefined, true)
  } else {
    col = cv.text(col, 0, 'Claude is idle', DIM)
  }
  const G = S.gameId && GAMES[S.gameId]
  const title = G ? G.meta.title : "OG's Arcade"
  const wb = G && props.week && props.week.best && props.week.best[S.gameId]
  const best = wb && wb.score ? '  week ★ ' + fmt(wb.score) : ''
  const right = title + best + ' '
  if (cv.cols - right.length > col + 4) {
    const x = cv.cols - right.length
    const end = cv.text(x, 0, title, C.butter, undefined, true)
    cv.text(end, 0, best, DIM)
  }
}

function drawHints(S, cv, props) {
  const row = cv.rows - 1
  cv.rect(0, row * 2, cv.w, 2, BAR)
  const sound = !(props.cfg && props.cfg.sound === false)
  let keys
  if (S.scene === 'menu') keys = [['← →', 'choose'], ['space', 'play'], ['1-4', 'pick'], ['b', 'board']]
  else if (S.scene === 'board') keys = [['b', 'back'], ['q', 'menu']]
  else if (S.scene === 'over') keys = [['space', 'again'], ...(postable(S) ? [['b', 'post']] : []), ['q', 'menu']]
  else keys = [...(GAMES[S.gameId] ? GAMES[S.gameId].meta.keys : []), ['p', 'pause'], ['q', 'menu']]
  let col = 1
  if (props.classic) {
    col = cv.text(col, row, 'the keys under the game drive it', DIM)
    keys = []
  } else if (!S.focused) {
    col = cv.text(col, row, 'click here to play', C.butter, undefined, true)
    col = cv.text(col, row, '  ', undefined)
  }
  for (const [k, what] of keys) {
    if (col + k.length + what.length + 3 > cv.cols - 12) break
    col = cv.text(col, row, k, C.white, undefined, true)
    col = cv.text(col, row, ' ' + what + '   ', DIM)
  }
  const snd = sound ? '♪ on · m' : '♪ off · m'
  cv.text(cv.cols - snd.length - 1, row, snd, 0x6f6f93)
}

// ---------- menu ----------

function sky(cv, t, ground, skipRows) {
  const W = cv.w
  cv.vgrad(0, 0, W, ground, 0x07091a, 0x1d2b53, 6)
  for (let x = 0; x < W; x++) {
    const base = 9 + Math.sin(x * 0.07 + t * 0.6) * 2.5 + Math.sin(x * 0.023 - t * 0.3) * 3
    for (let k = 0; k < 8; k++) {
      const y = Math.round(base + k)
      const glow = (1 - k / 8) * (0.5 + 0.3 * Math.sin(x * 0.05 + t * 0.8))
      cv.tint(x, y, k < 3 ? 0x3cf0a8 : 0x7a6cf0, glow * 0.42)
    }
  }
  for (let i = 0; i < 30; i++) {
    const x = (i * 53 + 11) % W
    const y = (i * 29 + 3) % Math.max(4, ground - 4)
    if (skipRows.has(Math.floor(y / 2))) continue
    if (Math.sin(t * 1.7 + i * 1.3) > -0.2) cv.set(x, y, Math.sin(t * 2.3 + i) > 0.75 ? 0xffffff : 0x56609a)
  }
}

function drawMenu(S, cv, props) {
  const t = S.t
  const W = cv.w, H = cv.h
  const n = ORDER.length
  const cardH = 10
  const cw = Math.min(16, Math.floor((W - 6) / n) - 3)
  const gap = 4
  // the block: title, tagline, cards, blurb, week line, and this week's top
  // three when there is room. Tall panes centre it above the snow.
  let board = props.board && props.week && props.board.week === props.week.key && Array.isArray(props.board.og) ? props.board.og.slice(0, 3) : []
  // the list starts two rows under the week line (row 20 at the least), and
  // shows only if two or more fit
  const fits = cv.rows - 20
  board = fits >= 2 ? board.slice(0, fits) : []
  const block = 20 + (board.length ? board.length + 2 : 0) // rows
  const free = cv.rows - block - 7
  const top = free > 2 ? Math.min(6, Math.floor(free / 2)) : 0
  const titleY = 2 + top * 2
  const tagRow = 5 + top
  const cardTop = 14 + top * 2
  const labelRow = Math.floor((cardTop + cardH + 2) / 2)
  const blurbRow = labelRow + 3
  const weekRow = blurbRow + 2
  const topRow = weekRow + 2
  const last = board.length ? topRow + board.length : weekRow
  const ground = Math.max((last + 1) * 2 + 2, H - 12)
  const roomForPip = H - ground >= 12
  // no stars on or between the rows people read
  const textRows = new Set([tagRow, ...Array.from({ length: last - labelRow + 2 }, (_, i) => labelRow + i)])

  sky(cv, t, roomForPip ? ground : H, textRows)
  if (roomForPip) {
    for (let x = 0; x < W; x++) {
      const hh = Math.round(2 + 2 * Math.sin(x * 0.09) + Math.sin(x * 0.31))
      cv.rect(x, ground - hh, 1, hh, 0x8ea4cf)
    }
    cv.vgrad(0, ground, W, H - ground, C.white, 0xaebfe3, 3)
  }

  // title
  const title = "OG'S ARCADE"
  const tw = font5Width(title)
  if (tw + 4 <= W) font5(cv, title, Math.round((W - tw) / 2), titleY, C.gold, 0x29366f, C.butter)
  else font3(cv, title, Math.round((W - font3Width(title, 1)) / 2), titleY + 1, C.gold, 1, 0x29366f)
  cv.textCenter(tagRow, 'four classics for while Claude works', SOFT)

  // cards, one row of four
  const totalW = n * cw + (n - 1) * gap
  const x0 = Math.round((W - totalW) / 2)
  ORDER.forEach((id, i) => {
    const G = GAMES[id]
    const sel = i === S.menuSel
    const x = x0 + i * (cw + gap)
    const y = cardTop - (sel ? 1 : 0)
    const accent = G.meta.accent || C.gold
    cv.rect(x - 1, y - 1, cw + 2, cardH + 2, sel ? accent : 0x29366f)
    cv.rect(x, y, cw, cardH, sel ? 0x1d2b53 : 0x111d35)
    icon(cv, id, x, y, cw, cardH, t, sel)
    const label = CARD[id].short
    const lx = Math.round(x + cw / 2 - (label.length + 2) / 2)
    const end = cv.text(Math.max(0, lx), labelRow, String(i + 1), sel ? C.white : 0x6f6f93, undefined, true)
    cv.text(end + 1, labelRow, label, sel ? accent : 0xa0a6c8, undefined, sel)
    const wb = props.week && props.week.best && props.week.best[id]
    const best = wb && wb.score ? wb.score : props.best && props.best[id]
    if (best) {
      const b = '★ ' + fmt(best)
      cv.text(Math.round(x + cw / 2 - b.length / 2), labelRow + 1, b, sel ? C.butter : 0x6f6f93)
    }
  })

  // the chosen game, in a line (no Chinese here: terminals draw it two cells
  // wide, and these rows count one)
  const G = GAMES[ORDER[S.menuSel]]
  cv.textCenter(blurbRow, clip(G.meta.title + ' · ' + G.meta.blurb, W - 4), C.white)

  // this week
  const wk = props.week ? props.week.key : weekOf(Date.now())
  const champ = props.board && props.board.champion
  let line = 'week ' + Number(wk.slice(-2)) + ' · same levels for everyone · ' + left(weekEnd(wk) - Date.now()) + ' left'
  if (champ && champ.login) line = 'week ' + Number(wk.slice(-2)) + ' · ' + left(weekEnd(wk) - Date.now()) + ' left · last week\'s OG @' + champ.login
  cv.textCenter(weekRow, clip(line, W - 4), SOFT)
  board.forEach((e, i) => {
    const me = props.login && e.login === props.login
    const s = (i + 1) + '  ' + clip('@' + e.login, 20).padEnd(21) + String(e.points).padStart(3) + ' pts'
    const x = Math.floor((W - s.length) / 2)
    cv.text(x, topRow + i, String(i + 1), i === 0 ? C.gold : DIM, undefined, true)
    cv.text(x + 3, topRow + i, clip('@' + e.login, 20), me ? C.lime : C.white, undefined, i === 0)
    cv.text(x + 24, topRow + i, String(e.points).padStart(3) + ' pts', i === 0 ? C.gold : DIM)
  })

  // Pip waddles across the snow
  if (roomForPip) {
    const span = W - 14
    const ph = (t * 9) % (span * 2)
    const px = ph < span ? ph : span * 2 - ph
    const fr = P.WALK[Math.floor(t * 8) % 4]
    cv.sprite(fr, PIP, 3 + px, Math.min(H - 11, ground + 1), ph >= span)
  }
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
  } else if (id === 'snake') {
    // a little snake slithering towards a fish
    const k = Math.floor(t * 6) % 4
    const body = [[1, 6], [2, 6], [3, 6], [4, 6], [4, 5], [4, 4], [5, 4], [6, 4]]
    body.forEach(([bx, by], i) => cv.set(x + 1 + bx, y + by, mix(C.leaf, C.lime, i / (body.length - 1))))
    cv.set(x + 8, y + 4, C.lime)
    cv.set(x + 8, y + 3, C.deep)
    if (k < 2) cv.set(x + 9, y + 4, C.pink)
    cv.set(x + w - 4, y + 4, C.gold)
    cv.set(x + w - 3, y + 4, C.gold)
    cv.set(x + w - 2, y + 3, C.amber)
    cv.set(x + w - 2, y + 5, C.amber)
  } else if (id === 'brick') {
    const cols = [C.pink, C.orange, C.gold, C.lime]
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < Math.floor((w - 2) / 3); c++) if ((r + c) % 5 !== 2) cv.rect(x + 1 + c * 3, y + 1 + r * 2, 2, 1, cols[r])
    const bx = x + 2 + Math.round((Math.sin(t * 2.2) * 0.5 + 0.5) * (w - 5))
    const by = y + h - 3 - Math.round(Math.abs(Math.sin(t * 4)) * 3)
    cv.set(bx, by, C.white)
    cv.rect(x + Math.round((Math.sin(t * 2.2) * 0.5 + 0.5) * (w - 6)), y + h - 2, 5, 1, C.ice)
  }
}

// ---------- the weekly board ----------

function drawBoard(S, cv, props) {
  const t = S.t
  const W = cv.w
  sky(cv, t, cv.h, new Set(Array.from({ length: cv.rows }, (_, i) => i).filter(r => r >= 4)))
  const wk = props.week ? props.week.key : weekOf(Date.now())
  const title = 'WEEK ' + Number(wk.slice(-2))
  font5(cv, title, Math.round((W - font5Width(title)) / 2), 1, C.gold, 0x29366f, C.butter)
  cv.textCenter(5, 'OG of the week · ends in ' + left(weekEnd(wk) - Date.now()), SOFT)
  const b = props.board
  if (!b || b.week !== wk) {
    const loading = props.boardState === 'loading'
    cv.textCenter(8, loading ? 'Loading the board…' : 'Nobody has posted a run this week yet.', C.white, undefined, true)
    cv.textCenter(10, 'Finish a game, then press b on the game-over screen.', SOFT)
    cv.textCenter(11, 'Everyone plays the same levels until Monday 00:00 UTC.', DIM)
    if (b && b.champion && b.champion.login) cv.textCenter(13, "last week's OG: @" + b.champion.login + ' · ' + b.champion.points + ' points', C.gold)
    cv.textCenter(cv.rows - 1, 'github.com/IndusCore-AI/og-arcade', DIM)
    return
  }
  // overall: points from each game's ranking
  let r = 7
  const og = (b.og || []).slice(0, Math.max(3, Math.min(5, cv.rows - 14)))
  og.forEach((e, i) => {
    const me = props.login && e.login === props.login
    const medal = i === 0 ? C.gold : i === 1 ? C.mist : i === 2 ? C.rose : DIM
    const name = clip('@' + e.login, 22)
    const pts = e.points + ' pts'
    const line = String(i + 1).padStart(2) + '  ' + name.padEnd(24) + pts.padStart(8)
    const x = Math.floor((W - line.length) / 2)
    cv.text(x, r, String(i + 1).padStart(2), medal, undefined, true)
    cv.text(x + 4, r, name, me ? C.lime : C.white, undefined, i === 0)
    cv.text(x + 4 + 24, r, pts.padStart(8), i === 0 ? C.gold : SOFT)
    r++
  })
  r++
  // each game's top three
  const colW = Math.floor((W - 2) / ORDER.length)
  ORDER.forEach((id, i) => {
    const G = GAMES[id]
    const x = 1 + i * colW
    cv.text(x, r, clip(G.meta.title, colW - 1), G.meta.accent || C.gold, undefined, true)
    const list = (b.games && b.games[id]) || []
    for (let k = 0; k < 3; k++) {
      const e = list[k]
      if (!e) { if (k === 0) cv.text(x, r + 1, 'no runs yet', 0x6f6f93); break }
      const sc = fmt(e.score)
      const name = clip('@' + e.login, colW - sc.length - 2)
      const me = props.login && e.login === props.login
      cv.text(x, r + 1 + k, name, me ? C.lime : k === 0 ? C.white : SOFT)
      cv.text(x + colW - 1 - sc.length, r + 1 + k, sc, k === 0 ? C.butter : DIM)
    }
  })
  r += 5
  if (b.champion && b.champion.login && r < cv.rows - 1) cv.textCenter(r, "last week's OG: @" + b.champion.login + ' · ' + b.champion.points + ' points', C.gold)
  cv.textCenter(cv.rows - 1, 'github.com/IndusCore-AI/og-arcade', DIM)
}
