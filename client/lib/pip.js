// Pip, the arcade's little blue penguin. Sprites are rows of palette letters
// (see PIP in palette.js); '.' is transparent. Side views face right; draw
// them flipped to face left.

// Front, 10 x 11: menus, the pause card, celebrations
export const FRONT = [
  '...BBBB...',
  '..BHBBBB..',
  '.BHWWWWBB.',
  '.BWKWWKWB.',
  '.BWWOOWWB.',
  '.BPWWWWPB.',
  'DBBWWWWBBD',
  'DBBWWWWBBD',
  '.DBWWSWBD.',
  '..BBWWBB..',
  '..FF..FF..',
]

// Front with eyes closed and flippers up: "yay"
export const CHEER = [
  'D..BBBB..D',
  'DBBHBBBBBD',
  '.BHWWWWBB.',
  '.BWKWWKWB.',
  '.BWWOOWWB.',
  '.BPWWWWPB.',
  '..BWWWWB..',
  '..BWWWWB..',
  '..BWWSWB..',
  '..BBWWBB..',
  '..FF..FF..',
]

// Blink frame for idle animation
export const BLINK = FRONT.map((r, i) => (i === 3 ? '.BWWWWWWB.' : r))

// Side, 9 x 10, facing right. Four-frame waddle.
const SIDE_HEAD = [
  '..BBBB...',
  '.BHBBBB..',
  '.BBBWWB..',
  'BBBWKWOO.',
  'BBBWWWOOO',
  'BBBBWWB..',
]
export const WALK = [
  [...SIDE_HEAD, 'BDDBWWW..', '.BDBWWW..', '..BBWW...', '..F..F...'],
  [...SIDE_HEAD, 'BDDBWWW..', '.BDBWWW..', '..BBWW...', '...FF....'],
  [...SIDE_HEAD, 'BDDBWWW..', '.BDBWWW..', '..BBWW...', '.F...F...'],
  [...SIDE_HEAD, 'BDDBWWW..', '.BDBWWW..', '..BBWW...', '...FF....'],
]
// Mid-jump: flippers out, feet tucked
export const JUMP = [
  ...SIDE_HEAD.slice(0, 5),
  'DBBBWWB..',
  'D.DBWWW..',
  '..BBWWW..',
  '..BBWW...',
  '..FFF....',
]
// Belly slide, 11 x 5: the runner's dash
export const SLIDE = [
  '...BBBBB...',
  '.BBBBWWKBOO',
  'DDBBWWWWWOO',
  '.BBWWWWWW..',
  'FF.........',
]

// Tiny Pip, 7 x 6, for the reading lane above a line of text
export const TINY = [
  '..BBB..',
  '.BWKWK.',
  '.BWOOW.',
  'DBWWWBD',
  '.BWWWB.',
  '.F...F.',
]
export const TINY_STEP = [
  '..BBB..',
  '.BWKWK.',
  '.BWOOW.',
  'DBWWWBD',
  '.BWWWB.',
  '..F.F..',
]
export const TINY_HOP = [
  '..BBB..',
  'DBWKWKD',
  '.BWOOW.',
  '.BWWWB.',
  '.BWWWB.',
  '..FF...',
]

// Miner Pip for Claw Rush: helmet with a lamp, 10 x 11, facing front
export const MINER = [
  '..RRRRR...',
  '.RRRYRRR..',
  'RRRRRRRRR.',
  '.BWKWWKWB.',
  '.BWWOOWWB.',
  '.BPWWWWPB.',
  'DBBWWWWBBD',
  'DBBWWWWBBD',
  '.DBWWSWBD.',
  '..BBWWBB..',
  '..FF..FF..',
]
