// A small pixel canvas for terminal cells.
//
// Pixels: each terminal cell shows two of them, stacked, as a "▀" glyph whose
// foreground is the top pixel and background the bottom one. On screen that
// makes pixels roughly square.
// Text: a second layer of real characters, one per cell, for anything people
// read (scores, hints, code). Text sits on top of the pixels under it.
//
// encode() turns both layers into rows of runs, merging cells that share
// colours, so a frame stays a few hundred elements.

// ---------- colour ----------

export function rgb(r, g, b) {
  return ((r & 255) << 16) | ((g & 255) << 8) | (b & 255)
}

export function mix(a, b, t) {
  if (t <= 0) return a
  if (t >= 1) return b
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255
  return rgb(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t)
}

/** Lighter (t > 0, towards white) or darker (t < 0, towards black). */
export function shade(c, t) {
  return t >= 0 ? mix(c, 0xffffff, t) : mix(c, 0x000000, -t)
}

const HEX = new Map()
export function hex(c) {
  let s = HEX.get(c)
  if (!s) {
    s = '#' + (c | 0x1000000).toString(16).slice(1)
    HEX.set(c, s)
  }
  return s
}

// ---------- canvas ----------

export class Canvas {
  constructor(w, h, bg = 0) {
    this.w = Math.max(1, w | 0)
    this.h = Math.max(2, (h | 0) + ((h | 0) % 2))
    this.cols = this.w
    this.rows = this.h / 2
    this.px = new Int32Array(this.w * this.h).fill(bg)
    // Text layer, one slot per cell: null or { ch, fg, bg, bold }
    this.txt = new Array(this.cols * this.rows).fill(null)
    // Camera shake offset, applied by encode()
    this.ox = 0
    this.oy = 0
  }

  clear(c) {
    this.px.fill(c)
    this.txt.fill(null)
  }

  get(x, y) {
    x |= 0
    y |= 0
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return -1
    return this.px[y * this.w + x]
  }

  set(x, y, c) {
    x = Math.floor(x)
    y = Math.floor(y)
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || !(c >= 0)) return
    this.px[y * this.w + x] = c
  }

  /** Blend c over the pixel at (x, y) by t (0..1). */
  tint(x, y, c, t) {
    x = Math.floor(x)
    y = Math.floor(y)
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    const i = y * this.w + x
    this.px[i] = mix(this.px[i], c, t)
  }

  rect(x, y, w, h, c) {
    if (c === undefined || c < 0) return
    const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y))
    const x1 = Math.min(this.w, Math.floor(x + w)), y1 = Math.min(this.h, Math.floor(y + h))
    for (let yy = y0; yy < y1; yy++) this.px.fill(c, yy * this.w + x0, yy * this.w + x1)
  }

  /** Vertical gradient from top colour to bottom colour, in `steps` bands. */
  vgrad(x, y, w, h, top, bottom, steps = 0) {
    for (let i = 0; i < h; i++) {
      let t = h <= 1 ? 0 : i / (h - 1)
      if (steps > 1) t = Math.round(t * (steps - 1)) / (steps - 1)
      this.rect(x, y + i, w, 1, mix(top, bottom, t))
    }
  }

  /** Darken (or tint) the whole pixel layer, for pauses and flashes. */
  wash(c, t) {
    for (let i = 0; i < this.px.length; i++) this.px[i] = mix(this.px[i], c, t)
  }

  line(x0, y0, x1, y1, c) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1)
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0)
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1
    let err = dx + dy
    for (let n = 0; n < 2000; n++) {
      this.set(x0, y0, c)
      if (x0 === x1 && y0 === y1) break
      const e2 = 2 * err
      if (e2 >= dy) { err += dy; x0 += sx }
      if (e2 <= dx) { err += dx; y0 += sy }
    }
  }

  disc(cx, cy, r, c) {
    const r2 = r * r
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy
        if (dx * dx + dy * dy <= r2) this.set(x, y, c)
      }
  }

  ring(cx, cy, r, c, thick = 1) {
    const ro = r * r, ri = Math.max(0, r - thick) ** 2
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy
        const d = dx * dx + dy * dy
        if (d <= ro && d >= ri) this.set(x, y, c)
      }
  }

  /**
   * Draws a sprite: rows of palette letters, '.' transparent, top-left at (x, y).
   * flip mirrors it left to right.
   */
  sprite(rows, pal, x, y, flip = false) {
    x = Math.round(x)
    y = Math.round(y)
    for (let j = 0; j < rows.length; j++) {
      const row = rows[j]
      const n = row.length
      for (let i = 0; i < n; i++) {
        const ch = flip ? row[n - 1 - i] : row[i]
        if (ch === '.' || ch === ' ') continue
        const c = pal[ch]
        if (c !== undefined) this.set(x + i, y + j, c)
      }
    }
  }

  /** The same sprite as one flat colour, for hit flashes and shadows. */
  silhouette(rows, x, y, c, flip = false) {
    x = Math.round(x)
    y = Math.round(y)
    for (let j = 0; j < rows.length; j++) {
      const row = rows[j]
      const n = row.length
      for (let i = 0; i < n; i++) {
        const ch = flip ? row[n - 1 - i] : row[i]
        if (ch !== '.' && ch !== ' ') this.set(x + i, y + j, c)
      }
    }
  }

  // ---------- text layer (cells) ----------

  /**
   * Writes text at a cell (col, row). bg defaults to the pixels underneath.
   * Returns the column after the text.
   */
  text(col, row, str, fg, bg, bold = false) {
    col = Math.round(col)
    row = Math.round(row)
    if (row < 0 || row >= this.rows) return col
    let c = col
    for (const ch of str) {
      if (c >= 0 && c < this.cols) this.txt[row * this.cols + c] = { ch, fg, bg, bold }
      c++
    }
    return c
  }

  textCenter(row, str, fg, bg, bold = false) {
    const n = [...str].length
    return this.text(Math.floor((this.cols - n) / 2), row, str, fg, bg, bold)
  }

  /** Paints a cell-aligned box of pixels (both pixel rows of each cell). */
  cellRect(col, row, w, h, c) {
    this.rect(col, row * 2, w, h * 2, c)
  }
}

