/**
 * Random playouts, for the built-in bot and for guessing which stones are dead when a game
 * is counted. From a position, both sides play random moves (never filling their own
 * eyes, and taking stones left in atari when they can) until neither has a move left;
 * who owns each point at the end, over many such games, says a lot about the position.
 *
 * Built for speed, on typed arrays, with only simple ko (the real rules, superko and
 * all, are in ./rules; the bot only ever chooses among moves the game says are legal).
 */
import { type Color, neighbors, sizeOf } from "./rules";

const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;
type Stone = 1 | 2;
const toStone = (c: Color): Stone => (c === "b" ? BLACK : WHITE);
const opp = (s: Stone): Stone => (s === BLACK ? WHITE : BLACK);

/** A small fast PRNG (mulberry32), so playouts are cheap and seeded runs repeat. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class FastBoard {
  readonly n: number;
  readonly cells: Uint8Array;
  /** Four neighbors per point, -1 past the edge. */
  readonly nbr: Int32Array;
  ko = -1;
  /** The empty points, in no order, with each point's index in the list (-1 if taken). */
  readonly empties: Int32Array;
  readonly where: Int32Array;
  emptyCount = 0;
  private readonly mark: Int32Array;
  private stamp = 0;
  private readonly stack: Int32Array;
  private readonly found: Int32Array;

  constructor(readonly size: number) {
    const n = size * size;
    this.n = n;
    this.cells = new Uint8Array(n);
    this.nbr = new Int32Array(n * 4).fill(-1);
    const lists = neighbors(size);
    for (let p = 0; p < n; p++) lists[p]!.forEach((q, i) => (this.nbr[p * 4 + i] = q));
    this.empties = new Int32Array(n);
    this.where = new Int32Array(n);
    this.mark = new Int32Array(n);
    this.stack = new Int32Array(n);
    this.found = new Int32Array(n);
  }

  load(board: string) {
    this.ko = -1;
    this.emptyCount = 0;
    for (let p = 0; p < this.n; p++) {
      const c = board[p];
      this.cells[p] = c === "b" ? BLACK : c === "w" ? WHITE : EMPTY;
      if (this.cells[p] === EMPTY) this.addEmpty(p);
      else this.where[p] = -1;
    }
  }

  copyFrom(o: FastBoard) {
    this.cells.set(o.cells);
    this.empties.set(o.empties);
    this.where.set(o.where);
    this.emptyCount = o.emptyCount;
    this.ko = o.ko;
  }

  private addEmpty(p: number) {
    this.where[p] = this.emptyCount;
    this.empties[this.emptyCount++] = p;
  }

  private removeEmpty(p: number) {
    const i = this.where[p]!;
    const last = this.empties[--this.emptyCount]!;
    this.empties[i] = last;
    this.where[last] = i;
    this.where[p] = -1;
  }

  private nextStamp() {
    if (this.stamp > 1e9) {
      this.mark.fill(0);
      this.stamp = 0;
    }
    return ++this.stamp;
  }

  /** Does the chain on `p` have a liberty other than `except`? */
  private hasLiberty(p: number, except: number): boolean {
    const color = this.cells[p];
    const s = this.nextStamp();
    let top = 0;
    this.stack[top++] = p;
    this.mark[p] = s;
    while (top) {
      const q = this.stack[--top]!;
      for (let i = q * 4; i < q * 4 + 4; i++) {
        const r = this.nbr[i]!;
        if (r < 0 || this.mark[r] === s) continue;
        const v = this.cells[r];
        if (v === EMPTY) {
          if (r !== except) return true;
        } else if (v === color) {
          this.mark[r] = s;
          this.stack[top++] = r;
        }
      }
    }
    return false;
  }

  /** The chain on `p`'s only liberty, or -1 if it has none or more than one. */
  lastLiberty(p: number): number {
    const color = this.cells[p];
    const s = this.nextStamp();
    let top = 0;
    let lib = -1;
    this.stack[top++] = p;
    this.mark[p] = s;
    while (top) {
      const q = this.stack[--top]!;
      for (let i = q * 4; i < q * 4 + 4; i++) {
        const r = this.nbr[i]!;
        if (r < 0) continue;
        const v = this.cells[r];
        if (v === EMPTY) {
          if (lib === -1) lib = r;
          else if (lib !== r) return -1;
        } else if (v === color && this.mark[r] !== s) {
          this.mark[r] = s;
          this.stack[top++] = r;
        }
      }
    }
    return lib;
  }

  /** Take the chain on `p` off the board; how many stones. */
  private remove(p: number): number {
    const color = this.cells[p];
    let top = 0;
    let count = 0;
    this.stack[top++] = p;
    this.cells[p] = EMPTY;
    while (top) {
      const q = this.stack[--top]!;
      this.found[count++] = q;
      for (let i = q * 4; i < q * 4 + 4; i++) {
        const r = this.nbr[i]!;
        if (r >= 0 && this.cells[r] === color) {
          this.cells[r] = EMPTY;
          this.stack[top++] = r;
        }
      }
    }
    for (let i = 0; i < count; i++) this.addEmpty(this.found[i]!);
    return count;
  }

  /** A point surrounded by `s` (an eye, or nearly): filling it is never worth it in a playout. */
  isEye(p: number, s: Stone): boolean {
    for (let i = p * 4; i < p * 4 + 4; i++) {
      const r = this.nbr[i]!;
      if (r >= 0 && this.cells[r] !== s) return false;
    }
    // A false eye has enemy stones on its diagonals: one is enough on the edge, two inside.
    const size = this.size;
    const [row, col] = [Math.floor(p / size), p % size];
    let bad = 0;
    let edge = false;
    for (const [dr, dc] of DIAGONALS) {
      const [r, c] = [row + dr, col + dc];
      if (r < 0 || r >= size || c < 0 || c >= size) edge = true;
      else if (this.cells[r * size + c] === opp(s)) bad++;
    }
    return edge ? bad === 0 : bad < 2;
  }

  /** Play `s` on `p` if that's legal (empty, not the ko point, not suicide). */
  play(p: number, s: Stone): boolean {
    if (this.cells[p] !== EMPTY || p === this.ko) return false;
    const o = opp(s);
    let captures = 0;
    let lastCaptured = -1;
    let libertyOrFriend = false;
    for (let i = p * 4; i < p * 4 + 4; i++) {
      const r = this.nbr[i]!;
      if (r < 0) continue;
      const v = this.cells[r];
      if (v === EMPTY) libertyOrFriend = true;
      else if (v === s) {
        if (this.hasLiberty(r, p)) libertyOrFriend = true;
      } else if (v === o && !this.hasLiberty(r, p)) captures++;
    }
    if (!captures && !libertyOrFriend) return false;
    this.cells[p] = s;
    this.removeEmpty(p);
    let taken = 0;
    for (let i = p * 4; i < p * 4 + 4; i++) {
      const r = this.nbr[i]!;
      if (r >= 0 && this.cells[r] === o && !this.hasLiberty(r, -1)) {
        lastCaptured = r;
        taken += this.remove(r);
      }
    }
    // Taking one stone with a lone stone left in atari makes a ko: no taking straight back.
    this.ko = taken === 1 && this.lastLiberty(p) === lastCaptured && this.isLone(p) ? lastCaptured : -1;
    return true;
  }

  private isLone(p: number): boolean {
    const s = this.cells[p];
    for (let i = p * 4; i < p * 4 + 4; i++) {
      const r = this.nbr[i]!;
      if (r >= 0 && this.cells[r] === s) return false;
    }
    return true;
  }

  /** A random sensible move for `s`: take stones in atari by the last move if possible, else any non-eye. -1 to pass. */
  randomMove(s: Stone, last: number, rand: () => number): number {
    if (last >= 0 && rand() < 0.9) {
      for (let i = last * 4; i < last * 4 + 4; i++) {
        const r = this.nbr[i]!;
        if (r >= 0 && this.cells[r] === opp(s)) {
          const lib = this.lastLiberty(r);
          if (lib >= 0 && this.play(lib, s)) return lib;
        }
      }
      // The last stone itself in atari.
      if (this.cells[last] === opp(s)) {
        const lib = this.lastLiberty(last);
        if (lib >= 0 && this.play(lib, s)) return lib;
      }
    }
    const count = this.emptyCount;
    if (!count) return -1;
    const start = Math.floor(rand() * count);
    for (let k = 0; k < count; k++) {
      const p = this.empties[(start + k) % count]!;
      if (!this.isEye(p, s) && this.play(p, s)) return p;
    }
    return -1;
  }

  /** Area score once a playout's done: stones, plus empty points whose neighbors are all one color. */
  score(): number {
    let diff = 0;
    for (let p = 0; p < this.n; p++) {
      const v = this.cells[p];
      if (v === BLACK) diff++;
      else if (v === WHITE) diff--;
      else {
        const o = this.emptyOwner(p);
        diff += o === BLACK ? 1 : o === WHITE ? -1 : 0;
      }
    }
    return diff;
  }

  emptyOwner(p: number): number {
    let seen = 0;
    for (let i = p * 4; i < p * 4 + 4; i++) {
      const r = this.nbr[i]!;
      if (r >= 0) seen |= this.cells[r]!;
    }
    return seen === BLACK || seen === WHITE ? seen : EMPTY;
  }
}

