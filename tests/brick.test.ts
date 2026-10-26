import { expect, test } from 'claude-code/testing'

import * as brick from '../client/games/brick.js'
import { makeFx } from '../client/lib/juice.js'
import { newRun, step, record, replay, mask } from '../client/sim.js'

const DT = 1 / 30

function playing(seed = 1): any {
  const w: any = brick.create(72, 40, seed)
  w.phase = 'play'
  w.phaseT = 0
  return w
}

test('brick: a press nudges the paddle and glides, down stops it', () => {
  const w = playing()
  const fx = makeFx()
  const x0 = w.pad.x
  brick.update(w, DT, ['right'], fx)
  expect(w.pad.x).toBeGreaterThan(x0 + 2)
  const x1 = w.pad.x
  for (let i = 0; i < 5; i++) brick.update(w, DT, [], fx)
  expect(w.pad.x).toBeGreaterThan(x1 + 5) // still gliding
  brick.update(w, DT, ['down'], fx)
  for (let i = 0; i < 6; i++) brick.update(w, DT, [], fx)
  const x2 = w.pad.x
  brick.update(w, DT, [], fx)
  expect(Math.abs(w.pad.x - x2)).toBeLessThan(0.05) // stopped
})

test('brick: the ball breaks a brick, scores and bounces back', () => {
  const w = playing()
  w.serve = false
  // under the bottom row's first brick (row 4 of The wall at y = 17..18), moving up
  w.balls = [{ x: 6, y: 19.4, vx: 0, vy: -34, tr: [] }]
  const before = w.left
  const ev = brick.update(w, DT, [], makeFx())
  expect(ev).toContain('brick')
  expect(w.left).toBe(before - 1)
  expect(w.cells[4 * 8]).toBeNull()
  expect(w.score).toBeGreaterThan(0)
  expect(w.balls[0].vy).toBeGreaterThan(0)
})

test('brick: a cleared level says next, and the next level keeps score and lives', () => {
  const w = playing()
  w.serve = false
  w.cells = w.cells.map((c: any, i: number) => (i === 4 * 8 ? c : null))
  w.left = 1
  w.lives = 2
  w.balls = [{ x: 6, y: 19.4, vx: 0, vy: -34, tr: [] }]
  const fx = makeFx()
  expect(brick.update(w, DT, [], fx)).toContain('clear')
  const score = w.score
  let saw = 0
  for (let i = 0; i < 80; i++) if (brick.update(w, DT, [], fx).includes('next')) saw++
  expect(saw).toBe(1)
  const nw: any = brick.nextLevel(w)
  expect(nw.level).toBe(2)
  expect(nw.score).toBe(score)
  expect(nw.lives).toBe(2)
  expect(nw.left).toBeGreaterThan(0)
})

test('brick: losing the last ball on the last life ends the run once', () => {
  const w = playing()
  w.serve = false
  w.lives = 1
  w.balls = [{ x: 30, y: 39.8, vx: 0, vy: 40, tr: [] }]
  const fx = makeFx()
  const first = brick.update(w, DT, [], fx)
  expect(first).toContain('lose')
  expect(w.phase).toBe('dying')
  let overs = 0
  for (let i = 0; i < 90; i++) overs += brick.update(w, DT, [], fx).filter((e: string) => e === 'over').length
  expect(overs).toBe(1)
})

test('brick: a played run replays to the same score from its key log', () => {
  const run: any = newRun('brick', '2026-W44')
  const fx = makeFx()
  while (!run.done && run.tick < 20000) {
    const w = run.world
    const bs = w.balls.filter((b: any) => b.vy >= 0).sort((a: any, b: any) => b.y - a.y)
    const d = (bs.length ? bs[0].x : w.w / 2) - w.pad.x
    const acts: string[] = []
    if (run.tick % 3 === 0) acts.push(d > 2 ? 'right' : d < -2 ? 'left' : 'down')
    if (w.serve && run.tick % 40 === 5) acts.push('action')
    step(run, mask(acts), fx)
    if (run.tick === 900) run.world = JSON.parse(JSON.stringify(run.world))
  }
  expect(run.done).toBe(true)
  const r: any = replay(JSON.parse(JSON.stringify(record(run))))
  expect(r.matches).toBe(true)
})


