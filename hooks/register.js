// OG's Arcade: four classic games for while Claude works, hosted by Pip, a
// little blue penguin, with a weekly board on GitHub.
//
// /og opens the arcade in a pane, drawn by a surface module
// (../client/arcade.js) with its own 30 fps clock and keyboard. When Claude
// needs an answer, the game leaves the pane at once, so the keyboard goes back
// to the question, and its saved run comes back afterwards.
//
// The weekly board: everyone plays the same levels each week. A player's best
// run per game is kept here; posting it opens a GitHub issue on the arcade's
// repo with the run's keys. A GitHub Action replays the keys with the same game
// code, and only a score that replays exactly goes on the board.

import { GAMES, ORDER, weekOf, invalid } from '../client/sim.js'

const PANE = 'og'
const OFFER_AFTER_MS = 15000
const REPO = 'IndusCore-AI/og-arcade'
const BOARD_URL = 'https://raw.githubusercontent.com/' + REPO + '/main/board/current.json'
const BOARD_EVERY_MS = 3 * 60 * 1000
const MARKER = '<!-- og-arcade run -->'
const EMOJI = { snake: '🐍', brick: '🧱', rocket: '🚀', claw: '💰' }

const S = {
  claude: { state: 'idle', label: '', since: 0 },
  needs: false,
  turnId: null,
  open: false,
  boot: null,
  bootSeq: 0,
  resume: null,
  offer: null,
  offerTimer: null,
  best: { snake: 0, brick: 0, rocket: 0, claw: 0 },
  week: { key: '', best: {} }, // best[game] = { score, run, posted: false | 'posting' | 'posted' | 'error', msg }
  board: null,
  boardState: 'idle',
  boardAt: 0,
  login: undefined, // undefined: not asked yet; null: no gh login
  cfg: { sound: true, offers: true, reduceMotion: false },
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

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US')
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
    $.ui.log('og-arcade: sound ' + name + ' did not play: ' + err, { to: 'debug' })
  }
}

async function saveCfg($) {
  await $.store.set('cfg', S.cfg)
}

/** This week's bests, starting fresh when the week turns. */
function thisWeek() {
  const key = weekOf(Date.now())
  if (S.week.key !== key) S.week = { key, best: {} }
  return S.week
}

async function saveWeek($) {
  await $.store.set('week', S.week)
}