const DIAGONALS: [number, number][] = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

/** Play out `work` (with `toMove` to move) to the end; Black's area minus White's. Records who first played where in `first`. */
function playout(work: FastBoard, toMove: Stone, last: number, rand: () => number, first: Uint8Array | null): number {
  let s = toMove;
  let passes = 0;
  const limit = work.n * 3;
  for (let moves = 0; moves < limit && passes < 2; moves++) {
    const p = work.randomMove(s, last, rand);
    if (p < 0) passes++;
    else {
      passes = 0;
      if (first && !first[p]) first[p] = s;
    }
    last = p;
    s = opp(s);
  }
  return work.score();
}

/** Who owns what after the playouts: per point, +1 always Black's to -1 always White's. */
function addOwnership(work: FastBoard, ownership: Float64Array) {
  for (let p = 0; p < work.n; p++) {
    const v = work.cells[p];
    const o = v === EMPTY ? work.emptyOwner(p) : v;
    if (o === BLACK) ownership[p]! += 1;
    else if (o === WHITE) ownership[p]! -= 1;
  }
}

/** Who ends up owning each point in playouts from here (with `toMove` to move): +1 always Black's to -1 always White's. */
export function estimateOwnership(board: string, toMove: Color, opts: { playouts: number; seed: number }): Float64Array {
  const size = sizeOf(board);
  const root = new FastBoard(size);
  root.load(board);
  const work = new FastBoard(size);
  const ownership = new Float64Array(root.n);
  const rand = rng(opts.seed);
  for (let i = 0; i < opts.playouts; i++) {
    work.copyFrom(root);
    playout(work, toStone(toMove), -1, rand, null);
    addOwnership(work, ownership);
  }
  for (let p = 0; p < root.n; p++) ownership[p]! /= Math.max(1, opts.playouts);
  return ownership;
}

