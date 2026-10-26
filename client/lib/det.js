// Maths for game rules that every JavaScript engine computes to the same bit.
//
// The weekly board replays each posted run on a GitHub runner (Node, V8) and
// the player made it inside Claude Code (Bun, JavaScriptCore). Math.sin, cos,
// atan2, hypot and ** may differ in the last bit between engines, and one bit
// is enough for a replay to drift. These use only + - * / and sqrt, which
// IEEE 754 rounds the same way everywhere. Drawing code can keep using Math.

export const PI = Math.PI
const TAU = 2 * PI
const HALF = PI / 2

const S3 = -1 / 6, S5 = 1 / 120, S7 = -1 / 5040, S9 = 1 / 362880
const S11 = -1 / 39916800, S13 = 1 / 6227020800, S15 = -1 / 1307674368000

export function sin(x) {
  let r = x - TAU * Math.round(x / TAU)
  if (r > HALF) r = PI - r
  else if (r < -HALF) r = -PI - r
  const q = r * r
  return r * (1 + q * (S3 + q * (S5 + q * (S7 + q * (S9 + q * (S11 + q * (S13 + q * S15)))))))
}

export function cos(x) {
  return sin(x + HALF)
}

const A3 = -1 / 3, A5 = 1 / 5, A7 = -1 / 7, A9 = 1 / 9, A11 = -1 / 11, A13 = 1 / 13, A15 = -1 / 15

export function atan(z) {
  let sign = 1
  if (z < 0) { z = -z; sign = -1 }
  const inv = z > 1
  if (inv) z = 1 / z
  // two half-angle steps bring z under tan(PI / 16), where the series is short
  z = z / (1 + Math.sqrt(1 + z * z))
  z = z / (1 + Math.sqrt(1 + z * z))
  const q = z * z
  let a = 4 * z * (1 + q * (A3 + q * (A5 + q * (A7 + q * (A9 + q * (A11 + q * (A13 + q * A15)))))))
  if (inv) a = HALF - a
  return sign * a
}

export function atan2(y, x) {
  if (x > 0) return atan(y / x)
  if (x < 0) return y >= 0 ? atan(y / x) + PI : atan(y / x) - PI
  return y > 0 ? HALF : y < 0 ? -HALF : 0
}

export function hypot(x, y) {
  return Math.sqrt(x * x + y * y)
}

/** Ease in and out along a sine, for paths the rules depend on. */
export function inOutSine(t) {
  return (1 - cos(PI * t)) / 2
}
