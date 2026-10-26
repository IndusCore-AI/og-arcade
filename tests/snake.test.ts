import { expect, test } from 'claude-code/testing'

import * as snake from '../client/games/snake.js'
import { makeFx } from '../client/lib/juice.js'

const DT = 1 / 30
const COLS = 36

/** A world that has started and stands still, so turns can be queued without moving. */
function frozen(seed = 1234) {
  const w = snake.create(72, 40, seed)
  const fx = makeFx()
  snake.update(w, DT, ['action'], fx)
  expect(w.phase).toBe('play')
  w.speed = 0
  w.acc = 0
  return { w, fx }
}

/** Takes exactly one step on the next update. */
function stepOnce(w: any, fx: any, input: string[] = []) {
  w.speed = 250
  w.acc = 999
  const ev = snake.update(w, DT, input, fx)
  w.speed = 0
  w.acc = 0
  return ev
}

test('snake: a turn that repeats or reverses the last one queued is dropped', () => {
  const { w, fx } = frozen()
  expect(w.dir).toBe(0) // heading right
  snake.update(w, DT, ['left'], fx) // straight back into itself
  snake.update(w, DT, ['right'], fx) // already going that way
  expect(w.queue).toEqual([])
  snake.update(w, DT, ['up'], fx)
  snake.update(w, DT, ['down'], fx) // reverses the queued up
  snake.update(w, DT, ['left'], fx)
  snake.update(w, DT, ['right'], fx) // reverses the queued left
  snake.update(w, DT, ['down'], fx)
  snake.update(w, DT, ['right'], fx) // the queue holds three
  expect(w.queue).toEqual([3, 2, 1])
  // one turn is used per step
  stepOnce(w, fx)
  expect(w.dir).toBe(3)
  expect(w.queue).toEqual([2, 1])
})

test('snake: eating a fish scores, grows the snake by two and speeds it up', () => {
  const { w, fx } = frozen()
  const len = w.body.length
  w.fish = w.body[0] + 1
  w.speed = 250
  w.acc = 999
  const ev = snake.update(w, DT, [], fx)
  expect(ev).toContain('eat')
  expect(w.score).toBe(10)
  expect(w.eaten).toBe(1)
  expect(w.speed).toBeGreaterThan(250)
  expect(w.body.includes(w.fish)).toBe(false)
  stepOnce(w, fx)
  stepOnce(w, fx)
  expect(w.body.length).toBe(len + 2)
  stepOnce(w, fx)
  expect(w.body.length).toBe(len + 2)
})

test('snake: running into the wall ends the run with exactly one over', () => {
  const { w, fx } = frozen()
  w.body = [1 * COLS + 34, 1 * COLS + 33, 1 * COLS + 32, 1 * COLS + 31]
  w.fish = 15 * COLS + 5
  const first = stepOnce(w, fx)
  expect(first).toContain('die')
  expect(w.phase).toBe('dying')
  const events: string[] = [...first]
  for (let i = 0; i < 90; i++) events.push(...snake.update(w, DT, ['up'], fx))
  expect(events.filter(e => e === 'over').length).toBe(1)
  expect(events.filter(e => e === 'die').length).toBe(1)
  expect(w.phase).toBe('over')
  expect(snake.overTitle(w)).toBe('Ouch, a wall')
})

test('snake: biting the tail ends the run, but the cell the tail is leaving is safe', () => {
  const { w, fx } = frozen()
  // a tight square: head at (10,10) heading up, tail right behind at (11,10)
  w.body = [10 * COLS + 10, 11 * COLS + 10, 11 * COLS + 11, 10 * COLS + 11]
  w.dir = 3
  w.fish = 15 * COLS + 5
  w.queue = [0]
  w.grow = 0
  expect(stepOnce(w, fx)).not.toContain('die') // the tail moves out of the way
  w.body = [10 * COLS + 10, 11 * COLS + 10, 11 * COLS + 11, 10 * COLS + 11, 9 * COLS + 11]
  w.dir = 3
  w.queue = [0]
  w.phase = 'play'
  expect(stepOnce(w, fx)).toContain('die')
  expect(snake.overTitle(w)).toBe('Tail bite')
})

test('snake: a golden fish comes with every fifth fish and is gone after six seconds', () => {
  const { w, fx } = frozen()
  w.eaten = 4
  w.fish = w.body[0] + 1
  const ev = stepOnce(w, fx)
  expect(ev).toContain('faster')
  expect(w.tier).toBe(2)
  expect(w.gold).not.toBeNull()
  expect(w.gold.left).toBe(180)
  expect(w.gold.at).not.toBe(w.fish)
  for (let i = 0; i < 179; i++) snake.update(w, DT, [], fx)
  expect(w.gold).not.toBeNull()
  snake.update(w, DT, [], fx)
  expect(w.gold).toBeNull()
})

test('snake: the same seed lays out the same maze and fish', () => {
  const a = snake.create(72, 40, 99)
  const b = snake.create(72, 40, 99)
  expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  expect(snake.mazes.length).toBe(5)
  // every maze keeps the start lane clear
  for (let seed = 0; seed < 40; seed++) {
    const w = snake.create(72, 40, seed)
    for (let x = 9; x <= 26; x++) expect(w.grid[9 * COLS + x]).toBe('.')
  }
})