async function openPane($, game) {
  S.boot = { game: game || null, seq: ++S.bootSeq }
  S.offer = null
  thisWeek()
  const r = await $.ui.open({ id: PANE, title: "OG's Arcade", focus: true, closeOnEscape: true, rows: 26, columns: 76 })
  S.open = true
  void refreshBoard($)
  if (S.login === undefined) void whoami($).then(() => $.ui.invalidate('ui.render'))
  $.ui.invalidate('ui.render')
  return r
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

// ---------- GitHub: who you are, the board, posting a run ----------

async function gh($, args, stdin) {
  try {
    const r = await $.process.run(['gh', ...args], { timeoutMs: 20000, ...(stdin !== undefined ? { stdin } : {}) })
    return r
  } catch (err) {
    return { exitCode: 127, stdout: '', stderr: String(err) }
  }
}

async function whoami($) {
  if (S.login !== undefined) return S.login
  const r = await gh($, ['api', 'user', '--jq', '.login'])
  const login = r.exitCode === 0 ? String(r.stdout).trim() : ''
  S.login = /^[A-Za-z0-9-]{1,39}$/.test(login) ? login : null
  return S.login
}

function okBoard(b) {
  return b && typeof b === 'object' && typeof b.week === 'string' && b.games && typeof b.games === 'object'
}

/** Reads board/current.json: from the public raw URL, or through gh while the repo is private. */
async function refreshBoard($, force) {
  if (!force && Date.now() - S.boardAt < BOARD_EVERY_MS) return
  S.boardAt = Date.now()
  S.boardState = 'loading'
  let board = null
  try {
    const r = await $.http.fetch(BOARD_URL, { headers: { 'cache-control': 'no-cache' } })
    if (r.ok) board = JSON.parse(r.text)
  } catch {}
  if (!okBoard(board)) {
    const r = await gh($, ['api', 'repos/' + REPO + '/contents/board/current.json', '-H', 'Accept: application/vnd.github.raw+json'])
    if (r.exitCode === 0) {
      try { board = JSON.parse(r.stdout) } catch {}
    }
  }
  S.boardState = okBoard(board) ? 'ok' : 'none'
  if (okBoard(board)) S.board = board
  $.ui.invalidate('ui.render')
}

function issueBody(rec, login) {
  const G = GAMES[rec.game]
  return [
    MARKER,
    '**' + G.meta.title + '** · ' + fmt(rec.score) + ' points · week ' + rec.week + (login ? ' · @' + login : ''),
    '',
    'Posted from OG\'s Arcade in Claude Code. The board replays these keys with the same game code and adds the score only if it comes out exactly the same.',
    '',
    '```json',
    JSON.stringify(rec),
    '```',
  ].join('\n')
}

function issueTitle(rec) {
  return EMOJI[rec.game] + ' ' + GAMES[rec.game].meta.title + ' · ' + fmt(rec.score) + ' · ' + rec.week
}

/** Posts this week's best run for a game. Returns a line for the player. */
async function post($, game) {
  const wk = thisWeek()
  const b = wk.best[game]
  if (!b || !b.run) return 'No run to post yet: finish a game of ' + GAMES[game].meta.title + ' first.'
  if (b.posted === 'posted') return 'Already posted: ' + fmt(b.score) + ' in ' + GAMES[game].meta.title + ' this week.'
  if (b.run.week !== wk.key) return 'That run was from last week; play one this week.'
  b.posted = 'posting'
  b.msg = ''
  $.ui.invalidate('ui.render')
  const login = await whoami($)
  if (!login) {
    b.posted = 'error'
    b.msg = 'Posting needs the GitHub CLI: run gh auth login, then b'
    await saveWeek($)
    $.ui.invalidate('ui.render')
    return 'Posting needs the GitHub CLI (https://cli.github.com). Install it, run gh auth login, then post again.'
  }
  const r = await gh($, ['issue', 'create', '-R', REPO, '--title', issueTitle(b.run), '--body-file', '-'], issueBody(b.run, login))
  if (r.exitCode === 0) {
    b.posted = 'posted'
    b.url = String(r.stdout).trim().split('\n').pop()
    b.msg = ''
  } else {
    b.posted = 'error'
    const err = String(r.stderr || '').trim().split('\n')[0]
    b.msg = 'Could not post: ' + (err || 'gh exited ' + r.exitCode)
  }
  await saveWeek($)
  $.ui.invalidate('ui.render')
  return b.posted === 'posted' ? 'Posted ' + fmt(b.score) + ' in ' + GAMES[game].meta.title + ' as @' + login + '. The board checks it within a few minutes: ' + b.url : b.msg
}

/** Keeps the run if it is this week's best for its game. */
async function keepRun($, rec) {
  if (invalid(rec) || !(rec.score > 0)) return
  const wk = thisWeek()
  if (rec.week !== wk.key) return
  const cur = wk.best[rec.game]
  if (cur && cur.score >= rec.score) return
  wk.best[rec.game] = { score: rec.score, run: rec, posted: false, msg: '' }
  await saveWeek($)
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

/** The props the arcade gets: plain data only, the week's runs without their keys. */
function weekProps() {
  const wk = thisWeek()
  const best = {}
  for (const [g, b] of Object.entries(wk.best)) best[g] = { score: b.score, posted: b.posted || false, msg: b.msg || '' }
  return { key: wk.key, best }
}

function helpText() {
  return [
    '/og opens the arcade · /og snake|brick|rocket|claw starts a game · /og board shows this week\'s board',
    '/og post posts your best runs of the week to the board (needs gh) · /og off|on turns the offer above the prompt off or on',
    '/og sound toggles sound · /og calm turns off shake and flashes',
  ].join('\n')
}

// ---------- register ----------

export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'og',
      description: "OG's Arcade: Snake, Brick Break, Little Rocket and Claw Rush while Claude works, with a weekly board",
      argumentHint: '[snake | brick | rocket | claw | board | post | off | on | sound | calm]',
      immediate: true,
    })
    const best = await $.store.get('best')
    if (best && typeof best === 'object') S.best = { ...S.best, ...best }
    const cfg = await $.store.get('cfg')
    if (cfg && typeof cfg === 'object') S.cfg = { ...S.cfg, ...cfg }
    const week = await $.store.get('week')
    if (week && typeof week === 'object' && typeof week.key === 'string' && week.best) S.week = week
    thisWeek()
    return next(e)
  })

  on('command.run', { command: 'og' }, async ($, e) => {
    const arg = String(e.args || '').trim().toLowerCase()
    if (arg === 'off') {
      S.cfg.offers = false
      S.offer = null
      await saveCfg($)
      $.ui.invalidate('ui.render')
      return { text: "OG's Arcade won't offer a game any more. /og still opens it, and /og on brings the offer back." }
    }
    if (arg === 'on') {
      S.cfg.offers = true
      await saveCfg($)
      return { text: 'The arcade will offer a game after Claude has worked for 15 seconds.' }
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
    if (arg === 'help') return { text: helpText() }
    if (arg === 'post') {
      const wk = thisWeek()
      const games = ORDER.filter(g => wk.best[g] && wk.best[g].posted !== 'posted')
      if (!games.length) return { text: Object.keys(wk.best).length ? 'Your best runs this week are already on their way to the board.' : 'Nothing to post yet: finish a game this week first.' }
      const lines = []
      for (const g of games) lines.push(await post($, g))
      return { text: lines.join('\n') }
    }
    const want = ORDER.includes(arg) || arg === 'board' ? arg : null
    const r = await openPane($, want)
    if (r && r.isPlaced === false) return { text: 'The arcade needs a wider terminal: ' + (r.reason || 'there is no room') }
    return {}
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId) return next(e)
    S.claude = { state: 'working', label: 'thinking', since: Date.now() }
    S.needs = false
    S.turnId = e.turnId
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
    // The permission check runs inside next(): an ask there steps the game
    // aside (tool.check below), and the call returning means Claude moved on.
    if (S.claude.state !== 'done') S.claude = { ...S.claude, state: S.needs ? 'needs' : 'working', label: labelFor(e) }
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
    S.offer = null
    S.offerTimer?.cancel?.()
    if (S.open) void play($, 'done', 0.5)
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('ui.message', async ($, e, next) => {
    const d = e.data
    if (!d || typeof d !== 'object') return next(e)
    if ('save' in d) S.resume = d.save && d.save.run ? { run: d.save.run } : null
    if (d.score && typeof d.score.score === 'number') {
      const g = d.score.game
      if (g in S.best && d.score.score > S.best[g]) {
        S.best = { ...S.best, [g]: Math.floor(d.score.score) }
        await $.store.set('best', S.best)
      }
    }
    if (d.run) await keepRun($, d.run)
    if (Array.isArray(d.sfx)) for (const s of d.sfx.slice(0, 2)) void play($, s)
    if (d.cfg && typeof d.cfg === 'object') {
      S.cfg = { ...S.cfg, ...d.cfg }
      await saveCfg($)
    }
    if (d.board === 'refresh') void refreshBoard($, Date.now() - S.boardAt > 20000)
    if (typeof d.post === 'string' && GAMES[d.post]) {
      const line = await post($, d.post)
      if (S.week.best[d.post] && S.week.best[d.post].posted === 'posted') {
        $.ui.toast(line)
        // the Action takes a minute or two; look again after it should be done
        $.clock.after(150000, () => void refreshBoard($, true))
      }
    }
    if (d.close) await $.ui.close({ id: PANE })
    $.ui.invalidate('ui.render')
    return {}
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      S.open = false
      S.boot = null
    }
    return next(e)
  }).catch(async ($, e, next) => next(e))

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    if (e.viewport) S.fullscreen = !!e.viewport.isFullscreen
    const { Box, Text, Client, Button } = $.ui.resolve(e)
    if (e.surface !== 'terminal') {
      return Text({ children: ["OG's Arcade draws in the terminal. Run claude in a terminal to play."] })
    }
    const cols = Math.max(20, e.props.bodyColumns || 76)
    const rows = e.props.placement === 'dock' && e.props.scroll && e.props.scroll.bodyRows ? Math.max(12, Math.min(44, e.props.scroll.bodyRows - (S.fullscreen ? 0 : 1))) : 24

    if (S.needs) {
      // The game steps out so the keys reach the question; its run is saved
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
      input: S.input,
      cfg: { sound: S.cfg.sound, reduceMotion: S.cfg.reduceMotion },
      classic: S.fullscreen === false,
      week: weekProps(),
      board: S.board,
      boardState: S.boardState,
      login: S.login || null,
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
        Box({ flexDirection: 'row', columnGap: 2, children: [key('a', '◀'), key('d', '▶'), key('w', '▲'), key('s', '▼'), key('j', 'go'), key('x', 'alt'), key('p', 'pause'), key('q', 'menu'), key('b', 'board'), key('1', 'snake'), key('2', 'brick'), key('3', 'rocket'), key('4', 'claw')] }),
      ],
    })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (S.offer !== 'play' || S.open || S.needs || S.claude.state !== 'working') return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const others = await next(e)
    const lead = S.board && S.board.week === thisWeek().key && Array.isArray(S.board.og) && S.board.og[0]
    const tail = lead ? '· @' + lead.login + ' leads this week · /og off hides this' : '· it pauses when Claude needs you · /og off hides this'
    const line = Box({
      flexDirection: 'row',
      columnGap: 1,
      children: [
        Button({ key: 'og-play', label: "play OG's Arcade while Claude works", hotkey: '1', plain: true, onPress: () => openPane($, null) }),
        Text({ dimColor: true, children: [tail] }),
      ],
    })
    return Box({ flexDirection: 'column', children: others ? [line, others] : [line] })
  })
}
