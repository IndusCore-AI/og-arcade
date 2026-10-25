import { expect, test } from 'claude-code/testing'

import * as claw from '../client/games/claw.js'
import * as rocket from '../client/games/rocket.js'
import * as runner from '../client/games/runner.js'
import { makeFx } from '../client/lib/juice.js'

const PANE = {
  plugin: 'linewalker',
  component: 'Pane',
  requestId: 'pip',
  surface: 'terminal',
  viewport: { columns: 160, rows: 48, isFullscreen: true },
  props: { title: "Pip's Arcade", isFocused: true, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 44 }, view: {} },
} as const

function stubs(on: any) {
  const saved = new Map<string, unknown>()
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
  on('ui.scroll', () => ({ value: {} }))
  on('ui.log', () => ({ value: undefined }))
  on('audio.play', () => ({ value: undefined }))
  on('clock.after', () => ({ value: { cancel() {} } }))
  on('session.start', () => ({ cwd: '/work' }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: [''] }))
  return saved
}

async function start($: any) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
}

test('the game steps out of the pane while Claude asks for approval, and comes back', async ($, on) => {
  stubs(on)
  on('tool.check', () => ({ decision: 'ask', reason: 'needs permission' }))
  on('tool.call', () => ({ result: 'ok' }))
  await start($)
  await $.command.run({ command: 'pip', args: 'claw' })

  let ui = await $.ui.mount(PANE)
  expect(await ui.find({ key: 'arcade' })).toBeDefined()
  await ui.unmount()

  await $.tool.check({ tool: 'Write', tool_use_id: 't1', file_path: '/work/a.ts', content: 'x' } as any)
  ui = await $.ui.mount(PANE)
  expect(await ui.find({ key: 'arcade' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Claude needs you' })).toBeDefined()
  await ui.unmount()

  // the approved call runs; Pip brings the game back
  await $.tool.call({ tool: 'Write', tool_use_id: 't1', file_path: '/work/a.ts', content: 'const a = 1' } as any)
  ui = await $.ui.mount(PANE)
  expect(await ui.find({ key: 'arcade' })).toBeDefined()
  await ui.unmount()
})

test('code Claude writes reaches the runner as lines', async ($, on) => {
  stubs(on)
  on('tool.call', () => ({ result: 'ok' }))
  await start($)
  await $.command.run({ command: 'pip', args: 'runner' })
  await $.tool.call({ tool: 'Write', tool_use_id: 't2', file_path: '/work/src/rate.ts', content: 'export class A {\n  x = 1\n}' } as any)
  const ui = await $.ui.mount(PANE)
  const game: any = await ui.find({ key: 'arcade' })
  expect(game.props.props.code.lines.map((l: any) => l.t)).toEqual(['export class A {', '  x = 1', '}'])
  expect(game.props.props.code.lines[0].f).toBe('rate.ts')
  expect(game.props.props.claude.label).toBe('writing rate.ts')
  await ui.unmount()
})

test('after a long answer the band offers to read it, and the reply is drawn by the reader', async ($, on) => {
  stubs(on)
  await start($)
  const answer = Array.from({ length: 60 }, (_, i) => 'word' + i).join(' ') + '.'
  await $.turn.complete({ answer, durationMs: 1000, isAborted: false, turnId: 'u1', reason: 'answer', usage: {} } as any)
  const band = await $.ui.mount({ plugin: 'linewalker', component: 'AbovePrompt', requestId: 'above', surface: 'terminal', viewport: { columns: 160, rows: 48, isFullscreen: true }, props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 150, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as any)
  expect(await band.find({ key: 'pip-read' })).toBeDefined()
  await band.press({ key: 'pip-read' })
  await band.unmount()
  const msg = await $.ui.mount({ plugin: 'linewalker', component: 'AssistantMessage', requestId: 'm1', surface: 'terminal', viewport: { columns: 160, rows: 48, isFullscreen: true }, props: { text: answer, isFirstOfReply: true } } as any)
  const reader: any = await msg.find({ type: 'Client' })
  expect(reader).toBeDefined()
  expect(reader.props.props.text).toBe(answer)
  await msg.unmount()
})

test('a short answer gets no reading offer', async ($, on) => {
  stubs(on)
  await start($)
  await $.turn.complete({ answer: 'Done. The test passes.', durationMs: 900, isAborted: false, turnId: 'u2', reason: 'answer', usage: {} } as any)
  const band = await $.ui.mount({ plugin: 'linewalker', component: 'AbovePrompt', requestId: 'above', surface: 'terminal', viewport: { columns: 160, rows: 48 }, props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 150, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as any)
  expect(await band.find({ key: 'pip-read' })).toBeUndefined()
  await band.unmount()
})

// ---------- game rules, no Claude Code needed ----------

test('claw: TNT clears what is around it and chains to other barrels', () => {
  const w: any = claw.create(100, 48, 1)
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
  const ev = claw.update(w, 1 / 30, [], fx)
  expect(ev).toContain('boom')
  expect(w.items.find((i: any) => i.id === 2)).toBeUndefined()
  // the second barrel goes 0.1 s later
  for (let i = 0; i < 5; i++) claw.update(w, 1 / 30, [], fx)
  expect(w.items.find((i: any) => i.id === 3)).toBeUndefined()
  expect(w.items.find((i: any) => i.id === 4)).toBeDefined()
})

test('claw: heavy things reel in slower than light ones', () => {
  const time = (kind: string) => {
    const w: any = claw.create(100, 48, 2)
    w.phase = 'play'
    w.items = []
    w.claw.state = 'back'
    w.claw.len = 0.8
    w.claw.held = kind === 'none' ? null : { k: kind, v: 1, m: kind === 'boulder' ? 10 : 1.5 }
    let n = 0
    while (w.claw.state === 'back' && n < 600) { claw.update(w, 1 / 30, [], makeFx()); n++ }
    return n
  }
  expect(time('boulder')).toBeGreaterThan(time('diamond'))
  expect(time('boulder') / 30).toBeLessThan(6)
})

test('rocket: a hit costs a heart and a power level, then grants a moment of safety', () => {
  const w: any = rocket.create(70, 68, 3)
  w.phase = 'play'
  w.p.power = 2
  w.bullets.push({ x: w.p.x, y: w.h - 9 + 3, vx: 0, vy: 0, g: false })
  rocket.update(w, 1 / 30, [], makeFx())
  expect(w.p.hp).toBe(2)
  expect(w.p.power).toBe(1)
  expect(w.p.inv).toBeGreaterThan(1)
})

test('runner: new code from Claude extends the level, blank lines open gaps', () => {
  const w: any = runner.create(100, 44, 4)
  const before = w.endX
  runner.feed(w, { lines: [{ n: 0, t: 'function a() {', f: 'a.ts' }, { n: 1, t: '', f: 'a.ts' }, { n: 2, t: '  return 1', f: 'a.ts' }] })
  expect(w.endX).toBeGreaterThan(before)
  const last = w.plats[w.plats.length - 1]
  const prev = w.plats[w.plats.length - 2]
  expect(last.x0 - prev.x1).toBeGreaterThanOrEqual(12)
  expect(last.row).toBeLessThan(prev.row)
  // feeding the same lines again adds nothing
  const n = w.plats.length
  runner.feed(w, { lines: [{ n: 2, t: '  return 1', f: 'a.ts' }] })
  expect(w.plats.length).toBe(n)
})
