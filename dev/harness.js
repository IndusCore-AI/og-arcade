// Dev harness: runs a Client surface module in the browser against a stand-in
// for Claude Code's surface, and draws the cells it returns onto a canvas the
// way a truecolor terminal would (▀ = top pixel colour over bottom colour).
//
// Query: ?m=<module path>&cols=76&rows=26&manual=1&theme=dark|light&cell=10
// window.H: setProps(obj), key(name), click(x, y), step(n), frame(), posts

const q = new URLSearchParams(location.search)
const COLS = Number(q.get('cols') || 76)
const ROWS = Number(q.get('rows') || 26)
const CW = Number(q.get('cell') || 10)
const CH = CW * 2
const MANUAL = q.get('manual') === '1'
const THEME = q.get('theme') === 'light' ? { fg: '#2b2b2b', bg: '#ffffff' } : { fg: '#d6d6d6', bg: '#1b1c22' }

const canvas = document.getElementById('screen')
canvas.width = COLS * CW
canvas.height = ROWS * CH
canvas.style.width = COLS * CW + 'px'
canvas.style.height = ROWS * CH + 'px'
const g = canvas.getContext('2d')

// ---------- elements stand-in ----------
const mk = type => props => ({ type, props: props || {} })
const elements = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Markdown: mk('Markdown'), Code: mk('Code'), Link: mk('Link') }

// ---------- layout: Box rows/columns of Text runs into a cell grid ----------
function flattenText(node, style, out) {
  const st = { ...style }
  const p = node.props
  if (p.color) st.fg = p.color
  if (p.backgroundColor) st.bg = p.backgroundColor
  if (p.bold) st.bold = true
  if (p.dimColor) st.dim = true
  if (p.inverse) st.inverse = true
  for (const ch of p.children || []) {
    if (ch == null || ch === false) continue
    if (typeof ch === 'string' || typeof ch === 'number') out.push({ s: String(ch), ...st })
    else if (ch.type === 'Text') flattenText(ch, st, out)
  }
  return out
}

function measure(node) {
  if (!node) return { w: 0, h: 0 }
  if (node.type === 'Text') {
    const segs = flattenText(node, {}, [])
    const lines = segs.map(s => s.s).join('').split('\n')
    return { w: Math.max(...lines.map(l => [...l].length)), h: lines.length }
  }
  if (node.type === 'Box') {
    const kids = (node.props.children || []).filter(Boolean)
    const dir = node.props.flexDirection || 'row'
    let w = 0, h = 0
    for (const k of kids) {
      const m = measure(k)
      if (dir === 'column') { w = Math.max(w, m.w); h += m.h }
      else { w += m.w; h = Math.max(h, m.h) }
    }
    if (node.props.height) h = node.props.height
    return { w, h }
  }
  if (node.type === 'Button') return { w: String(node.props.label || '').length + 4, h: 1 }
  return { w: 0, h: 1 }
}

function paint(node, x, y, grid) {
  if (!node) return
  if (node.type === 'Text') {
    const segs = flattenText(node, {}, [])
    let cx = x, cy = y
    for (const s of segs) {
      for (const ch of s.s) {
        if (ch === '\n') { cy++; cx = x; continue }
        if (cy >= 0 && cy < ROWS && cx >= 0 && cx < COLS) grid[cy][cx] = { ch, fg: s.fg, bg: s.bg, bold: s.bold, dim: s.dim }
        cx++
      }
    }
    return
  }
  if (node.type === 'Box') {
    const kids = (node.props.children || []).filter(Boolean)
    const dir = node.props.flexDirection || 'row'
    let cx = x, cy = y
    for (const k of kids) {
      const m = measure(k)
      paint(k, cx, cy, grid)
      if (dir === 'column') cy += m.h
      else cx += m.w
    }
  }
}

