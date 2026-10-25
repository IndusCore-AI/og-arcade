// One palette for the whole arcade, so the games feel like one place.
// Built on PICO-8's 16 colours and its 16 "secret" ones, with a few named
// stops for gradients. Values are 0xRRGGBB.

export const C = {
  // night and ink
  void: 0x07091a,
  night: 0x0d1330,
  deep: 0x111d35,
  navy: 0x1d2b53,
  indigo: 0x29366f,
  dusk: 0x422136,
  plum: 0x7e2553,

  // blues
  blue: 0x3b5dc9,
  blueHi: 0x5f86ec,
  sky: 0x29adff,
  sky2: 0x41a6f6,
  cyan: 0x73eff7,
  ice: 0xc7f1ff,

  // neutrals
  white: 0xfff1e8,
  snow: 0xf7f7f7,
  mist: 0xc2c3c7,
  slate: 0x94b0c2,
  stone: 0x83769c,
  steel: 0x566c86,
  iron: 0x333c57,
  coal: 0x1e2030,
  smoke: 0x5f574f,

  // warm
  yellow: 0xffec27,
  butter: 0xffe28a,
  gold: 0xffcd75,
  amber: 0xffa300,
  orange: 0xff6c24,
  coral: 0xff6e59,
  peach: 0xffccaa,
  pink: 0xff77a8,
  rose: 0xff9d81,
  red: 0xff004d,
  crimson: 0xbe1250,

  // greens
  lime: 0xa8e72c,
  green: 0x00e436,
  leaf: 0x00b543,
  pine: 0x008751,
  teal: 0x125359,

  // earth
  sand: 0xa28879,
  clay: 0xab5236,
  rust: 0x742f29,
  bark: 0x49333b,
  soil: 0x291814,
}

// Pip, a little blue penguin
export const PIP = {
  B: C.blue, // body
  H: C.blueHi, // rim light
  D: C.indigo, // body shade, flippers
  W: C.white, // face and belly
  S: C.mist, // belly shade
  K: C.deep, // eyes
  O: C.amber, // beak
  F: C.orange, // feet
  P: C.pink, // cheeks
  Y: C.yellow, // helmet lamp
  R: C.red,
  G: C.gold,
  L: C.butter,
  N: C.navy,
}
