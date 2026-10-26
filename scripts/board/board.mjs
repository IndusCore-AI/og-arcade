#!/usr/bin/env node
// The weekly board, run by GitHub Actions (.github/workflows/board.yml and
// crown.yml). Plain Node, no packages.
//
//   verify   replays every posted run that is waiting (one issue, or all open
//            run issues) and writes the results to $RESULTS
//   apply    adds the verified runs to board/state.json, then renders
//            board/current.json and the board section of README.md
//   respond  comments on each issue with the outcome and closes it
//   crown    closes last week: its OG goes into the hall of fame
//   render   re-renders current.json and README.md from state.json
//   summary  one line for the commit message
//
// A run is trusted only because it replays: the keys in the issue are played
// through client/sim.js, the same code the arcade runs, and the score has to
// come out exactly as claimed. Who posted it is the issue's author on GitHub.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { GAMES, RULES, weekOf } from '../../client/sim.js'
import { MARKER, standings, check, renderCurrent, renderSection, fmt, weekName } from './rules.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const STATE = join(ROOT, 'board', 'state.json')
const CURRENT = join(ROOT, 'board', 'current.json')
const README = join(ROOT, 'README.md')
const RESULTS = process.env.RESULTS || join(ROOT, '.board-results.json')
const REPO = process.env.REPO || 'IndusCore-AI/og-arcade'
const KEEP_WEEKS = 12

// ---------- state ----------

function load() {
  const s = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {}
  return { rules: RULES, weeks: {}, champions: [], processed: [], ...s }
}

function save(state) {
  state.rules = RULES
  const keys = Object.keys(state.weeks).sort()
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_WEEKS))) delete state.weeks[k]
  state.processed = state.processed.slice(-1000)
  writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n')
}

// ---------- GitHub ----------

function gh(args, input) {
  return execFileSync('gh', args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] })
}

function waitingIssues() {
  const path = process.env.GITHUB_EVENT_PATH
  if (path && existsSync(path)) {
    const ev = JSON.parse(readFileSync(path, 'utf8'))
    if (ev.issue) return [ev.issue]
  }
  // a schedule or a manual run: every open issue that carries a run
  const out = gh(['api', '--paginate', 'repos/' + REPO + '/issues?state=open&per_page=100'])
  return JSON.parse(out.replace(/\]\s*\[/g, ',')).filter(i => !i.pull_request && String(i.body || '').includes(MARKER))
}

// ---------- files ----------

function writeOut(state, now = Date.now()) {
  writeFileSync(CURRENT, JSON.stringify(renderCurrent(state, now), null, 2) + '\n')
  const readme = readFileSync(README, 'utf8')
  const a = readme.indexOf('<!-- board:start -->'), b = readme.indexOf('<!-- board:end -->')
  if (a < 0 || b < a) throw new Error('README.md has no board markers')
  writeFileSync(README, readme.slice(0, a) + '<!-- board:start -->\n' + renderSection(state, now) + '\n' + readme.slice(b))
}

// ---------- commands ----------

const main = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
const cmd = main ? process.argv[2] : null

if (cmd === 'verify') {
  const state = load()
  const results = []
  // an issue already applied but still open (its reply failed) is checked
  // again so it gets its reply; apply skips it the second time
  for (const issue of waitingIssues()) {
    const r = check(issue, state)
    if (!r.skip) results.push(r)
    console.log('#' + issue.number, r.skip ? 'skipped' : r.ok ? 'ok ' + r.game + ' ' + r.score + ' @' + r.login : 'rejected: ' + r.reason)
  }
  writeFileSync(RESULTS, JSON.stringify(results, null, 2))
} else if (cmd === 'apply') {
  const state = load()
  const results = existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, 'utf8')) : []
  for (const r of results) {
    if (state.processed.includes(r.number)) continue
    state.processed.push(r.number)
    if (!r.ok) continue
    const w = (state.weeks[r.week] = state.weeks[r.week] || { runs: {} })
    const g = (w.runs[r.game] = w.runs[r.game] || {})
    const cur = g[r.login]
    if (!cur || r.score > cur.score) g[r.login] = { score: r.score, ticks: r.ticks, at: r.at, issue: r.number }
  }
  save(state)
  writeOut(state)
} else if (cmd === 'respond') {
  const state = load()
  const results = existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, 'utf8')) : []
  for (const r of results) {
    let body
    if (r.ok) {
      const { games, og } = standings(state, r.week)
      const rank = games[r.game].findIndex(e => e.login === r.login) + 1
      const best = games[r.game][rank - 1]
      const overall = og.findIndex(e => e.login === r.login) + 1
      const still = best && best.score > r.score ? ' Your ' + fmt(best.score) + ' from earlier this week still counts as your best.' : ''
      body = '✓ Checked. Replaying your keys gives **' + fmt(r.score) + '** in ' + GAMES[r.game].meta.title + ', exactly what your game said.' + still +
        '\n\nYou are **#' + rank + '** in ' + GAMES[r.game].meta.title + ' and **#' + overall + '** overall for ' + weekName(r.week) + '. The board is in the README.'
    } else {
      body = '✗ This run did not check out: ' + r.reason + '. Nothing was added to the board.'
    }
    try {
      gh(['issue', 'comment', String(r.number), '-R', REPO, '--body-file', '-'], body)
      gh(['issue', 'close', String(r.number), '-R', REPO, '--reason', r.ok ? 'completed' : 'not planned'])
    } catch (err) {
      console.error('#' + r.number + ': could not reply: ' + String(err.stderr || err.message).split('\n')[0])
    }
  }
} else if (cmd === 'crown') {
  const state = load()
  const now = Date.now()
  const last = weekOf(now - 7 * 86400000 + 3600000)
  if (!state.champions.some(c => c.week === last)) {
    const { og } = standings(state, last)
    if (og.length) {
      const top = og[0]
      state.champions.push({ week: last, login: top.login, points: top.points, wins: top.wins, scores: top.scores })
      console.log('OG of ' + last + ': @' + top.login + ' with ' + top.points + ' points')
    } else console.log('Nobody played in ' + last)
  }
  save(state)
  writeOut(state, now)
} else if (cmd === 'render') {
  const state = load()
  save(state)
  writeOut(state)
} else if (cmd === 'summary') {
  const results = existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, 'utf8')) : []
  const ok = results.filter(r => r.ok)
  console.log(ok.length ? ok.map(r => '@' + r.login + ' ' + r.game + ' ' + r.score).join(', ') : results.length + ' run(s) checked')
} else if (cmd) {
  console.error('unknown command: ' + cmd)
  process.exit(2)
}
