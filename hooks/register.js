// Pip, a little blue penguin who keeps you company while Claude works.
//
// /pip opens Pip's Arcade in a pane: three small games, drawn by a surface
// module (../client/arcade.js) with its own 30 fps clock and keyboard. When
// Claude needs an answer, the game leaves the pane at once, so the keyboard
// goes back to the question, and its saved round comes back afterwards.
//
// When Claude is done, Pip can read the answer with you: the reader
// (../client/reader.js) is drawn over Claude's own reply in the transcript,
// walking word by word and lighting the words under its feet.

const PANE = 'pip'
const READ_MIN_WORDS = 45
const OFFER_AFTER_MS = 15000

const S = {
  claude: { state: 'idle', label: '', since: 0 },
  needs: false,
  turnId: null,
  open: false,
  boot: null,
  bootSeq: 0,
  resume: null,
  code: { seq: 0, n: 0, lines: [] },
  answer: '',
  answerWords: 0,
  reading: null,
  readSeq: 0,
  offer: null,
  offerTimer: null,
  best: { runner: 0, rocket: 0, claw: 0 },
  cfg: { sound: true, offers: true, reduceMotion: false, wpm: 260 },
  theme: 'dark',
  fullscreen: null,
  input: { seq: 0, key: '' },
  lastSound: 0,
}

// ---------- helpers ----------

function base(path) {
  const s = String(path || '')
  const i = s.lastIndexOf('/')
  return i >= 0 ? s.slice(i + 1) : s
}

function labelFor(e) {
  const t = e.tool
  if (t === 'Write' || t === 'Edit' || t === 'MultiEdit' || t === 'NotebookEdit') return 'writing ' + base(e.file_path || e.notebook_path)
  if (t === 'Read') return 'reading ' + base(e.file_path)
  if (t === 'Bash') return 'running ' + String(e.command || '').trim().split(/\s+/).slice(0, 2).join(' ')
  if (t === 'Grep' || t === 'Glob') return 'searching the code'
  if (t === 'WebFetch' || t === 'WebSearch') return 'reading the web'
  if (t === 'Task' || t === 'Agent') return 'working with a helper'
  if (t === 'TodoWrite') return 'making a plan'
  return 'using ' + t
}

function codeOf(e) {
  const t = e.tool
  if (t === 'Write') return String(e.content || '')
  if (t === 'Edit') return String(e.new_string || '')
  if (t === 'MultiEdit' && Array.isArray(e.edits)) return e.edits.map(x => String(x.new_string || '')).join('\n')
  if (t === 'NotebookEdit') return String(e.new_source || '')
  return ''
}

function addCode(text, file) {
  const lines = text.split('\n').slice(0, 160)
  for (const t of lines) {
    S.code.lines.push({ n: S.code.n++, t: t.slice(0, 120), f: file })
  }
  if (S.code.lines.length > 220) S.code.lines.splice(0, S.code.lines.length - 220)
  S.code.seq++
}

function words(s) {
  return String(s || '').split(/\s+/).filter(Boolean).length
}

const SOUNDS = new Set(['tick', 'grab', 'thud', 'coin', 'jackpot', 'boom', 'bonus', 'clear', 'over', 'hit', 'pop', 'hurt', 'warn', 'jump', 'start', 'needs', 'done'])

async function play($, name, gain) {
  if (!S.cfg.sound || !SOUNDS.has(name)) return
  const now = Date.now()
  if (now - S.lastSound < 60) return
  S.lastSound = now
  try {
    await $.audio.play({ asset: 'sfx/' + name + '.wav' }, { gain: gain ?? 0.45 })
  } catch (err) {
    $.ui.log('linewalker: sound ' + name + ' did not play: ' + err, { to: 'debug' })
  }
}

async function saveCfg($) {
  await $.store.set('cfg', S.cfg)
}

async function openPane($, game) {
  S.boot = { game: game || null, seq: ++S.bootSeq }
  S.offer = null
  const r = await $.ui.open({ id: PANE, title: "Pip's Arcade", focus: true, closeOnEscape: true, rows: 26, columns: 76 })
  S.open = true
  $.ui.invalidate('ui.render')
  return r
}

async function startReading($) {
  if (!S.answer) {
    $.ui.toast('Pip has nothing to read yet. Ask Claude something first.')
    return false
  }
  S.offer = null
  S.reading = { seq: ++S.readSeq, mode: S.fullscreen === false ? 'pane' : 'transcript', rid: null, scrolled: false }
  if (S.reading.mode === 'pane') {
    await $.ui.open({ id: PANE, title: 'Read with Pip', focus: true, closeOnEscape: true, rows: 22, columns: 76 })
    S.open = true
  }
  $.ui.invalidate('ui.render')
  return true
}

