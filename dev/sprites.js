// Sprite sheet preview for the harness: every Pip frame on three backgrounds.
import { Canvas, encode, tree } from '../client/lib/gfx.js'
import { C, PIP } from '../client/lib/palette.js'
import * as P from '../client/lib/pip.js'

export default function Sheet(props, surface) {
  const cv = new Canvas(surface.columns, surface.rows * 2, C.night)
  const bgs = [C.night, C.snow, C.soil]
  const sets = [P.FRONT, P.BLINK, P.CHEER, P.MINER, ...P.WALK, P.JUMP, P.SLIDE, P.TINY, P.TINY_STEP, P.TINY_HOP]
  const bandH = Math.floor(cv.h / 3)
  bgs.forEach((bg, b) => {
    cv.rect(0, b * bandH, cv.w, bandH, bg)
    let x = 2
    for (const s of sets) {
      cv.sprite(s, PIP, x, b * bandH + 3)
      x += s[0].length + 2
    }
  })
  return tree(surface.elements, encode(cv))
}
