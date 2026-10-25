// Read with Pip: drawn over Claude's own reply in the transcript (or in the
// pane on the classic renderer). The whole answer stays on screen. Pip walks
// along it word by word and the word under Pip's feet lights up, the way a
// desk lamp lights the letter under it. Words already read dim a little.
//
// Pace follows the evidence on reading guides: about 200-300 words a minute
// on full, visible text, slower on code, a pause at the end of a sentence,
// and looking back is always one key away.
//
// Keys, once you click Pip: ← → a word back or ahead, ↑ ↓ faster or slower,
// space pause, g start over, q close. Clicking a word moves Pip there.

import { PIP } from './lib/palette.js'
import { TINY, TINY_STEP, TINY_HOP } from './lib/pip.js'
import { hex } from './lib/gfx.js'

const DT = 1 / 30
const LANE = 3 // rows above the current line where Pip walks
const LIGHT = 0xffd166
const LIGHT_SOFT = 0x6b5a2a

// ---------- markdown, simplified to what a reply holds ----------

function inline(text) {
  // words with styles: **bold**, `code`, [label](url), _em_ / *em*
  const out = []
  let bold = false, code = false
  let cur = ''
  let style = 0
  const push = () => {
    if (cur) out.push({ w: cur, b: style & 1, c: style & 2 })
    cur = ''
  }
  const s = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (!code && ch === '*' && s[i + 1] === '*') { bold = !bold; i++; style = (bold ? 1 : 0) | (code ? 2 : 0); continue }
    if (ch === '`') { code = !code; style = (bold ? 1 : 0) | (code ? 2 : 0); continue }
    if (!code && (ch === '*' || ch === '_') && (i === 0 || /\s/.test(s[i - 1]) || /\s|[.,;:!?]/.test(s[i + 1] || ' '))) continue
    if (/\s/.test(ch)) { push(); continue }
    if (!cur) style = (bold ? 1 : 0) | (code ? 2 : 0)
    cur += ch
  }
  push()
  return out
}