// Recorded in Node (V8, what the board's verifier runs) on 2026-10-26; it must
// replay to the same score here, under Claude Code's own engine.
const V8_RUN = {"v":1,"game":"brick","week":"2026-W44","score":3490,"ticks":1920,"log":[9,16,45,16,18,1,6,2,3,1,3,2,3,1,3,2,3,2,6,1,6,1,3,1,6,2,3,1,3,2,3,2,3,2,3,2,3,1,3,2,3,1,3,1,3,1,3,1,3,2,6,1,3,2,3,2,3,2,3,1,3,2,3,1,3,2,3,1,3,2,3,2,6,1,3,2,6,1,3,2,3,1,3,1,3,1,3,2,3,1,3,2,3,1,3,2,3,1,3,2,3,1,3,2,3,2,3,2,3,2,3,1,3,1,3,1,3,1,3,2,3,2,3,2,3,2,3,2,3,2,3,2,9,1,3,1,3,1,3,1,3,2,3,1,3,2,3,1,3,2,3,1,3,2,3,2,3,2,3,2,3,1,3,1,3,1,3,1,3,2,3,2,3,2,3,2,3,2,3,2,3,2,3,2,3,2,3,2,3,1,3,1,3,1,3,1,3,2,3,1,3,2,3,2,3,1,3,2,3,1,3,1,6,2,3,1,3,1,3,2,3,2,6,1,3,2,3,1,3,1,3,2,3,1,3,2,3,2,6,1,6,2,3,1,3,2,3,1,3,2,3,1,3,2,3,1,3,2,6,1,3,1,6,2,3,2,3,1,3,2,3,1,3,2,3,1,3,2,3,1,3,2,3,1,3,2,3,1,3,2,3,2,3,1,3,2,6,1,3,1,3,1,3,2,3,1,3,2,3,1,3,2,3,1,3,2,3,1,3,2,6,1,3,2,3,1,3,2,3,1,3,2,6,1,3,2,3,1,3,1,6,2,6,1,6,2,6,1,6,2,3,1,6,2,3,1,3,2,3,1,6,2,3,1,6,2,3,2,3,2,6,1,3,2,3,1,3,2,3,1,3,2,3,1,3,2,3,1,3,2,6,1,3,2,6,1,3,2,6,1,3,2,3,1,3,2,6,1,3,2,3,1,3,1,3,1,3,1,3,2,3,1,3,2,3,1,3,2,3,1,3,2,3,1,3,2,3,2,3,2,3,2,3,1,6,2,3,1,3,2,3,1,3,1,3,1,3,2,3,1,3,2,3,1,3,2,6,1,6,2,3,1,3,2,3,1,3,2,3,1,3,2,3,1,3,2,3,1,3,2,3,1,3,2,3,1,3,2,3,1,3,2,6,1,6,2,3,1,3,2,3,1,3,2,3,2,3,2,3,2,3,2,3,2,3,1,3,1,3,1,3,1,3,2,3,1,3,2,3,2,6,1,3,1,3,2,3,1,6,2,3,1,3,2,3,1,3,2,3,1,6,2,6,1,3,2,6,1,6,2,3,1,3,2,3,1,3,2,3,1,3,2,3,1,3,2,3,2,3,2,3,2,6,1,6,2,3,1,6,1,6,2,3,1,3,2,3,1,3,2,3,1,3,2,3,2,3,2,3,2,3,2,12,1,3,1,3,1,3,1,3,2,3,1,3,2,3,1,3,2,6,1,6,2,3,1,3,1,3,2,3,1,3,2,3,2,3,1,3,2,3,1,3,1,3,1,6,2,3,2,3,2,6,1,3,2,3,1,3,2,3,1,3,1,3,1,3,1,3,1,3,1,3,1,9,2,3,2,3,2,3,2,3,1,3,2,3,1,3,1,3,1,3,1,3,1,3,1,3,2,3,2,3,2,3,2,3,1,3,2,3,1,3,2,3,1,3,1,3,1,3,1,9,2,3,1,3,2,3,2,3,2,3,2,3,1,3,2,3,1,3,1,3,2,3,1,3,2,3,2,3,1,3,1,3,2,6,1,3,2,3,1,3,2,36,16,3,1,3,1,3,1,3,2,3,1,3,2,3,1,3,2,3,2,3,1,3,2,3,1,6,2,3,1,6,2,6,1,6,2,3,1,3,2,3,1,3,2,3,1,3,2,3,1,6,16,3,2,3,2,3,2,3,1,3,2,3,1,3,1,3,1,3,1,9,2,3,2,3,2,3,2,3,1,3,2,3,1,3,1,3,1,3,1,3,2,3,1,3,2,6,2,3,2,3,1,3,2,3,1,3,2,3,1,3,1,3,1,3,1,6,2,3,1,3,2,3,2,3,2,3,2,3,1,3,2,3,1,3,1,3,1,3,2,3,1,3,2,6,2,3,1,3,2,3,1,3,2,3,1,3,2,3,1,3,2,3,1,3,2,3,1,6,2,3,2,12,2,9,1,3,1,3,1,6,2,6,1,3,2,3,2,3,2,6,1,6,2,3,1,3,1,3,1,3,2,3,1,3,2,3,1,3,1,3,1,9,1,3,1,3,1,3,2,3,2,3,2,3,2,3,1,3,2,3,1,3,1,3,1,3,2,3,1,3,2,6,1,3,2,3,2,3,2,3,2,3,2,3,2,3,2,3,2,3,2,3,2,3,2,3,2]}

test('brick: a run recorded on another JavaScript engine replays to the same score', () => {
  const r: any = replay(V8_RUN)
  expect(r.ok).toBe(true)
  expect(r.score).toBe(V8_RUN.score)
  expect(r.matches).toBe(true)
})
