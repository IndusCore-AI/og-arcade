// Records one bot run per game with Node (V8, what the board's verifier runs)
// into tests/fixtures/runs.js. The tests replay them under Claude Code's own
// engine, so a rule that drifts between engines fails there. Regenerate after
// bumping RULES or changing a game: node dev/make-fixtures.mjs
import { writeFileSync } from 'node:fs'
import { ORDER, newRun, step, record } from '../client/sim.js'
import { makeFx } from '../client/lib/juice.js'

const out = []
for (const game of ORDER) {
  let s = 1 + ORDER.indexOf(game)
  const r = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const run = newRun(game, '2026-W44')
  const fx = makeFx()
  while (!run.done && run.tick < 30 * 60 * 20) {
    let m = 0
    if (r() < 0.14) m |= 1 << Math.floor(r() * 6)
    step(run, m, fx)
  }
  if (!run.done) throw new Error(game + ': the bot run never ended')
  out.push(record(run))
  console.log(game, 'score', out[out.length - 1].score, 'ticks', run.tick, 'keys', out[out.length - 1].log.length / 2)
}
writeFileSync(new URL('../tests/fixtures/runs.js', import.meta.url), '// Written by dev/make-fixtures.mjs on Node. Do not edit.\nexport default ' + JSON.stringify(out) + '\n')