function parse(md) {
  const blocks = []
  let para = null
  let inCode = false
  for (const raw of String(md || '').split('\n')) {
    const line = raw.replace(/\t/g, '  ')
    if (/^\s*```/.test(line)) { inCode = !inCode; para = null; continue }
    if (inCode) { blocks.push({ k: 'code', text: line }); para = null; continue }
    if (!line.trim()) { if (blocks.length && blocks[blocks.length - 1].k !== 'gap') blocks.push({ k: 'gap' }); para = null; continue }
    let m
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) { blocks.push({ k: 'head', words: inline(m[2]) }); para = null; continue }
    if ((m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line))) {
      const ordered = /\d/.test(m[2])
      blocks.push({ k: 'item', lead: Math.floor(m[1].length / 2), mark: ordered ? m[2] : '•', words: inline(m[3]) })
      para = blocks[blocks.length - 1]
      continue
    }
    if (/^\s*\|/.test(line)) { blocks.push({ k: 'table', text: line.trim() }); para = null; continue }
    if ((m = /^>\s?(.*)$/.exec(line))) { blocks.push({ k: 'quote', words: inline(m[1]) }); para = null; continue }
    if (para && (para.k === 'para' || para.k === 'item')) { para.words.push(...inline(line)); continue }
    para = { k: 'para', words: inline(line) }
    blocks.push(para)
  }
  return blocks
}

/** Wraps blocks into lines of cells; returns { lines, words }. */
function layout(md, width) {
  const blocks = parse(md)
  const lines = []
  const words = [] // { w, b, c, line, col, code, end }
  const W = Math.max(16, width)
  const addWords = (list, indent, first, opts = {}) => {
    let line = { segs: [], indent, prefix: first }
    let col = indent + (first ? first.length : 0)
    const start = col
    for (const wd of list) {
      const len = [...wd.w].length
      if (col + len > W && col > start) {
        lines.push(line)
        line = { segs: [], indent, prefix: null }
        col = start
      }
      const idx = words.length
      words.push({ ...wd, line: lines.length, col, len, code: opts.code || wd.c, head: opts.head })
      line.segs.push(idx)
      col += len + 1
    }
    lines.push(line)
    if (words.length) words[words.length - 1].end = true
  }
  for (const b of blocks) {
    if (b.k === 'gap') { lines.push({ segs: [], gap: true }); continue }
    if (b.k === 'head') addWords(b.words, 0, null, { head: true })
    else if (b.k === 'para') addWords(b.words, 0, null)
    else if (b.k === 'quote') addWords(b.words, 2, '│ ')
    else if (b.k === 'item') addWords(b.words, b.lead * 2, b.mark + ' ')
    else if (b.k === 'code' || b.k === 'table') {
      // code reads token by token, never wrapped: long lines are clipped
      const text = b.text.slice(0, W)
      const lead = text.length - text.trimStart().length
      const toks = text.trim() ? text.trim().split(/\s+/).map(w => ({ w, b: 0, c: 2 })) : []
      if (!toks.length) { lines.push({ segs: [], code: true }); continue }
      addWords(toks, lead, null, { code: true })
      lines[lines.length - 1].code = true
    }
  }
  while (lines.length && lines[lines.length - 1].gap) lines.pop()
  return { lines, words }
}

function duration(word, wpm) {
  const base = 60 / wpm
  let d = base * Math.min(2.2, Math.max(0.6, 0.72 + 0.055 * word.len))
  if (word.code) d *= 1.35
  const last = word.w[word.w.length - 1]
  if (/[.!?]/.test(last)) d += base * 0.7
  else if (/[,;:]/.test(last)) d += base * 0.3
  if (word.end) d += base * 0.6
  return d
}

// ---------- the surface module ----------

export default function Reader(props, surface) {
  if (surface.state === undefined) {
    const R = { i: 0, tw: 0, playing: true, wpm: props.wpm || 260, focused: false, done: false, doneT: 0, x: 0, line: 0, hop: 0, hopFrom: 0, t: 0, lay: null, layKey: '', closed: false, seq: props.seq, elapsed: 0, back: 0 }
    surface.setState(R)
    surface.every(33, () => {
      step(R, surface)
      surface.setState(R)
    })
    surface.onKey(k => {
      R.focused = true
      key(R, k.key, surface)
      surface.setState(R)
    })
    surface.onPointer(p => {
      if (p.type !== 'down') return
      R.focused = true
      clickAt(R, p.x, p.y)
      surface.setState(R)
    })
  }
  const R = surface.state
  R.props = props
  const gutter = props.pane ? 0 : 2
  R.gutter = gutter
  const width = Math.max(16, (surface.columns || 80) - 3 - gutter)
  const lk = width + '|' + (props.text || '').length + '|' + (props.text || '').slice(0, 40)
  if (R.layKey !== lk) {
    R.lay = layout(props.text, width)
    R.layKey = lk
    if (R.i >= R.lay.words.length) R.i = Math.max(0, R.lay.words.length - 1)
  }
  return view(R, props, surface)
}

function step(R, surface) {
  R.t += DT
  const lay = R.lay
  if (!lay || !lay.words.length || R.closed) return
  if (R.hop > 0) R.hop = Math.max(0, R.hop - DT)
  if (R.back > 0) R.back = Math.max(0, R.back - DT)
  const w = lay.words[R.i]
  // Pip waits while the line it's on is scrolled out of view
  const onScreen = R.props && R.props.onScreen
  const row = w.line + LANE
  R.away = !!(onScreen && (row + 1 > onScreen.last || row < onScreen.first))
  if (R.done) {
    R.doneT += DT
    if (R.doneT > 6 && !R.closed) close(R, surface)
  } else if (R.playing && !R.away) {
    R.elapsed += DT
    R.tw += DT
    if (R.tw >= duration(w, R.wpm)) {
      R.tw = 0
      if (R.i < lay.words.length - 1) advance(R, 1)
      else R.done = true
    }
  }
  // Pip glides toward the middle of its word
  const target = w.col + w.len / 2
  R.x += (target - R.x) * Math.min(1, DT * 14)
}

function advance(R, d) {
  const lay = R.lay
  const prev = lay.words[R.i]
  R.i = Math.max(0, Math.min(lay.words.length - 1, R.i + d))
  const now = lay.words[R.i]
  if (now.line !== prev.line) {
    R.hop = 0.26
    R.hopFrom = prev.line
    if (Math.abs(now.line - prev.line) > 2 || d < 0) R.x = now.col + now.len / 2
  }
  R.tw = 0
}

function key(R, k, surface) {
  const lay = R.lay
  if (!lay) return
  if (k === 'left' || k === 'h' || k === 'a') { R.done = false; advance(R, -1); R.back = 1.2 }
  else if (k === 'right' || k === 'l' || k === 'd') advance(R, 1)
  else if (k === 'up' || k === 'k' || k === 'w') R.wpm = Math.min(600, R.wpm + 20)
  else if (k === 'down' || k === 'j' || k === 's') R.wpm = Math.max(120, R.wpm - 20)
  else if (k === 'space' || k === ' ' || k === 'return') {
    if (R.done) restart(R)
    else R.playing = !R.playing
  } else if (k === 'g' || k === 'home') restart(R)
  else if (k === 'q') close(R, surface)
}

function restart(R) {
  R.i = 0
  R.tw = 0
  R.done = false
  R.doneT = 0
  R.playing = true
  R.elapsed = 0
}

function close(R, surface) {
  if (R.closed) return
  R.closed = true
  surface.post({ readDone: true, wpm: R.wpm })
}

function clickAt(R, x, y) {
  const lay = R.lay
  if (!lay) return
  // rows: lines before Pip's line, the lane, then the rest
  x -= R.gutter || 0
  const cur = lay.words[R.i].line
  let line = y < cur ? y : y - LANE
  if (y >= cur && y < cur + LANE) return
  const hit = lay.words.find(w => w.line === line && x >= w.col && x < w.col + w.len + 1)
  if (hit) {
    R.i = lay.words.indexOf(hit)
    R.tw = 0
    R.done = false
    R.x = hit.col + hit.len / 2
  }
}

// ---------- drawing ----------

function laneRows(R, width, theme) {
  // Pip as half-block cells over the terminal's own background
  const w = R.lay.words[R.i]
  let spr = Math.floor(R.t * 8) % 2 && Math.abs(R.x - (w.col + w.len / 2)) > 0.6 ? TINY_STEP : TINY
  let lift = 0
  if (R.hop > 0) {
    spr = TINY_HOP
    const k = 1 - R.hop / 0.26
    lift = Math.round(Math.sin(k * Math.PI) * 2)
  }
  if (R.done) {
    spr = Math.floor(R.t * 4) % 2 ? TINY_HOP : TINY
    lift = Math.floor(R.t * 4) % 2
  }
  if (!R.done && !R.playing) spr = TINY
  const H = LANE * 2
  const px = Array.from({ length: H }, () => new Array(width).fill(-1))
  const x0 = Math.round(R.x - spr[0].length / 2)
  const y0 = H - spr.length - lift
  spr.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const c = PIP[row[i]]
      const y = y0 + j, x = x0 + i
      if (c !== undefined && row[i] !== '.' && y >= 0 && y < H && x >= 0 && x < width) px[y][x] = c
    }
  })
  // the lamp: a little light under Pip's feet, on the word below
  return px
}

function encodeLane(px, Text, gutter) {
  const rows = []
  for (let r = 0; r < px.length; r += 2) {
    const runs = []
    const top = px[r], bot = px[r + 1]
    for (let x = 0; x < top.length; x++) {
      const a = top[x], b = bot[x]
      let s, fg, bg
      if (a < 0 && b < 0) s = ' '
      else if (a >= 0 && b < 0) { s = '▀'; fg = a }
      else if (a < 0) { s = '▄'; fg = b }
      else { s = '▀'; fg = a; bg = b }
      const last = runs[runs.length - 1]
      if (last && last.fg === fg && last.bg === bg) last.s += s
      else runs.push({ s, fg, bg })
    }
    while (runs.length && runs[runs.length - 1].fg === undefined && runs[runs.length - 1].bg === undefined) runs.pop()
    const kids = runs.map(k => {
      if (k.fg === undefined && k.bg === undefined) return k.s
      const p = { children: [k.s] }
      if (k.fg !== undefined) p.color = hex(k.fg)
      if (k.bg !== undefined) p.backgroundColor = hex(k.bg)
      return Text(p)
    })
    rows.push(Text({ children: kids.length ? (gutter ? ['  ', ...kids] : kids) : [' '] }))
  }
  return rows
}

function textRow(R, line, li, Text, theme) {
  const lay = R.lay
  const kids = []
  if (R.gutter) kids.push(li === 0 && !R.props.notFirst ? Text({ color: '#5f86ec', children: ['⏺ '] }) : '  ')
  const pad = line.indent || 0
  if (pad) kids.push(' '.repeat(pad))
  if (line.prefix) kids.push(Text({ dimColor: true, children: [line.prefix] }))
  line.segs.forEach((idx, n) => {
    const w = lay.words[idx]
    if (n > 0) kids.push(' ')
    const read = idx < R.i
    const isCur = idx === R.i
    if (isCur) {
      kids.push(Text({ color: '#1a1408', backgroundColor: hex(LIGHT), bold: true, children: [w.w] }))
    } else if (R.back > 0 && idx === R.i + 1) {
      kids.push(Text({ backgroundColor: hex(LIGHT_SOFT), children: [w.w] }))
    } else {
      const p = { children: [w.w] }
      if (w.code) p.color = theme === 'light' ? '#1d6fa5' : '#8fd3ff'
      if (w.b || w.head) p.bold = true
      if (read) p.dimColor = true
      kids.push(Text(p))
    }
  })
  return Text({ children: kids.length ? kids : [' '] })
}

function fmt(s) {
  s = Math.max(0, Math.round(s))
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}

function view(R, props, surface) {
  const { Box, Text } = surface.elements
  const lay = R.lay
  const width = Math.max(16, (surface.columns || 80) - 1)
  if (!lay || !lay.words.length) return Text({ children: [props.text || ''] })
  const theme = props.theme || 'dark'
  const cur = lay.words[R.i]
  const rows = []
  lay.lines.forEach((line, li) => {
    if (li === cur.line) rows.push(...encodeLane(laneRows(R, width, theme), Text, R.gutter))
    rows.push(textRow(R, line, li, Text, theme))
  })
  // the hint row
  const left = lay.words.slice(R.i).reduce((a, w) => a + duration(w, R.wpm), 0)
  let hint
  if (R.done) hint = '✓ read in ' + fmt(R.elapsed) + ' at ' + R.wpm + ' wpm · space again · q close'
  else if (R.away) hint = 'Pip is waiting for you · scroll down to keep reading'
  else if (!R.focused) hint = 'click Pip to steer · ' + R.wpm + ' wpm · ' + fmt(left) + ' left'
  else hint = (R.playing ? '' : 'paused · ') + '← → word · ↑ ↓ ' + R.wpm + ' wpm · space ' + (R.playing ? 'pause' : 'play') + ' · q close · ' + fmt(left) + ' left'
  rows.push(Text({ dimColor: true, children: [(R.gutter ? '  ' : '') + hint] }))
  return Box({ flexDirection: 'column', children: rows })
}