function needsYou($) {
  if (S.needs) return
  S.needs = true
  S.claude = { ...S.claude, state: 'needs' }
  $.ui.invalidate('ui.render')
}

function movedOn($) {
  if (!S.needs) return
  S.needs = false
  S.claude = { ...S.claude, state: 'working' }
  $.ui.invalidate('ui.render')
}

// Pip pointing down, for the card shown while Claude waits on you
const POINT = [
  '...BBBB.....',
  '..BHBBBB....',
  '.BHWWWWBB...',
  '.BWKWWKWB...',
  '.BWWOOWWB...',
  '.BPWWWWPB...',
  'DBBWWWWBBD..',
  'DBBWWWWBB.D.',
  '.DBWWWWBD..D',
  '..BBWWBB....',
  '..FF..FF....',
  '............',
]
const PAL = { B: 0x3b5dc9, H: 0x5f86ec, D: 0x29366f, W: 0xfff1e8, K: 0x111d35, O: 0xffa300, F: 0xff6c24, P: 0xff77a8 }

function hex6(c) {
  return '#' + (c | 0x1000000).toString(16).slice(1)
}

/** Sprite rows as half-block runs; transparent pixels keep the terminal's own background. */
function spriteRows(rows) {
  const out = []
  for (let y = 0; y < rows.length; y += 2) {
    const runs = []
    for (let x = 0; x < rows[0].length; x++) {
      const a = PAL[(rows[y] || '')[x]]
      const b = PAL[(rows[y + 1] || '')[x]]
      let s = ' ', fg, bg
      if (a !== undefined && b === undefined) { s = '▀'; fg = a }
      else if (a === undefined && b !== undefined) { s = '▄'; fg = b }
      else if (a !== undefined) { s = '▀'; fg = a; bg = b }
      const last = runs[runs.length - 1]
      if (last && last.fg === fg && last.bg === bg) last.s += s
      else runs.push({ s, fg, bg })
    }
    out.push(runs)
  }
  return out
}
const POINT_ROWS = spriteRows(POINT)

// ---------- register ----------