function draw(treeNode) {
  const grid = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => null))
  paint(treeNode, 0, 0, grid)
  g.fillStyle = THEME.bg
  g.fillRect(0, 0, canvas.width, canvas.height)
  g.textBaseline = 'middle'
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const cell = grid[r][c]
      if (!cell) continue
      const bg = cell.bg || THEME.bg
      let fg = cell.fg || THEME.fg
      const X = c * CW, Y = r * CH
      if (cell.ch === '▀') {
        g.fillStyle = fg; g.fillRect(X, Y, CW, CH / 2)
        g.fillStyle = bg; g.fillRect(X, Y + CH / 2, CW, CH / 2)
        continue
      }
      if (cell.ch === '▄') {
        g.fillStyle = bg; g.fillRect(X, Y, CW, CH / 2)
        g.fillStyle = fg; g.fillRect(X, Y + CH / 2, CW, CH / 2)
        continue
      }
      if (cell.bg) { g.fillStyle = bg; g.fillRect(X, Y, CW, CH) }
      if (cell.ch !== ' ') {
        g.globalAlpha = cell.dim ? 0.55 : 1
        g.fillStyle = fg
        g.font = `${cell.bold ? 'bold ' : ''}${Math.round(CW * 1.62)}px Menlo, "SF Mono", ui-monospace, monospace`
        g.fillText(cell.ch, X, Y + CH / 2 + 1)
        g.globalAlpha = 1
      }
    }
}

// ---------- surface stand-in ----------
const timers = []
let keyFn = null, ptrFn = null
let state
let props = JSON.parse(q.get('props') || '{}')
let dirty = true
const posts = []
const surface = {
  elements,
  get state() { return state },
  setState(s) { state = s; dirty = true },
  columns: COLS,
  rows: ROWS,
  every(ms, fn) {
    const t = { ms, fn, acc: 0, live: true }
    timers.push(t)
    if (!MANUAL) t.id = setInterval(() => t.live && fn(), ms)
    return () => { t.live = false; clearInterval(t.id) }
  },
  onKey(fn) { keyFn = fn; return () => { keyFn = null } },
  onPointer(fn) { ptrFn = fn; return () => { ptrFn = null } },
  post(d) { posts.push(d); if (window.onPost) window.onPost(d) },
}

const mod = await import(q.get('m') || '../client/arcade.js')
const Component = mod.default

function render() {
  dirty = false
  try {
    draw(Component(props, surface))
  } catch (e) {
    console.error(e)
    document.getElementById('err').textContent = String(e && e.stack || e)
  }
}

function loop() {
  if (dirty) render()
  requestAnimationFrame(loop)
}
render()
if (!MANUAL) loop()

const KEYMAP = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', ' ': 'space', Enter: 'return', Backspace: 'backspace', Tab: 'tab' }
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' || e.metaKey) return
  const key = KEYMAP[e.key] || (e.key.length === 1 ? e.key : null)
  if (!key || !keyFn) return
  e.preventDefault()
  keyFn({ key, ...(e.shiftKey ? { shift: true } : {}), ...(e.ctrlKey ? { ctrl: true } : {}) })
})
const cellAt = e => {
  const r = canvas.getBoundingClientRect()
  return { x: Math.floor((e.clientX - r.left) / CW), y: Math.floor((e.clientY - r.top) / CH) }
}
canvas.addEventListener('mousedown', e => ptrFn && ptrFn({ type: 'down', button: 'left', ...cellAt(e) }))
canvas.addEventListener('mouseup', e => ptrFn && ptrFn({ type: 'up', button: 'left', ...cellAt(e) }))
canvas.addEventListener('mousemove', e => ptrFn && ptrFn({ type: 'move', ...cellAt(e) }))

window.H = {
  setProps(p) { props = { ...props, ...p }; render() },
  key(k) { keyFn && keyFn({ key: k }); render() },
  click(x, y) { ptrFn && ptrFn({ type: 'down', button: 'left', x, y }); ptrFn && ptrFn({ type: 'up', button: 'left', x, y }); render() },
  step(n = 1) {
    for (let i = 0; i < n; i++)
      for (const t of timers) if (t.live) t.fn()
    render()
  },
  posts,
  get state() { return state },
}
document.title = 'ready'