/** Which stones are dead: those that end up mostly the other side's in playouts from here. Points, sorted. */
export function estimateDead(board: string, toMove: Color, opts: { playouts: number; seed: number }): number[] {
  const ownership = estimateOwnership(board, toMove, opts);
  const dead: number[] = [];
  for (let p = 0; p < board.length; p++) {
    if ((board[p] === "b" && ownership[p]! < -0.3) || (board[p] === "w" && ownership[p]! > 0.3)) dead.push(p);
  }
  return dead;
}

export interface MoveStats {
  point: number;
  visits: number;
  winRate: number;
  value: number;
}

/**
 * The move to play: the best-looking among those tried at least half as often as the
 * most tried (with few playouts per move, as on big boards, visits alone are mostly ties).
 */
export function pickBest(stats: MoveStats[]): MoveStats {
  const most = Math.max(...stats.map((s) => s.visits));
  return stats.filter((s) => s.visits >= most / 2).reduce((a, b) => (b.value > a.value ? b : a));
}

export interface SearchResult {
  /** The point to play (the one tried most), or null if there was none. */
  move: number | null;
  /** The chance of winning with it, by the playouts. */
  winRate: number;
  /** Every candidate: how often it was tried, how often it won, and how good it looks counting RAVE. */
  stats: MoveStats[];
  /** Per point, +1 (Black's in every playout) to -1 (White's in every one). */
  ownership: Float64Array;
}