export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'pip',
      description: "Pip's Arcade: small games while Claude works, and a reading guide for the answer",
      argumentHint: '[runner | rocket | claw | read | off | on | sound]',
      immediate: true,
    })
    const best = await $.store.get('best')
    if (best && typeof best === 'object') S.best = { ...S.best, ...best }
    const cfg = await $.store.get('cfg')
    if (cfg && typeof cfg === 'object') S.cfg = { ...S.cfg, ...cfg }
    try {
      const st = await $.settings.read()
      if (st && typeof st.theme === 'string') S.theme = st.theme.includes('light') ? 'light' : 'dark'
    } catch {}
    return next(e)
  })

  on('command.run', { command: 'pip' }, async ($, e) => {
    const arg = String(e.args || '').trim().toLowerCase()
    if (arg === 'off') {
      S.cfg.offers = false
      S.offer = null
      await saveCfg($)
      $.ui.invalidate('ui.render')
      return { text: "Pip won't offer games or reading any more. /pip still opens the arcade, and /pip on brings the offers back." }
    }
    if (arg === 'on') {
      S.cfg.offers = true
      await saveCfg($)
      return { text: 'Pip will offer a game after Claude has worked for 15 seconds, and offer to read long answers.' }
    }
    if (arg.startsWith('sound')) {
      S.cfg.sound = arg.endsWith('off') ? false : arg.endsWith('on') ? true : !S.cfg.sound
      await saveCfg($)
      $.ui.invalidate('ui.render')
      return { text: 'Sound is ' + (S.cfg.sound ? 'on.' : 'off.') }
    }
    if (arg === 'calm' || arg === 'motion') {
      S.cfg.reduceMotion = !S.cfg.reduceMotion
      await saveCfg($)
      return { text: S.cfg.reduceMotion ? 'Calm mode on: no screen shake or flashes.' : 'Calm mode off.' }
    }
    if (arg === 'read') {
      const ok = await startReading($)
      return ok ? {} : { text: 'Nothing to read yet.' }
    }
    if (arg === 'help') {
      return { text: "/pip opens the arcade · /pip runner|rocket|claw starts a game · /pip read reads Claude's last answer · /pip off|on turns the offers off or on · /pip sound toggles sound · /pip calm turns off shake and flashes" }
    }
    const game = ['runner', 'rocket', 'claw'].includes(arg) ? arg : null
    const r = await openPane($, game)
    if (r && r.isPlaced === false) return { text: "The arcade needs a wider terminal: " + (r.reason || 'there is no room') }
    return {}
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId) return next(e)
    S.claude = { state: 'working', label: 'thinking', since: Date.now() }
    S.needs = false
    S.turnId = e.turnId
    if (S.reading) S.reading = null
    S.offer = null
    S.offerTimer?.cancel?.()
    const turn = e.turnId
    S.offerTimer = $.clock.after(OFFER_AFTER_MS, () => {
      if (S.turnId === turn && S.claude.state === 'working' && !S.open && S.cfg.offers) {
        S.offer = 'play'
        $.ui.invalidate('ui.render')
      }
    })
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (!S.needs && S.claude.state !== 'done') S.claude = { ...S.claude, state: 'working', label: labelFor(e) }
    const code = codeOf(e)
    if (code) addCode(code, base(e.file_path || e.notebook_path))
    if (e.tool === 'AskUserQuestion') needsYou($)
    $.ui.invalidate('ui.render')
    const result = await next(e)
    movedOn($)
    return result
  }).catch(async ($, e, next) => next(e))

  on('tool.check', async ($, e, next) => {
    const result = await next(e)
    // In auto mode an ask may go to the classifier; stepping aside anyway costs a moment
    if (e.tool_use_id && result && result.decision === 'ask') {
      needsYou($)
      if (S.open) void play($, 'needs', 0.5)
    }
    return result
  }).catch(async ($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) return next(e)
    S.needs = false
    S.claude = { state: 'done', label: '', since: S.claude.since, at: Date.now() }
    S.offerTimer?.cancel?.()
    if (typeof e.answer === 'string' && e.answer.trim()) {
      S.answer = e.answer
      S.answerWords = words(e.answer)
    }
    S.offer = S.cfg.offers && S.answerWords >= READ_MIN_WORDS && !e.isAborted ? 'read' : null
    if (S.open) void play($, 'done', 0.5)
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('ui.message', async ($, e, next) => {
    const d = e.data
    if (!d || typeof d !== 'object') return next(e)
    if (d.save) S.resume = d.save.world ? { game: d.save.game, world: d.save.world } : null
    if (d.score && typeof d.score.score === 'number') {
      const g = d.score.game
      if (g in S.best && d.score.score > S.best[g]) {
        S.best = { ...S.best, [g]: Math.floor(d.score.score) }
        await $.store.set('best', S.best)
      }
    }
    if (Array.isArray(d.sfx)) for (const s of d.sfx.slice(0, 2)) void play($, s)
    if (d.cfg && typeof d.cfg === 'object') {
      S.cfg = { ...S.cfg, ...d.cfg }
      await saveCfg($)
      $.ui.invalidate('ui.render')
    }
    if (d.read) {
      // reading starts from the arcade: close it, so the answer has your attention
      const fromArcade = e.element === 'arcade'
      const ok = await startReading($)
      if (ok && fromArcade && S.reading && S.reading.mode === 'transcript') await $.ui.close({ id: PANE })
    }
    if (d.readDone) {
      const wasPane = S.reading && S.reading.mode === 'pane'
      S.reading = null
      if (typeof d.wpm === 'number') { S.cfg.wpm = d.wpm; await saveCfg($) }
      if (wasPane) await $.ui.close({ id: PANE })
      $.ui.invalidate('ui.render')
    }
    if (d.close) await $.ui.close({ id: PANE })
    return {}
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      S.open = false
      S.boot = null
      if (S.reading && S.reading.mode === 'pane') S.reading = null
    }
    return next(e)
  }).catch(async ($, e, next) => next(e))

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    if (e.viewport) S.fullscreen = !!e.viewport.isFullscreen
    const { Box, Text, Client, Button } = $.ui.resolve(e)
    if (e.surface !== 'terminal') {
      return Text({ children: ["Pip's Arcade draws in the terminal. Run claude in a terminal to play."] })
    }
    const cols = Math.max(20, e.props.bodyColumns || 76)
    const rows = e.props.placement === 'dock' && e.props.scroll && e.props.scroll.bodyRows ? Math.max(12, Math.min(44, e.props.scroll.bodyRows - (S.fullscreen ? 0 : 1))) : 24

    if (S.reading && S.reading.mode === 'pane') {
      return Client({
        key: 'reader-pane',
        module: '../client/reader.js',
        props: { text: S.answer, wpm: S.cfg.wpm, theme: S.theme, seq: S.reading.seq, pane: true, reduceMotion: S.cfg.reduceMotion },
        width: cols,
      })
    }

    if (S.needs) {
      // The game steps out so the keys reach the question; its round is saved
      return Box({
        flexDirection: 'row',
        columnGap: 2,
        children: [
          Box({
            flexDirection: 'column',
            children: POINT_ROWS.map(runs =>
              Text({ children: runs.map(r => (r.fg === undefined && r.bg === undefined ? r.s : Text({ color: hex6(r.fg), ...(r.bg !== undefined ? { backgroundColor: hex6(r.bg) } : {}), children: [r.s] }))) }),
            ),
          }),
          Box({
            flexDirection: 'column',
            children: [
              Text({ bold: true, color: '#ffcd75', children: ['Claude needs you'] }),
              Text({ children: ['Answer the question below. Pip saved your game.'] }),
              Text({ dimColor: true, children: ['It comes back as soon as Claude moves on.'] }),
            ],
          }),
        ],
      })
    }

    const props = {
      claude: S.claude,
      best: S.best,
      resume: S.resume,
      boot: S.boot,
      code: { seq: S.code.seq, lines: S.code.lines.slice(-120) },
      input: S.input,
      cfg: { sound: S.cfg.sound, reduceMotion: S.cfg.reduceMotion },
      classic: S.fullscreen === false,
    }
    const game = Client({ key: 'arcade', module: '../client/arcade.js', props, width: cols, height: rows })
    if (S.fullscreen !== false) return game
    // Classic renderer: no clicks reach the game, so these keys drive it
    const key = (k, label) =>
      Button({
        key: 'k-' + k,
        label,
        hotkey: k,
        plain: true,
        onPress: () => {
          S.input = { seq: S.input.seq + 1, key: k === 'j' ? 'space' : k }
          $.ui.invalidate('ui.render')
        },
      })
    return Box({
      flexDirection: 'column',
      children: [
        game,
        Box({ flexDirection: 'row', columnGap: 2, children: [key('a', '◀'), key('d', '▶'), key('w', '▲'), key('s', '▼'), key('j', 'go'), key('x', 'alt'), key('p', 'pause'), key('q', 'menu'), key('1', 'runner'), key('2', 'rocket'), key('3', 'claw'), key('4', 'read')] }),
      ],
    })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!S.offer || S.open || S.needs) return next(e)
    if (S.offer === 'play' && S.claude.state !== 'working') return next(e)
    if (S.offer === 'read' && (S.claude.state !== 'done' || S.reading)) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const others = await next(e)
    const line =
      S.offer === 'play'
        ? Box({
            flexDirection: 'row',
            columnGap: 1,
            children: [
              Button({ key: 'pip-play', label: 'play with Pip while Claude works', hotkey: '1', plain: true, onPress: () => openPane($, null) }),
              Text({ dimColor: true, children: ['· the game pauses when Claude needs you · /pip off hides this'] }),
            ],
          })
        : Box({
            flexDirection: 'row',
            columnGap: 1,
            children: [
              Button({ key: 'pip-read', label: 'read the answer with Pip', hotkey: '2', plain: true, onPress: () => startReading($) }),
              Text({ dimColor: true, children: ['· ' + S.answerWords + ' words, about ' + Math.max(1, Math.round(S.answerWords / S.cfg.wpm)) + ' min'] }),
            ],
          })
    return Box({ flexDirection: 'column', children: others ? [line, others] : [line] })
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.viewport) S.fullscreen = !!e.viewport.isFullscreen
    const r = S.reading
    if (!r || r.mode !== 'transcript') return next(e)
    const text = String(e.props.text || '').trim()
    const ans = S.answer.trim()
    if (!text || !(text === ans || (text.length > 40 && ans.endsWith(text)))) return next(e)
    if (r.rid && r.rid !== e.requestId) return next(e)
    if (!r.rid) r.rid = e.requestId
    if (!r.scrolled) {
      r.scrolled = true
      void $.ui.scroll({ to: { requestId: e.requestId }, block: 'start' }).catch(() => {})
    }
    const { Client } = $.ui.resolve(e)
    return Client({
      key: 'reader-' + r.seq,
      module: '../client/reader.js',
      props: { text: e.props.text, wpm: S.cfg.wpm, theme: S.theme, seq: r.seq, onScreen: e.props.onScreen || null, reduceMotion: S.cfg.reduceMotion },
      width: '100%',
    })
  })
}
