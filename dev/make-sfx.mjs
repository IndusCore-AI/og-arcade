// Synthesizes the arcade's sound effects as small 16-bit mono WAV files.
// Every sound is made here from oscillators and noise, so nothing is borrowed.
// Run: node dev/make-sfx.mjs

import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const RATE = 22050
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'sfx')
mkdirSync(out, { recursive: true })

let seed = 7
const noise = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return (seed / 0x7fffffff) * 2 - 1
}
const osc = {
  sine: p => Math.sin(2 * Math.PI * p),
  square: p => (p % 1 < 0.5 ? 1 : -1) * 0.6,
  tri: p => 1 - 4 * Math.abs((p % 1) - 0.5),
  noise: () => noise(),
}

/** One voice: freq (Hz or fn of t), wave, duration (s), decay shape. */
function voice({ f, f2, wave = 'square', dur, vol = 0.5, attack = 0.004, decay = 'exp', delay = 0 }) {
  const n = Math.floor((dur + delay) * RATE)
  const buf = new Float32Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / RATE - delay
    if (t < 0) continue
    const k = t / dur
    const freq = f2 !== undefined ? f + (f2 - f) * k : f
    phase += freq / RATE
    let env = Math.min(1, t / attack)
    env *= decay === 'exp' ? Math.exp(-4.5 * k) : decay === 'lin' ? 1 - k : 1
    buf[i] = osc[wave](phase) * env * vol
  }
  return buf
}

function mix(...bufs) {
  const n = Math.max(...bufs.map(b => b.length))
  const o = new Float32Array(n)
  for (const b of bufs) for (let i = 0; i < b.length; i++) o[i] += b[i]
  return o
}

function lowpass(buf, a) {
  let y = 0
  return buf.map(x => (y += a * (x - y)))
}

function wav(name, buf, gain = 1) {
  const fade = Math.min(200, buf.length >> 2)
  const pcm = new Int16Array(buf.length)
  for (let i = 0; i < buf.length; i++) {
    let v = buf[i] * gain
    if (i > buf.length - fade) v *= (buf.length - i) / fade
    pcm[i] = Math.max(-1, Math.min(1, v)) * 32000
  }
  const data = Buffer.from(pcm.buffer)
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8)
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36); h.writeUInt32LE(data.length, 40)
  writeFileSync(join(out, name + '.wav'), Buffer.concat([h, data]))
}

const note = n => 440 * 2 ** ((n - 69) / 12) // MIDI to Hz
const seq = (notes, step, opts) => mix(...notes.map((n, i) => voice({ f: note(n), dur: step * (i === notes.length - 1 ? 2.2 : 1.1), delay: i * step, ...opts })))

wav('tick', voice({ f: 1400, wave: 'square', dur: 0.03, vol: 0.25 }))
wav('grab', mix(voice({ f: 880, wave: 'sine', dur: 0.16, vol: 0.4 }), voice({ f: 1320, wave: 'sine', dur: 0.12, vol: 0.25 }), voice({ f: 2400, wave: 'noise', dur: 0.02, vol: 0.15 })))
wav('thud', mix(voice({ f: 110, f2: 60, wave: 'sine', dur: 0.2, vol: 0.7 }), lowpass(voice({ f: 0, wave: 'noise', dur: 0.12, vol: 0.5 }), 0.15)))
wav('coin', mix(voice({ f: note(83), wave: 'square', dur: 0.07, vol: 0.3, decay: 'none' }), voice({ f: note(88), wave: 'square', dur: 0.22, vol: 0.3, delay: 0.07 })))
wav('jackpot', seq([84, 88, 91, 96], 0.07, { wave: 'square', vol: 0.28 }))
wav('boom', mix(lowpass(voice({ f: 0, wave: 'noise', dur: 0.7, vol: 0.9 }), 0.09), voice({ f: 120, f2: 35, wave: 'sine', dur: 0.5, vol: 0.8 })), 1.1)
wav('bonus', voice({ f: 400, f2: 1300, wave: 'square', dur: 0.26, vol: 0.28, decay: 'lin' }))
wav('clear', seq([79, 84, 88, 91], 0.1, { wave: 'square', vol: 0.26 }))
wav('over', seq([67, 64, 60], 0.16, { wave: 'tri', vol: 0.45 }))
wav('hit', lowpass(voice({ f: 0, wave: 'noise', dur: 0.06, vol: 0.5 }), 0.4))
wav('pop', voice({ f: 600, f2: 1500, wave: 'sine', dur: 0.08, vol: 0.45 }))
wav('hurt', voice({ f: 620, f2: 180, wave: 'square', dur: 0.22, vol: 0.3, decay: 'lin' }))
wav('warn', mix(voice({ f: 880, wave: 'square', dur: 0.14, vol: 0.22, decay: 'none' }), voice({ f: 660, wave: 'square', dur: 0.14, vol: 0.22, decay: 'none', delay: 0.16 }), voice({ f: 880, wave: 'square', dur: 0.14, vol: 0.22, decay: 'none', delay: 0.32 }), voice({ f: 660, wave: 'square', dur: 0.16, vol: 0.22, delay: 0.48 })))
wav('jump', voice({ f: 320, f2: 760, wave: 'square', dur: 0.12, vol: 0.22, decay: 'lin' }))
wav('start', seq([72, 76, 79], 0.06, { wave: 'square', vol: 0.22 }))
// Claude needs you: two soft bell notes, down a fourth, easy to notice and never harsh
wav('needs', mix(voice({ f: note(88), wave: 'sine', dur: 0.5, vol: 0.4 }), voice({ f: note(83), wave: 'sine', dur: 0.8, vol: 0.4, delay: 0.18 }), voice({ f: note(100), wave: 'sine', dur: 0.2, vol: 0.06 })))
// Claude is done: the same bell going up
wav('done', mix(voice({ f: note(84), wave: 'sine', dur: 0.4, vol: 0.38 }), voice({ f: note(91), wave: 'sine', dur: 0.8, vol: 0.38, delay: 0.14 })))
console.log('wrote', out)
