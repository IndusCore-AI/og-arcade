import { expect, test } from 'claude-code/testing'

import * as claw from '../client/games/claw.js'
import * as rocket from '../client/games/rocket.js'
import { makeFx } from '../client/lib/juice.js'
import * as det from '../client/lib/det.js'
import { ORDER, RULES, newRun, step, record, replay, weekOf, weekStart, seedFor, invalid } from '../client/sim.js'
import { check, standings, renderSection } from '../scripts/board/rules.mjs'
import fixtures from './fixtures/runs.js'

const PANE = {
  plugin: 'og-arcade',
  component: 'Pane',
  requestId: 'og',
  surface: 'terminal',
  viewport: { columns: 160, rows: 48, isFullscreen: true },
  props: { title: "OG's Arcade", isFocused: true, bodyColumns: 76, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

function stubs(on: any, gh: (argv: string[], stdin?: string) => any = () => ({ exitCode: 1, stdout: '', stderr: 'gh: not found' })) {
  const saved = new Map<string, unknown>()
  const calls: { argv: string[]; stdin?: string }[] = []
  on('store.get', ($: any, e: any) => ({ value: saved.get(e.key) }))
  on('store.set', ($: any, e: any) => {
    saved.set(e.key, e.value)
    return { value: undefined }
  })
  on('command.register', () => ({ value: undefined }))
  on('settings.read', () => ({ value: { theme: 'dark' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('audio.play', () => ({ value: undefined }))
  on('clock.after', () => ({ value: { cancel() {} } }))
  on('http.fetch', () => ({ value: { status: 404, ok: false, headers: {}, text: '404: Not Found' } }))
  on('process.run', ($: any, e: any) => {
    const argv = [...e.argv]
    calls.push({ argv, stdin: e.init && e.init.stdin })
    return { value: gh(argv.slice(1), e.init && e.init.stdin) }
  })
  on('session.start', () => ({ cwd: '/work' }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: [''] }))
  return { saved, calls }
}

async function start($: any) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
}

/** A finished run of a game this week, played by a simple bot. */
function playedRun(game: string, seed = 3) {
  let s = seed
  const r = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const run = newRun(game, weekOf(Date.now()))
  const fx = makeFx()
  while (!run.done && run.tick < 30 * 60 * 20) step(run, r() < 0.14 ? 1 << Math.floor(r() * 6) : 0, fx)
  return record(run)
}

// ---------- in Claude Code ----------

test('the game steps out of the pane while Claude asks for approval, and comes back', async ($, on) => {
  stubs(on)
  on('tool.check', () => ({ decision: 'ask', reason: 'needs permission' }))
  on('tool.call', () => ({ result: 'ok' }))
  await start($)
  await $.command.run({ command: 'og', args: 'claw' })

  let ui = await $.ui.mount(PANE)
  expect(await ui.find({ key: 'arcade' })).toBeDefined()
  await ui.unmount()

  await $.tool.check({ tool: 'Write', tool_use_id: 't1', file_path: '/work/a.ts', content: 'x' } as any)
  ui = await $.ui.mount(PANE)
  expect(await ui.find({ key: 'arcade' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Claude needs you' })).toBeDefined()
  await ui.unmount()

  await $.tool.call({ tool: 'Write', tool_use_id: 't1', file_path: '/work/a.ts', content: 'const a = 1' } as any)
  ui = await $.ui.mount(PANE)
  const game: any = await ui.find({ key: 'arcade' })
  expect(game).toBeDefined()
  expect(game.props.props.claude.label).toBe('writing a.ts')
  await ui.unmount()
})

test("a finished run becomes the week's best, and b posts it as a GitHub issue", async ($, on) => {
  const { calls } = stubs(on, argv => {
    if (argv[0] === 'api' && argv[1] === 'user') return { exitCode: 0, stdout: 'ada\n', stderr: '' }
    if (argv[0] === 'issue' && argv[1] === 'create') return { exitCode: 0, stdout: 'https://github.com/IndusCore-AI/og-arcade/issues/7\n', stderr: '' }
    return { exitCode: 1, stdout: '', stderr: 'no' }
  })
  await start($)
  await $.command.run({ command: 'og', args: 'claw' })
  const rec = playedRun('claw')
  expect(rec.score).toBeGreaterThan(0)

  let ui = await $.ui.mount(PANE)
  await ui.post({ score: { game: 'claw', score: rec.score }, run: rec, save: null })
  await ui.unmount()
  ui = await $.ui.mount(PANE)
  let game: any = await ui.find({ key: 'arcade' })
  expect(game.props.props.week.best.claw).toEqual({ score: rec.score, posted: false, msg: '' })
  expect(game.props.props.best.claw).toBe(rec.score)

  await ui.post({ post: 'claw' })
  await ui.unmount()
  const create = calls.find(c => c.argv[1] === 'issue' && c.argv[2] === 'create')
  expect(create).toBeDefined()
  expect(create!.argv).toContain('IndusCore-AI/og-arcade')
  // the issue carries the run, and the board's parser reads it back
  const issue = { number: 7, user: { login: 'ada', type: 'User' }, created_at: new Date().toISOString(), body: create!.stdin }
  const res = check(issue as any, { rules: RULES, weeks: {}, champions: [], processed: [] })
  expect(res.ok).toBe(true)
  expect((res as any).score).toBe(rec.score)

  ui = await $.ui.mount(PANE)
  game = await ui.find({ key: 'arcade' })
  expect(game.props.props.week.best.claw.posted).toBe('posted')
  expect(game.props.props.login).toBe('ada')
  await ui.unmount()
})

test('without the GitHub CLI, posting says how to get it and keeps the run', async ($, on) => {
  stubs(on)
  await start($)
  const rec = playedRun('rocket')
  await $.command.run({ command: 'og', args: 'rocket' })
  const ui = await $.ui.mount(PANE)
  await ui.post({ score: { game: 'rocket', score: rec.score }, run: rec })
  await ui.unmount()
  const out: any = await $.command.run({ command: 'og', args: 'post' })
  expect(out.text).toContain('gh auth login')
  const again = await $.ui.mount(PANE)
  const game: any = await again.find({ key: 'arcade' })
  expect(game.props.props.week.best.rocket.posted).toBe('error')
  expect(game.props.props.week.best.rocket.score).toBe(rec.score)
  await again.unmount()
})

// ---------- the run engine ----------

test('weeks are ISO weeks in UTC and pick the same seed for everyone', () => {
  expect(weekOf(Date.UTC(2026, 9, 26, 0, 0))).toBe('2026-W44')
  expect(weekOf(Date.UTC(2026, 9, 25, 23, 59))).toBe('2026-W43')
  expect(weekOf(Date.UTC(2027, 0, 1))).toBe('2026-W53')
  expect(weekOf(Date.UTC(2026, 0, 1))).toBe('2026-W01')
  expect(weekStart('2026-W44')).toBe(Date.UTC(2026, 9, 26))
  expect(seedFor('2026-W44', 'snake')).toBe(seedFor('2026-W44', 'snake'))
  expect(seedFor('2026-W44', 'snake')).not.toBe(seedFor('2026-W45', 'snake'))
})

test('deterministic maths stays within a hair of the real thing', () => {
  for (const x of [-40, -3.3, -1, 0, 0.5, 1.57, 3.14159, 7, 123.4]) {
    expect(Math.abs(det.sin(x) - Math.sin(x))).toBeLessThan(1e-10)
    expect(Math.abs(det.cos(x) - Math.cos(x))).toBeLessThan(1e-10)
  }
  for (const [y, x] of [[1, 1], [-2, 0.5], [0.3, -4], [-1, -1], [5, 0], [0, -3]]) expect(Math.abs(det.atan2(y, x) - Math.atan2(y, x))).toBeLessThan(1e-10)
})

test('runs recorded on Node replay to the same score here, for every game', () => {
  expect((fixtures as any[]).map(r => r.game)).toEqual(ORDER)
  for (const rec of fixtures as any[]) {
    const res = replay(rec)
    expect([rec.game, res.ok, res.matches, res.score]).toEqual([rec.game, true, true, rec.score])
  }
})

test('a run survives being saved and restored mid-game, as an approval pause does', () => {
  for (const game of ORDER) {
    const rec = playedRun(game, 11)
    const run: any = newRun(game, rec.week)
    const fx = makeFx()
    let i = 0, at = rec.log.length ? rec.log[0] : -1
    let r: any = run
    while (!r.done && r.tick < rec.ticks) {
      let m = 0
      if (r.tick === at) { m = rec.log[i + 1]; i += 2; at = i < rec.log.length ? at + rec.log[i] : -1 }
      step(r, m, fx)
      if (r.tick % 97 === 0) r = JSON.parse(JSON.stringify(r))
    }
    expect([game, r.done, record(r).score]).toEqual([game, true, rec.score])
  }
})

// ---------- the board ----------

test('the board takes a run that replays, and turns down a typed-in score', () => {
  const state = { rules: RULES, weeks: {}, champions: [], processed: [] }
  const rec = playedRun('brick', 5)
  const body = (r: any) => '<!-- og-arcade run -->\nhello\n\n```json\n' + JSON.stringify(r) + '\n```'
  const now = new Date().toISOString()
  const good = check({ number: 1, user: { login: 'grace', type: 'User' }, created_at: now, body: body(rec) } as any, state)
  expect(good.ok).toBe(true)
  const faked = check({ number: 2, user: { login: 'mallory', type: 'User' }, created_at: now, body: body({ ...rec, score: rec.score + 100 }) } as any, state)
  expect(faked.ok).toBe(false)
  expect((faked as any).reason).toContain('replaying the keys gives')
  const old = check({ number: 3, user: { login: 'grace', type: 'User' }, created_at: now, body: body({ ...rec, v: RULES - 1 }) } as any, state)
  expect((old as any).reason).toContain('older version')
  const chat = check({ number: 4, user: { login: 'grace', type: 'User' }, created_at: now, body: 'is there a dark mode?' } as any, state)
  expect(chat.skip).toBe(true)
  expect(invalid({ ...rec, log: [0, 99] })).toBe('bad key log')
})

test('points per game decide the OG of the week, and the README shows them', () => {
  const week = weekOf(Date.now())
  const state: any = {
    rules: RULES,
    champions: [{ week: '2026-W01', login: 'linus', points: 61, scores: { snake: 900 } }],
    processed: [],
    weeks: {
      [week]: {
        runs: {
          snake: { ada: { score: 500, at: '1' }, grace: { score: 900, at: '2' } },
          brick: { ada: { score: 3000, at: '1' } },
          rocket: { grace: { score: 100, at: '1' }, ada: { score: 100, at: '2' } },
        },
      },
    },
  }
  const { games, og } = standings(state, week)
  expect(games.rocket.map((e: any) => e.login)).toEqual(['grace', 'ada'])
  expect(og.map((e: any) => [e.login, e.points])).toEqual([['ada', 18 + 25 + 18], ['grace', 25 + 25]])
  const md = renderSection(state)
  expect(md).toContain("Last week's OG: [@linus](https://github.com/linus)")
  expect(md).toContain('| 1 | ')
  expect(md).toContain('[@ada](https://github.com/ada) | **61**')
})

// ---------- game rules ----------

test('claw: TNT clears what is around it and chains to other barrels', () => {
  const w: any = claw.create(72, 40, 1)
  w.phase = 'play'
  w.items = [
    { k: 'tnt', u: 0.5, v: 0.5, r: 3, id: 1, wob: 0 },
    { k: 'rock', u: 0.53, v: 0.5, r: 3.5, id: 2, wob: 0 },
    { k: 'tnt', u: 0.58, v: 0.52, r: 3, id: 3, wob: 0 },
    { k: 'big', u: 0.05, v: 0.9, r: 5, id: 4, wob: 0 },
  ]
  w.claw.state = 'out'
  w.claw.a = 0
  w.claw.len = 0.45
  const fx = makeFx()
  let ev: string[] = []
  for (let i = 0; i < 3 && !ev.includes('boom'); i++) ev = claw.update(w, 1 / 30, [], fx)
  expect(ev).toContain('boom')
  expect(w.items.find((i: any) => i.id === 2)).toBeUndefined()
  for (let i = 0; i < 5; i++) claw.update(w, 1 / 30, [], fx)
  expect(w.items.find((i: any) => i.id === 3)).toBeUndefined()
  expect(w.items.find((i: any) => i.id === 4)).toBeDefined()
})

test('claw: goals rise faster than a level pays, and the score is what was banked', () => {
  const steps = [2, 3, 4, 5, 6, 7, 8].map(l => claw.goalFor(l) - claw.goalFor(l - 1))
  for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThan(steps[i - 1])
  const w: any = claw.create(72, 40, 2)
  w.earned = 900
  w.money = 300
  expect(claw.score(w)).toBe(900)
})

test('rocket: a hit costs a heart and a power level, and a cleared stage carries the score', () => {
  const w: any = rocket.create(72, 40, 3)
  w.phase = 'play'
  w.p.power = 2
  w.bullets.push({ x: w.p.x, y: w.h - 9 + 3, vx: 0, vy: 0, g: false })
  rocket.update(w, 1 / 30, [], makeFx())
  expect(w.p.hp).toBe(2)
  expect(w.p.power).toBe(1)
  expect(w.p.inv).toBeGreaterThan(1)
  w.score = 4321
  const next: any = rocket.nextLevel(w)
  expect([next.stage, next.score, next.p.hp, next.p.bombs]).toEqual([2, 4321, 3, w.p.bombs + 1])
})