/**
 * Pick a move for `toMove` among `candidates` (legal points): many playouts, each
 * starting with the candidate that looks best so far (UCB), counting also what any
 * candidate's point did when played later in a playout (RAVE), which makes few
 * playouts go much further. Stops after `playouts` or `timeMs`, whichever comes first.
 */
export function search(
  board: string,
  toMove: Color,
  candidates: number[],
  opts: { komi: number; playouts: number; timeMs: number; seed: number; lastMove?: number | null },
): SearchResult {
  const size = sizeOf(board);
  const root = new FastBoard(size);
  root.load(board);
  const me = toStone(toMove);
  const work = new FastBoard(size);
  const ownership = new Float64Array(root.n);
  const rand = rng(opts.seed);
  // Never fill your own eyes.
  const moves = candidates.filter((p) => !root.isEye(p, me));
  const k = moves.length;
  const visits = new Float64Array(k);
  const wins = new Float64Array(k);
  const amafVisits = new Float64Array(k);
  const amafWins = new Float64Array(k);
  const first = new Uint8Array(root.n);
  const won = (diff: number) => (me === BLACK ? diff - opts.komi > 0 : diff - opts.komi < 0);
  const start = typeof performance !== "undefined" ? performance.now() : Date.now();
  const elapsed = () => (typeof performance !== "undefined" ? performance.now() : Date.now()) - start;

  let total = 0;
  let passWins = 0;
  for (; total < opts.playouts; total++) {
    if (total % 64 === 63 && elapsed() > opts.timeMs) break;
    work.copyFrom(root);
    first.fill(0);
    let pick = -1;
    if (k) {
      let best = -Infinity;
      const logN = Math.log(total + 1);
      for (let i = 0; i < k; i++) {
        let v: number;
        if (!visits[i] && !amafVisits[i]) v = 10 + rand();
        else {
          const beta = Math.sqrt(1000 / (3 * visits[i]! + 1000));
          const mean = visits[i] ? wins[i]! / visits[i]! : 0.5;
          const amaf = amafVisits[i] ? amafWins[i]! / amafVisits[i]! : 0.5;
          v = (1 - beta) * mean + beta * amaf + 0.4 * Math.sqrt(logN / (visits[i]! + 1));
        }
        if (v > best) [best, pick] = [v, i];
      }
      work.play(moves[pick]!, me);
      first[moves[pick]!] = me;
    }
    const diff = playout(work, opp(me), k ? moves[pick]! : (opts.lastMove ?? -1), rand, first);
    const w = won(diff) ? 1 : 0;
    addOwnership(work, ownership);
    if (pick < 0) {
      passWins += w;
      continue;
    }
    visits[pick]!++;
    wins[pick]! += w;
    for (let i = 0; i < k; i++) {
      if (first[moves[i]!] === me) {
        amafVisits[i]!++;
        amafWins[i]! += w;
      }
    }
  }
  for (let p = 0; p < root.n; p++) ownership[p]! /= Math.max(1, total);
  if (!k) return { move: null, winRate: total ? passWins / total : 0.5, stats: [], ownership };
  const stats = moves.map((point, i) => {
    const beta = Math.sqrt(1000 / (3 * visits[i]! + 1000));
    const mean = visits[i] ? wins[i]! / visits[i]! : 0.5;
    const amaf = amafVisits[i] ? amafWins[i]! / amafVisits[i]! : 0.5;
    return { point, visits: visits[i]!, winRate: mean, value: (1 - beta) * mean + beta * amaf };
  });
  const best = pickBest(stats);
  return { move: best.point, winRate: best.winRate, stats, ownership };
}
