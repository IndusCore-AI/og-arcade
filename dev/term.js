// A small stand-in for Claude Code's surface, so the arcade's own surface
// modules (the same files the mod loads) run in the page. It lays the cells
// a module returns onto a canvas the way a truecolor terminal draws them:
// "▀" paints its top half in the text colour and its bottom half in the
// background colour.

const KEYMAP = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', ' ': 'space', Enter: 'return', Backspace: 'backspace', Home: 'home' }

function flatten(node, style, out) {
  const st = { ...style }
  const p = node.props || {}
  if (p.color) st.fg = p.color
  if (p.backgroundColor) st.bg = p.backgroundColor
  if (p.bold) st.bold = true
  if (p.dimColor) st.dim = true
  for (const ch of p.children || []) {
    if (ch == null || ch === false) continue
    if (typeof ch === 'string' || typeof ch === 'number') out.push({ s: String(ch), ...st })
    else if (ch.type === 'Text') flatten(ch, st, out)
  }
  return out
}

function size(node) {
  if (!node) return { w: 0, h: 0 }
  if (node.type === 'Text') {
    const text = flatten(node, {}, []).map(s => s.s).join('')
    const lines = text.split('\n')
    return { w: Math.max(...lines.map(l => [...l].length)), h: lines.length }
  }
  if (node.type === 'Box') {
    const kids = (node.props.children || []).filter(Boolean)
    const col = node.props.flexDirection === 'column'
    let w = 0, h = 0
    for (const k of kids) {
      const m = size(k)
      if (col) { w = Math.max(w, m.w); h += m.h } else { w += m.w; h = Math.max(h, m.h) }
    }
    return { w, h }
  }
  return { w: 0, h: 1 }
}

function paint(node, x, y, grid, cols, rows) {
  if (!node) return
  if (node.type === 'Text') {
    let cx = x, cy = y
    for (const s of flatten(node, {}, [])) {
      for (const ch of s.s) {
        if (ch === '\n') { cy++; cx = x; continue }
        if (cy >= 0 && cy < rows && cx >= 0 && cx < cols) grid[cy][cx] = { ch, fg: s.fg, bg: s.bg, bold: s.bold, dim: s.dim }
        cx++
      }
    }
    return
  }
  if (node.type === 'Box') {
    const col = node.props.flexDirection === 'column'
    let cx = x, cy = y
    for (const k of (node.props.children || []).filter(Boolean)) {
      const m = size(k)
      paint(k, cx, cy, grid, cols, rows)
      if (col) cy += m.h
      else cx += m.w
    }
  }
}

const mk = type => props => ({ type, props: props || {} })
const ELEMENTS = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Markdown: mk('Markdown'), Code: mk('Code'), Link: mk('Link') }

export class Term {
  /**
   * canvas: the <canvas>; mod: the surface module's default export;
   * opts: { cols, rows, cell, fg, bg, onPost }
   */
  constructor(canvas, mod, opts = {}) {
    this.canvas = canvas
    this.mod = mod
    this.cols = opts.cols || 76
    this.rows = opts.rows || 26
    this.cw = opts.cell || 9
    this.ch = this.cw * 2
    this.fg = opts.fg || '#d9d6e6'
    this.bg = opts.bg || '#17121f'
    this.onPost = opts.onPost || (() => {})
    this.props = opts.props || {}
    this.autoRows = !!opts.autoRows
    this.timers = []
    this.running = true
    this.dirty = true
    this.mounted = true
    canvas.width = this.cols * this.cw
    canvas.height = this.rows * this.ch
    this.g = canvas.getContext('2d')
    this.reset()
    this.bindInput()
    this.raf = () => {
      if (this.dirty && this.mounted) this.render()
      requestAnimationFrame(this.raf)
    }
    requestAnimationFrame(this.raf)
  }

  reset() {
    for (const t of this.timers) clearInterval(t.id)
    this.timers = []
    this.state = undefined
    this.keyFn = null
    this.ptrFn = null
    const self = this
    this.surface = {
      elements: ELEMENTS,
      get state() { return self.state },
      setState(s) { self.state = s; self.dirty = true },
      get columns() { return self.cols },
      get rows() { return self.rows },
      every(ms, fn) {
        const t = { fn, ms }
        t.id = setInterval(() => { if (self.running && self.mounted) fn() }, ms)
        self.timers.push(t)
        return () => clearInterval(t.id)
      },
      onKey(fn) { self.keyFn = fn; return () => { self.keyFn = null } },
      onPointer(fn) { self.ptrFn = fn; return () => { self.ptrFn = null } },
      post(d) { self.onPost(d) },
    }
  }