// ---------- encode ----------

/**
 * Rows of runs: [{ s, fg, bg, b }], with fg/bg as '#rrggbb' (fg may be null).
 * Cells whose two pixels match become spaces, which merge with neighbours.
 */
export function encode(cv) {
  const out = []
  const { w, px, txt, cols, rows } = cv
  const ox = Math.round(cv.ox) | 0
  const oy = Math.round(cv.oy) | 0
  const H = cv.h
  const at = (x, y) => {
    x -= ox
    y -= oy
    if (x < 0) x = 0
    else if (x >= w) x = w - 1
    if (y < 0) y = 0
    else if (y >= H) y = H - 1
    return px[y * w + x]
  }
  for (let r = 0; r < rows; r++) {
    const line = []
    let run = null
    for (let c = 0; c < cols; c++) {
      const top = at(c, r * 2)
      const bot = at(c, r * 2 + 1)
      const t = txt[r * cols + c]
      let ch, fg, bg, b = false
      if (t) {
        ch = t.ch
        fg = t.fg
        bg = t.bg === undefined || t.bg === null ? top : t.bg
        b = !!t.bold
        if (ch === ' ') fg = -1
      } else if (top === bot) {
        ch = ' '
        fg = -1
        bg = top
      } else {
        ch = '▀'
        fg = top
        bg = bot
      }
      // A space takes any foreground, so it joins the run it follows
      if (run && run.bg === bg && run.b === b && (fg === -1 || run.fg === fg || run.fg === -1)) {
        if (run.fg === -1 && fg !== -1) run.fg = fg
        run.s += ch
      } else {
        run = { s: ch, fg, bg, b }
        line.push(run)
      }
    }
    // Trailing spaces get trimmed by the renderer, so the row's end is drawn
    // with solid half blocks instead (foreground = background)
    const last = line[line.length - 1]
    if (last) {
      const m = /( +)$/.exec(last.s)
      if (m) {
        const n = m[1].length
        if (n === last.s.length) {
          last.s = '▀'.repeat(n)
          last.fg = last.bg
        } else {
          last.s = last.s.slice(0, -n)
          line.push({ s: '▀'.repeat(n), fg: last.bg, bg: last.bg, b: false })
        }
      }
    }
    out.push(line)
  }
  return out
}

/** Builds the element tree for encoded rows with the surface's Box and Text. */
export function tree(el, lines, extra) {
  const { Box, Text } = el
  const rows = lines.map(line =>
    Box({
      flexDirection: 'row',
      children: line.map(r => {
        const p = { backgroundColor: hex(r.bg), children: [r.s] }
        if (r.fg !== -1) p.color = hex(r.fg)
        if (r.b) p.bold = true
        return Text(p)
      }),
    }),
  )
  if (extra) rows.push(...extra)
  return Box({ flexDirection: 'column', children: rows })
}

// ---------- tiny pixel font (3x5) for big numbers and titles in the field ----------

