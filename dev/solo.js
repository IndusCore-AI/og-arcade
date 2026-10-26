// Dev viewer: one game at the field size, played through sim.js, for the
// browser harness. ?m=./solo.js&props={"game":"snake"}&cols=72&rows=20
// window.H.state.run holds the run (world, tick, log); .ev the last events.

import { Canvas, encode, tree } from '../client/lib/gfx.js'
import { C } from '../client/lib/palette.js'
import * as J from '../client/lib/juice.js'
import { GAMES, FIELD, DT, newRun, step, mask, weekOf } from '../client/sim.js'

const KEYS = { left: 'left', a: 'left', right: 'right', d: 'right', up: 'up', w: 'up', down: 'down', s: 'down', space: 'action', ' ': 'action', return: 'action', x: 'alt', z: 'alt' }

export default function Solo(props, surface) {
  if (surface.state === undefined) {
    const S = { run: newRun(props.game || 'snake', props.week || weekOf(Date.now())), fx: J.makeFx(), q: [], t: 0, ev: [], events: [] }
    surface.setState(S)
    surface.every(33, () => {
      S.t += DT
      const acts = []
      const rest = []
      for (const k of S.q.splice(0)) {
        const a = KEYS[k]
        if (!a) continue
        if (acts.includes(a)) rest.push(k)
        else acts.push(a)
      }
      S.q.push(...rest)
      if (S.fx.stop > 0) {
        S.fx.stop -= DT
        S.q.unshift(...acts.map(a => Object.keys(KEYS).find(k => KEYS[k] === a)))
      } else {
        const ev = step(S.run, mask(acts), S.fx)
        if (ev.length) { S.ev = ev; S.events.push(...ev) }
      }
      J.stepFx(S.fx, DT)
      surface.setState(S)
    })
    surface.onKey(k => { S.q.push(k.key); surface.setState(S) })
  }
  const S = surface.state
  const cv = new Canvas(FIELD.w, FIELD.h, C.night)
  const off = J.offset(S.fx)
  cv.ox = off.x
  cv.oy = off.y
  GAMES[S.run.game].draw(S.run.world, cv, S.fx, S.t)
  J.drawFx(S.fx, cv)
  return tree(surface.elements, encode(cv))
}