  /** Remove the module (as Claude Code does while it asks for approval). */
  unmount() {
    this.mounted = false
    for (const t of this.timers) clearInterval(t.id)
    this.timers = []
  }

  /** Mount a fresh instance with new props. */
  mount(props) {
    this.props = props
    this.mounted = true
    this.reset()
    this.dirty = true
  }

  setProps(p) {
    this.props = { ...this.props, ...p }
    this.dirty = true
  }

  pause(on) {
    this.running = !on
  }

  bindInput() {
    const c = this.canvas
    c.addEventListener('keydown', e => {
      if (e.key === 'Escape') { c.blur(); return }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const key = KEYMAP[e.key] || (e.key.length === 1 ? e.key.toLowerCase() : null)
      if (!key || !this.keyFn || !this.mounted) return
      e.preventDefault()
      this.keyFn({ key })
    })
    const cell = e => {
      const r = c.getBoundingClientRect()
      return { x: Math.floor(((e.clientX - r.left) / r.width) * this.cols), y: Math.floor(((e.clientY - r.top) / r.height) * this.rows) }
    }
    c.addEventListener('pointerdown', e => {
      c.focus({ preventScroll: true })
      if (this.ptrFn && this.mounted) this.ptrFn({ type: 'down', button: 'left', ...cell(e) })
    })
  }

  render() {
    this.dirty = false
    let tree
    try {
      tree = this.mod(this.props, this.surface)
    } catch (err) {
      console.error(err)
      return
    }
    this.draw(tree)
  }

  draw(tree) {
    if (this.autoRows) {
      const need = Math.max(4, size(tree).h)
      if (need !== this.rows) {
        this.rows = need
        this.canvas.height = this.rows * this.ch
      }
    }
    const { cols, rows, cw, ch, g } = this
    const grid = Array.from({ length: rows }, () => new Array(cols).fill(null))
    paint(tree, 0, 0, grid, cols, rows)
    g.fillStyle = this.bg
    g.fillRect(0, 0, cols * cw, rows * ch)
    g.textBaseline = 'middle'
    const font = Math.round(cw * 1.6)
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const cell = grid[r][c]
        if (!cell) continue
        const X = c * cw, Y = r * ch
        const fg = cell.fg || this.fg
        const bg = cell.bg || this.bg
        if (cell.ch === '▀' || cell.ch === '▄') {
          const top = cell.ch === '▀' ? fg : bg
          const bot = cell.ch === '▀' ? bg : fg
          g.fillStyle = top
          g.fillRect(X, Y, cw, ch / 2)
          g.fillStyle = bot
          g.fillRect(X, Y + ch / 2, cw, ch / 2)
          continue
        }
        if (cell.bg) {
          g.fillStyle = bg
          g.fillRect(X, Y, cw, ch)
        }
        if (cell.ch !== ' ') {
          g.globalAlpha = cell.dim ? 0.55 : 1
          g.fillStyle = fg
          g.font = `${cell.bold ? '700 ' : '400 '}${font}px "JetBrains Mono", Menlo, ui-monospace, monospace`
          g.fillText(cell.ch, X, Y + ch / 2 + 1)
          g.globalAlpha = 1
        }
      }
  }

  /** Draw a static card in place of the module (the "Claude needs you" view). */
  drawCard(lines, sprite, pal) {
    const { cols, rows, cw, ch, g } = this
    g.fillStyle = this.bg
    g.fillRect(0, 0, cols * cw, rows * ch)
    const px = cw, py = ch / 2
    const ox = 3 * cw, oy = Math.round(rows * ch * 0.3)
    sprite.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const c = pal[row[i]]
        if (c === undefined) continue
        g.fillStyle = '#' + c.toString(16).padStart(6, '0')
        g.fillRect(ox + i * px, oy + j * py, px, py)
      }
    })
    g.textBaseline = 'middle'
    const font = Math.round(cw * 1.6)
    lines.forEach((l, i) => {
      g.font = `${l.bold ? '700 ' : '400 '}${font}px "JetBrains Mono", Menlo, monospace`
      g.fillStyle = l.color || this.fg
      g.globalAlpha = l.dim ? 0.6 : 1
      g.fillText(l.text, ox + 14 * cw, oy + ch * (i + 0.6))
      g.globalAlpha = 1
    })
  }
}
