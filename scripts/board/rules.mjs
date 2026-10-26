// The board's rules: who ranks where, which posted runs count, and how the
// board reads in the README. Pure functions over plain data, so the tests can
// load them; board.mjs does the files and GitHub.

import { GAMES, ORDER, RULES, replay, weekOf, weekEnd } from '../../client/sim.js'

export const MARKER = '<!-- og-arcade run -->'
export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]

/** Each game's ranking for a week, and the overall one: F1 points per game, summed. */
export function standings(state, week) {
  const w = state.weeks[week] || { runs: {} }
  const games = {}
  const total = new Map()
  for (const g of ORDER) {
    const runs = Object.entries((w.runs && w.runs[g]) || {}).map(([login, r]) => ({ login, ...r }))
    runs.sort((a, b) => b.score - a.score || String(a.at).localeCompare(String(b.at)))
    games[g] = runs.map(r => ({ login: r.login, score: r.score }))
    runs.forEach((r, i) => {
      const t = total.get(r.login) || { login: r.login, points: 0, wins: 0, scores: {} }
      t.points += POINTS[i] || 0
      if (i === 0) t.wins++
      t.scores[g] = r.score
      total.set(r.login, t)
    })
  }
  const og = [...total.values()].sort((a, b) => b.points - a.points || b.wins - a.wins || a.login.localeCompare(b.login))
  return { games, og }
}

// ---------- posted runs ----------

/** The run record inside an issue body, or a reason there isn't one. */
export function parseBody(body) {
  const s = String(body || '')
  if (!s.includes(MARKER)) return { skip: true }
  if (s.length > 400000) return { reason: 'the issue is too long to be a run' }
  const m = /```json\s*\n([\s\S]*?)\n```/.exec(s.slice(s.indexOf(MARKER)))
  if (!m) return { reason: 'there is no run in it (the json block is missing)' }
  try {
    return { rec: JSON.parse(m[1]) }
  } catch {
    return { reason: "the run's json does not parse" }
  }
}

/** Replays one issue's run. The result says what happened, never echoes the body. */
export function check(issue, state, now = Date.now()) {
  const login = issue.user && issue.user.login
  const base = { number: issue.number, login }
  if (!login || (issue.user && issue.user.type === 'Bot')) return { ...base, ok: false, skip: true }
  const p = parseBody(issue.body)
  if (p.skip) return { ...base, ok: false, skip: true }
  if (p.reason) return { ...base, ok: false, reason: p.reason }
  const rec = p.rec
  const posted = Date.parse(issue.created_at || '') || now
  const res = replay(rec)
  if (!res.ok) return { ...base, ok: false, reason: res.reason === 'made with rules v' + rec.v + ', the board is on v' + RULES ? 'it was made with an older version of the games (rules v' + rec.v + '); update with `claude plugin marketplace update og-arcade` and play again' : 'the run is malformed (' + res.reason + ')' }
  if (rec.week !== weekOf(posted)) return { ...base, ok: false, reason: 'it was played in ' + rec.week + ' but posted in ' + weekOf(posted) + '; only this week\'s levels count this week' }
  if (state.champions.some(c => c.week === rec.week)) return { ...base, ok: false, reason: rec.week + ' is already closed' }
  if (!res.done) return { ...base, ok: false, reason: 'the replay never reached game over, so the run looks cut short' }
  if (res.matches && res.score <= 0) return { ...base, ok: false, reason: 'a score of 0 does not go on the board' }
  if (!res.matches) return { ...base, ok: false, reason: 'replaying the keys gives ' + res.score.toLocaleString('en-US') + ', not ' + Number(rec.score).toLocaleString('en-US') }
  return { ...base, ok: true, game: rec.game, week: rec.week, score: res.score, ticks: res.ticks, at: new Date(posted).toISOString() }
}

// ---------- rendering ----------

export const fmt = n => Number(n || 0).toLocaleString('en-US')
const avatar = (login, size) => '<img src="https://github.com/' + login + '.png?size=' + size * 2 + '" width="' + size + '" height="' + size + '" alt="">'
const who = login => '[@' + login + '](https://github.com/' + login + ')'
export const weekName = k => 'week ' + Number(String(k).slice(-2))

export function renderCurrent(state, now = Date.now()) {
  const week = weekOf(now)
  const { games, og } = standings(state, week)
  const champion = state.champions[state.champions.length - 1] || null
  const top = {}
  for (const g of ORDER) top[g] = games[g].slice(0, 10)
  return {
    week,
    ends: new Date(weekEnd(week)).toISOString(),
    updated: new Date(now).toISOString(),
    rules: RULES,
    games: top,
    og: og.slice(0, 10).map(({ login, points, wins }) => ({ login, points, wins })),
    champion: champion ? { week: champion.week, login: champion.login, points: champion.points } : null,
  }
}

export function renderSection(state, now = Date.now()) {
  const week = weekOf(now)
  const { games, og } = standings(state, week)
  const lines = []
  const champ = state.champions[state.champions.length - 1]
  if (champ) {
    const best = ORDER.filter(g => champ.scores && champ.scores[g] !== undefined).map(g => GAMES[g].meta.title + ' ' + fmt(champ.scores[g]))
    lines.push('### 🏆 Last week\'s OG: ' + who(champ.login), '')
    lines.push('<a href="https://github.com/' + champ.login + '">' + avatar(champ.login, 64).replace('alt=""', 'alt="" align="left"') + '</a>')
    lines.push('Won ' + weekName(champ.week) + ' with **' + champ.points + ' points**' + (best.length ? ' · ' + best.join(' · ') : '') + '.', '<br clear="left">', '')
  }
  lines.push('### This week: ' + weekName(week) + ', ends Monday 00:00 UTC', '')
  if (!og.length) {
    lines.push('Nobody has posted a run yet. Be the first: type `/og` in Claude Code, finish a game, press **b**.')
  } else {
    lines.push('| # | Player | Points | ' + ORDER.map(g => GAMES[g].meta.title).join(' | ') + ' |')
    lines.push('|--:|:--|--:|' + ORDER.map(() => '--:').join('|') + '|')
    og.slice(0, 10).forEach((e, i) => {
      const cells = ORDER.map(g => {
        const rank = games[g].findIndex(r => r.login === e.login)
        if (rank < 0) return '·'
        return fmt(games[g][rank].score) + (rank === 0 ? ' 🥇' : '')
      })
      lines.push('| ' + (i + 1) + ' | ' + avatar(e.login, 20) + ' ' + who(e.login) + ' | **' + e.points + '** | ' + cells.join(' | ') + ' |')
    })
  }
  lines.push('')
  if (state.champions.length) {
    lines.push('<details><summary>Hall of fame</summary>', '', '| Week | OG | Points |', '|:--|:--|--:|')
    for (const c of [...state.champions].reverse().slice(0, 52)) lines.push('| ' + c.week + ' | ' + avatar(c.login, 20) + ' ' + who(c.login) + ' | ' + c.points + ' |')
    lines.push('', '</details>', '')
  }
  lines.push('<sub>Updated ' + new Date(now).toISOString().slice(0, 16).replace('T', ' ') + ' UTC by the board\'s GitHub Action. Points per game: 25, 18, 15, 12, 10, 8, 6, 4, 2, 1 for the top ten.</sub>')
  return lines.join('\n')
}