const F3 = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001011001111',
  '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001010010010',
  '8': '111101111101111', '9': '111101111001111', '+': '000010111010000', '-': '000000111000000',
  '$': '011110010011110', '!': '010010010000010', '?': '111001011000010', ':': '000010000010000',
  '.': '000000000000010', ' ': '000000000000000', '/': '001001010100100', 'x': '000101010101000',
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
  E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
  I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100',
  Q: '010101101110011', R: '110101110101101', S: '011100111001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111',
}

/** Width in pixels of a 3x5 string (3 per glyph plus 1 gap). */
export function font3Width(s, scale = 1) {
  return Math.max(0, s.length * 4 - 1) * scale
}

/** Draws a 3x5 string; returns its width. */
export function font3(cv, s, x, y, c, scale = 1, shadow = -1, alpha = 1) {
  s = String(s).toUpperCase()
  let cx = Math.round(x)
  y = Math.round(y)
  const put = (px, py, col) => {
    if (alpha >= 1) cv.rect(px, py, scale, scale, col)
    else for (let a = 0; a < scale; a++) for (let b = 0; b < scale; b++) cv.tint(px + a, py + b, col, alpha)
  }
  if (shadow >= 0)
    for (const ch of s) {
      const g = F3[ch]
      if (g) for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (g[j * 3 + i] === '1') put(cx + i * scale + scale, y + j * scale + scale, shadow)
      cx += 4 * scale
    }
  cx = Math.round(x)
  for (const ch of s) {
    const g = F3[ch]
    if (g) for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (g[j * 3 + i] === '1') put(cx + i * scale, y + j * scale, c)
    cx += 4 * scale
  }
  return cx - Math.round(x) - scale
}

/** Copies src (pixels and text, with its shake offset) into dst at cell (col, row). */
export function blit(dst, src, col, row) {
  const ox = Math.round(src.ox) | 0, oy = Math.round(src.oy) | 0
  const y0 = row * 2
  for (let y = 0; y < src.h; y++) {
    const dy = y0 + y
    if (dy < 0 || dy >= dst.h) continue
    let sy = y - oy
    if (sy < 0) sy = 0
    else if (sy >= src.h) sy = src.h - 1
    for (let x = 0; x < src.w; x++) {
      const dx = col + x
      if (dx < 0 || dx >= dst.w) continue
      let sx = x - ox
      if (sx < 0) sx = 0
      else if (sx >= src.w) sx = src.w - 1
      dst.px[dy * dst.w + dx] = src.px[sy * src.w + sx]
    }
  }
  for (let r = 0; r < src.rows; r++) {
    const dr = row + r
    if (dr < 0 || dr >= dst.rows) continue
    for (let c = 0; c < src.cols; c++) {
      const t = src.txt[r * src.cols + c]
      const dc = col + c
      if (t && dc >= 0 && dc < dst.cols) dst.txt[dr * dst.cols + dc] = t
    }
  }
}

// ---------- 5x7 pixel font for titles ----------

const F5 = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  J: ['..###', '...#.', '...#.', '...#.', '#..#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
  "'": ['..#..', '..#..', '.#...', '.....', '.....', '.....', '.....'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  '$': ['..#..', '.####', '#.#..', '.###.', '..#.#', '####.', '..#..'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  ':': ['.....', '..#..', '..#..', '.....', '..#..', '..#..', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
}

export function font5Width(s) {
  s = String(s).toUpperCase()
  let w = 0
  for (const ch of s) w += ch === ' ' ? 4 : ch === "'" || ch === '!' || ch === '.' || ch === ':' ? 4 : 6
  return Math.max(0, w - 1)
}

/** 5x7 title text with an optional drop shadow and a two-tone fill (top rows lighter). */
export function font5(cv, s, x, y, c, shadow = -1, top = -1) {
  s = String(s).toUpperCase()
  x = Math.round(x)
  y = Math.round(y)
  const pass = (dx, dy, col, isShadow) => {
    let cx = x
    for (const ch of s) {
      const g = F5[ch]
      const adv = ch === ' ' ? 4 : ch === "'" || ch === '!' || ch === '.' || ch === ':' ? 4 : 6
      const shift = ch === "'" || ch === '!' || ch === '.' || ch === ':' ? -1 : 0
      if (g)
        for (let j = 0; j < 7; j++)
          for (let i = 0; i < 5; i++)
            if (g[j][i] === '#') cv.set(cx + i + dx + shift, y + j + dy, isShadow ? col : top >= 0 && j < 3 ? top : col)
      cx += adv
    }
  }
  if (shadow >= 0) {
    pass(1, 1, shadow, true)
    pass(0, 1, shadow, true)
  }
  pass(0, 0, c, false)
}
