// One run of one game, step by step. The arcade plays through this module and
// the weekly board's verifier replays through it, so a posted score is checked
// by the same code that produced it.
//
// A run is fixed by three things: the game, the week (which picks the seed, so
// everyone plays the same levels that week) and the keys pressed on each
// update. Nothing else may change what happens: game rules use det.js maths,
// the world's own seeded random numbers, and a fixed field size.

import * as snake from './games/snake.js'
import * as brick from './games/brick.js'
import * as rocket from './games/rocket.js'
import * as claw from './games/claw.js'
import { makeFx } from './lib/juice.js'

export const GAMES = { snake, brick, rocket, claw }
export const ORDER = ['snake', 'brick', 'rocket', 'claw']

/** Every game plays on the same field, in pixels (two per terminal row). */
export const FIELD = { w: 72, h: 40 }
export const DT = 1 / 30

/**
 * The rules version. Bump it whenever a change to any game would make an old
 * run replay differently; the board then asks players to update.
 */
export const RULES = 1

export const ACTS = ['left', 'right', 'up', 'down', 'action', 'alt']

export function mask(acts) {
  let m = 0
  for (const a of acts) {
    const i = ACTS.indexOf(a)
    if (i >= 0) m |= 1 << i
  }
  return m
}

/** The acts in a mask, always in ACTS order, so every run sees them the same way. */
export function unmask(m) {
  const out = []
  for (let i = 0; i < ACTS.length; i++) if (m & (1 << i)) out.push(ACTS[i])
  return out
}

// ---------- weeks ----------

const DAY = 86400000

/** The ISO week of a time, in UTC, as "2026-W44". Weeks start on Monday. */
export function weekOf(ms) {
  const d = new Date(ms)
  const dow = (d.getUTCDay() + 6) % 7
  const thu = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow + 3)
  const year = new Date(thu).getUTCFullYear()
  const jan4 = Date.UTC(year, 0, 4)
  const mon1 = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY
  const n = Math.floor((thu - 3 * DAY - mon1) / (7 * DAY)) + 1
  return year + '-W' + String(n).padStart(2, '0')
}

/** Monday 00:00 UTC of a week key. */
export function weekStart(key) {
  const m = /^(\d{4})-W(\d{2})$/.exec(String(key))
  if (!m) return NaN
  const year = Number(m[1]), n = Number(m[2])
  const jan4 = Date.UTC(year, 0, 4)
  const mon1 = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY
  return mon1 + (n - 1) * 7 * DAY
}

export function weekEnd(key) {
  return weekStart(key) + 7 * DAY
}

/** The seed every player gets for a game in a week. */
export function seedFor(week, game) {
  let h = 0x811c9dc5
  for (const ch of 'og-arcade/' + week + '/' + game) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 0x01000193)
  }
  return h | 0
}

// ---------- runs ----------

export function newRun(game, week) {
  const G = GAMES[game]
  const seed = seedFor(week, game)
  return { v: RULES, game, week, tick: 0, log: [], done: false, world: G.create(FIELD.w, FIELD.h, seed) }
}

/**
 * One update with the keys pressed since the last one (a mask). Returns the
 * game's events. Level changes happen here, so the arcade and the verifier
 * move between levels at the same moment.
 */
export function step(run, m, fx) {
  if (run.done) return []
  if (m) run.log.push(run.tick, m)
  run.tick++
  const G = GAMES[run.game]
  const ev = G.update(run.world, DT, unmask(m), fx) || []
  if (ev.includes('next') && G.nextLevel) run.world = G.nextLevel(run.world)
  if (ev.includes('over')) run.done = true
  return ev
}

export function score(run) {
  return GAMES[run.game].score(run.world)
}

/** What gets posted: the keys, not the world. Ticks in the log are deltas. */
export function record(run) {
  const log = []
  let last = 0
  for (let i = 0; i < run.log.length; i += 2) {
    log.push(run.log[i] - last, run.log[i + 1])
    last = run.log[i]
  }
  return { v: run.v, game: run.game, week: run.week, score: score(run), ticks: run.tick, log }
}

export const MAX_TICKS = 60 * 60 * 30 // an hour of play

/** Checks a posted record's shape. Returns a reason it is unusable, or null. */
export function invalid(rec) {
  if (!rec || typeof rec !== 'object') return 'not a run'
  if (rec.v !== RULES) return 'made with rules v' + rec.v + ', the board is on v' + RULES
  if (!GAMES[rec.game]) return 'unknown game'
  if (!(weekStart(rec.week) > 0)) return 'bad week'
  if (!Number.isInteger(rec.score) || rec.score < 0) return 'bad score'
  if (!Number.isInteger(rec.ticks) || rec.ticks < 1 || rec.ticks > MAX_TICKS) return 'bad length'
  if (!Array.isArray(rec.log) || rec.log.length % 2 || rec.log.length > rec.ticks * 2) return 'bad key log'
  let t = 0
  for (let i = 0; i < rec.log.length; i += 2) {
    const d = rec.log[i], m = rec.log[i + 1]
    if (!Number.isInteger(d) || d < (i ? 1 : 0) || !Number.isInteger(m) || m < 1 || m >= 1 << ACTS.length) return 'bad key log'
    t += d
  }
  if (t >= rec.ticks) return 'bad key log'
  return null
}

/** Plays a record back from the start. The score is what the rules say, not what was claimed. */
export function replay(rec) {
  const why = invalid(rec)
  if (why) return { ok: false, reason: why }
  const run = newRun(rec.game, rec.week)
  const fx = makeFx()
  let i = 0
  let at = rec.log.length ? rec.log[0] : -1
  while (run.tick < rec.ticks && !run.done) {
    let m = 0
    if (run.tick === at) {
      m = rec.log[i + 1]
      i += 2
      at = i < rec.log.length ? at + rec.log[i] : -1
    }
    step(run, m, fx)
    if (fx.parts.length > 40) fx.parts.length = 0
    fx.pops.length = 0
  }
  const s = score(run)
  return { ok: true, score: s, done: run.done, ticks: run.tick, matches: run.done && run.tick === rec.ticks && s === rec.score }
}
