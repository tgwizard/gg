/**
 * The search behind the built-in bot: negamax with alpha-beta (principal variation
 * search), iterative deepening on a time budget, a transposition table and move ordering.
 *
 * The board lives in typed arrays, column by column from the bottom (cell = column ×
 * rows + row, row 0 the bottom), with a count of each side's discs in every possible
 * line of four (a "window"), kept up to date as discs go in and come out. From those:
 *
 *   - a win now, and the other side's wins next move, are found without searching (one
 *     to block is played without using up depth, two can't both be blocked);
 *   - a move right under a spot where the other side would complete four is never played
 *     (it hands them the win), unless nothing else is left;
 *   - the evaluation at the leaves adds up the windows still open to one side (more
 *     discs in them count for more, and middle cells are in more windows), and the
 *     threats: empty spots that would complete four. A threat counts for more on a row
 *     of the right parity (with an even number of rows, the starting side wants odd rows
 *     from the bottom and the other side even ones: zugzwang decides who must fill the
 *     spot under it), nothing above a threat of the other side's in the same column, and
 *     a lot when two of one side's are stacked.
 *
 * Scores are from the side to move's point of view. A win is WIN minus the number of
 * discs on the board when it happens, so the quickest win and the slowest loss are
 * preferred, and the score of a position doesn't depend on where the search started
 * (it's safe in the transposition table).
 */

export const WIN = 1_000_000;
/** Scores beyond this are wins or losses, not evaluations. */
export const DECIDED = WIN - 100;

/** What `search` finds. */
export interface SearchResult {
  /** 0-based column. */
  column: number;
  score: number;
  /** The deepest search completed (in moves). */
  depth: number;
  nodes: number;
  /** Searched to the end of the game: the score is exact. */
  solved: boolean;
}

export interface SearchOptions {
  maxDepth: number;
  /** Stop deepening after this long (a search in progress is cut short and dropped). */
  timeMs: number;
  /**
   * For variety: pick at random among the moves within this much of the best (by a
   * null-window test at the depth searched), as long as no win or loss is in sight.
   */
  margin?: number;
  rand?: (maxExclusive: number) => number;
  /** Use the transposition table (off for quick searches, which don't need it). */
  table?: boolean;
}

/** Window weights by the number of one side's discs in a window the other side hasn't touched. */
const WINDOW = [0, 1, 3, 9];
/** A threat on a row of the right parity, and on the wrong one (tuned in bot-against-bot matches). */
const GOOD_THREAT = 100;
const BAD_THREAT = 6;
/** Two threats of one side, one above the other. */
const STACKED = 50;

/** Everything that depends only on the board's size. */
interface Geometry {
  W: number;
  H: number;
  N: number;
  windows: number;
  /** Four cells per window. */
  cellsOf: Int16Array;
  /** The windows each cell is in: `winList[winStart[cell] .. winStart[cell + 1]]`. */
  winStart: Int32Array;
  winList: Int16Array;
  /** Zobrist keys: [side × N + cell], two 32-bit halves. */
  zob1: Int32Array;
  zob2: Int32Array;
  /** Columns from the middle out. */
  order: number[];
}

const geometries = new Map<string, Geometry>();

function geometry(W: number, H: number): Geometry {
  const key = `${W}x${H}`;
  let g = geometries.get(key);
  if (g) return g;
  const N = W * H;
  const wins: number[][] = [];
  const dirs = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];
  for (let c = 0; c < W; c++) {
    for (let r = 0; r < H; r++) {
      for (const [dc, dr] of dirs) {
        const [c3, r3] = [c + 3 * dc!, r + 3 * dr!];
        if (c3 < 0 || c3 >= W || r3 < 0 || r3 >= H) continue;
        wins.push([0, 1, 2, 3].map((k) => (c + k * dc!) * H + (r + k * dr!)));
      }
    }
  }
  const cellsOf = new Int16Array(wins.flat());
  const per: number[][] = Array.from({ length: N }, () => []);
  wins.forEach((cells, w) => cells.forEach((cell) => per[cell]!.push(w)));
  const winStart = new Int32Array(N + 1);
  for (let i = 0; i < N; i++) winStart[i + 1] = winStart[i]! + per[i]!.length;
  const winList = new Int16Array(per.flat());
  // A fixed seed: the same keys every time, so searches are repeatable.
  let s = 0x9e3779b9 ^ (W * 31 + H);
  const next = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) | 0;
  };
  const zob1 = new Int32Array(2 * N).map(next);
  const zob2 = new Int32Array(2 * N).map(next);
  const mid = (W - 1) / 2;
  const order = Array.from({ length: W }, (_, c) => c).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b);
  g = { W, H, N, windows: wins.length, cellsOf, winStart, winList, zob1, zob2, order };
  geometries.set(key, g);
  return g;
}

/** The window score from x's side for x and o counts, as [x × 5 + o]. */
const VALUE = new Int32Array(25);
for (let x = 0; x <= 4; x++) for (let o = 0; o <= 4; o++) VALUE[x * 5 + o] = o === 0 ? (WINDOW[x] ?? 0) : x === 0 ? -(WINDOW[o] ?? 0) : 0;

// The transposition table, shared by every search (cleared at the start of each).
const TT_BITS = 18;
const TT_SIZE = 1 << TT_BITS;
const TT_MASK = TT_SIZE - 1;
const EXACT = 1;
const LOWER = 2;
const UPPER = 3;
let tt: { check: Int32Array; score: Int32Array; depth: Int8Array; flag: Int8Array; move: Int8Array } | null = null;

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export class Position {
  readonly g: Geometry;
  readonly cells: Int8Array;
  readonly height: Int8Array;
  /** Discs of x (0) and o (1) in each window. */
  readonly cnt0: Int8Array;
  readonly cnt1: Int8Array;
  /** 0: x to move, 1: o. */
  side = 0;
  discs = 0;
  /** The window part of the evaluation, from x's side. */
  windowScore = 0;
  h1 = 0;
  h2 = 0;

  // Search state.
  private nodes = 0;
  private deadline = Infinity;
  private stopped = false;
  private useTable = true;
  private readonly history: Int32Array;
  private readonly threatX: Int32Array;
  private readonly threatO: Int32Array;
  private stamp = 0;
  /** Move lists, one per ply: W columns each, and their ordering scores. */
  private readonly moveBuf: Int8Array;
  private readonly scoreBuf: Int32Array;

  constructor(W: number, H: number) {
    this.g = geometry(W, H);
    this.cells = new Int8Array(this.g.N);
    this.height = new Int8Array(W);
    this.cnt0 = new Int8Array(this.g.windows);
    this.cnt1 = new Int8Array(this.g.windows);
    this.history = new Int32Array(2 * this.g.N);
    this.threatX = new Int32Array(this.g.N);
    this.threatO = new Int32Array(this.g.N);
    this.moveBuf = new Int8Array((this.g.N + 2) * W);
    this.scoreBuf = new Int32Array((this.g.N + 2) * W);
  }

  /** A position from the board as games keep it: rows from the top, "x", "o" and ".". */
  static fromBoard(board: string, columns: number, rows: number): Position {
    const pos = new Position(columns, rows);
    // Drop each column's discs in from the bottom; the counts settle the side to move.
    const stacks = Array.from({ length: columns }, (_, c) => {
      const stack: number[] = [];
      for (let r = rows - 1; r >= 0; r--) {
        const cell = board[r * columns + c];
        if (cell === "x") stack.push(0);
        else if (cell === "o") stack.push(1);
        else break;
      }
      return stack;
    });
    for (let c = 0; c < columns; c++) for (const p of stacks[c]!) pos.place(c, p);
    let x = 0;
    for (const ch of board) if (ch === "x") x++;
    pos.side = x * 2 === pos.discs ? 0 : 1;
    return pos;
  }

  /** Put a disc of `p` on column `c` without touching whose move it is. */
  private place(c: number, p: number) {
    const { H, winStart, winList, N } = this.g;
    const cell = c * H + this.height[c]!;
    this.cells[cell] = p + 1;
    this.height[c]!++;
    this.discs++;
    const mine = p ? this.cnt1 : this.cnt0;
    let ws = this.windowScore;
    for (let j = winStart[cell]!, end = winStart[cell + 1]!; j < end; j++) {
      const w = winList[j]!;
      const a = this.cnt0[w]!;
      const b = this.cnt1[w]!;
      ws += (p ? VALUE[a * 5 + b + 1]! : VALUE[(a + 1) * 5 + b]!) - VALUE[a * 5 + b]!;
      mine[w]!++;
    }
    this.windowScore = ws;
    this.h1 ^= this.g.zob1[p * N + cell]!;
    this.h2 ^= this.g.zob2[p * N + cell]!;
  }

  play(c: number) {
    this.place(c, this.side);
    this.side ^= 1;
  }

  undo(c: number) {
    this.side ^= 1;
    const p = this.side;
    const { H, winStart, winList, N } = this.g;
    this.height[c]!--;
    const cell = c * H + this.height[c]!;
    this.cells[cell] = 0;
    this.discs--;
    const mine = p ? this.cnt1 : this.cnt0;
    let ws = this.windowScore;
    for (let j = winStart[cell]!, end = winStart[cell + 1]!; j < end; j++) {
      const w = winList[j]!;
      mine[w]!--;
      const a = this.cnt0[w]!;
      const b = this.cnt1[w]!;
      ws += VALUE[a * 5 + b]! - (p ? VALUE[a * 5 + b + 1]! : VALUE[(a + 1) * 5 + b]!);
    }
    this.windowScore = ws;
    this.h1 ^= this.g.zob1[p * N + cell]!;
    this.h2 ^= this.g.zob2[p * N + cell]!;
  }

  /** Would a disc of `p` on `cell` (empty) complete four? */
  completes(cell: number, p: number): boolean {
    const { winStart, winList } = this.g;
    const mine = p ? this.cnt1 : this.cnt0;
    for (let j = winStart[cell]!, end = winStart[cell + 1]!; j < end; j++) if (mine[winList[j]!] === 3) return true;
    return false;
  }

  /** Does dropping a disc of `p` in column `c` (with room) win? */
  wins(c: number, p: number): boolean {
    return this.completes(c * this.g.H + this.height[c]!, p);
  }

  /** The other side wins at once if they get the spot above column `c`'s next disc. */
  givesAway(c: number, p: number): boolean {
    const h = this.height[c]!;
    return h + 1 < this.g.H && this.completes(c * this.g.H + h + 1, p ^ 1);
  }

  // --- evaluation ---------------------------------------------------------------

  /** The static evaluation, for the side to move. */
  evaluate(): number {
    const { W, H, windows, cellsOf } = this.g;
    const stamp = ++this.stamp;
    const { cnt0, cnt1, cells, threatX, threatO } = this;
    for (let w = 0; w < windows; w++) {
      const a = cnt0[w]!;
      const b = cnt1[w]!;
      if (a === 3 && b === 0) {
        for (let k = w * 4; k < w * 4 + 4; k++) if (cells[cellsOf[k]!] === 0) threatX[cellsOf[k]!] = stamp;
      } else if (b === 3 && a === 0) {
        for (let k = w * 4; k < w * 4 + 4; k++) if (cells[cellsOf[k]!] === 0) threatO[cellsOf[k]!] = stamp;
      }
    }
    let s = this.windowScore;
    // With an even number of rows, x wants threats on odd rows (row index 0, 2, ... from the bottom) and o on even ones.
    const parity = H % 2 === 0;
    for (let c = 0; c < W; c++) {
      // Who has the lowest threat in this column: 0 x, 1 o, 2 both on one spot, -1 nobody yet.
      let lowest = -1;
      for (let r = this.height[c]!, cell = c * H + r; r < H; r++, cell++) {
        const x = threatX[cell] === stamp;
        const o = threatO[cell] === stamp;
        if (!x && !o) continue;
        // A threat above one of the other side's in the same column hardly ever comes into play.
        if (x && lowest !== 1) s += (!parity || r % 2 === 0 ? GOOD_THREAT : BAD_THREAT) + (r + 1 < H && threatX[cell + 1] === stamp ? STACKED : 0);
        if (o && lowest !== 0) s -= (!parity || r % 2 === 1 ? GOOD_THREAT : BAD_THREAT) + (r + 1 < H && threatO[cell + 1] === stamp ? STACKED : 0);
        if (lowest === -1) lowest = x && o ? 2 : x ? 0 : 1;
      }
    }
    return this.side === 0 ? s : -s;
  }

  // --- search -------------------------------------------------------------------

  /** Order `n` moves at `base` in the buffers, best first: the table's move, then threats made and blocked, the middle, history. */
  private orderMoves(base: number, n: number, ttMove: number) {
    const { H, winStart, winList, W } = this.g;
    const p = this.side;
    const mine = p ? this.cnt1 : this.cnt0;
    const theirs = p ? this.cnt0 : this.cnt1;
    const mid = (W - 1) / 2;
    for (let i = 0; i < n; i++) {
      const c = this.moveBuf[base + i]!;
      const cell = c * H + this.height[c]!;
      let s = 0;
      if (c === ttMove) s = 1 << 30;
      else {
        for (let j = winStart[cell]!, end = winStart[cell + 1]!; j < end; j++) {
          const w = winList[j]!;
          const a = mine[w]!;
          const b = theirs[w]!;
          if (b === 0) s += a === 2 ? 40 : a === 1 ? 6 : 1;
          else if (a === 0) s += b === 2 ? 20 : b === 1 ? 2 : 0;
        }
        s = s * 16 - Math.abs(c - mid) * 8 + Math.min(this.history[p * this.g.N + cell]! >> 4, 1000);
      }
      this.scoreBuf[base + i] = s;
    }
    // Insertion sort: at most 9 moves.
    for (let i = 1; i < n; i++) {
      const m = this.moveBuf[base + i]!;
      const s = this.scoreBuf[base + i]!;
      let j = i - 1;
      while (j >= 0 && this.scoreBuf[base + j]! < s) {
        this.moveBuf[base + j + 1] = this.moveBuf[base + j]!;
        this.scoreBuf[base + j + 1] = this.scoreBuf[base + j]!;
        j--;
      }
      this.moveBuf[base + j + 1] = m;
      this.scoreBuf[base + j + 1] = s;
    }
  }

  private negamax(depth: number, alpha: number, beta: number): number {
    if ((++this.nodes & 2047) === 0 && now() > this.deadline) this.stopped = true;
    if (this.stopped) return 0;
    const { W, N } = this.g;
    const p = this.side;
    const q = p ^ 1;
    const k = this.discs;

    for (let c = 0; c < W; c++) if (this.height[c]! < this.g.H && this.wins(c, p)) return WIN - (k + 1);
    let forced = -1;
    for (let c = 0; c < W; c++) {
      if (this.height[c]! < this.g.H && this.wins(c, q)) {
        if (forced >= 0) return -(WIN - (k + 2));
        forced = c;
      }
    }
    // The last spot, and it doesn't win: a draw.
    if (k >= N - 1) return 0;
    // No win now, so at best a win with our next disc; at worst they win with theirs.
    const most = WIN - (k + 3);
    if (beta > most) {
      beta = most;
      if (alpha >= beta) return beta;
    }
    const least = -(WIN - (k + 2));
    if (alpha < least) {
      alpha = least;
      if (alpha >= beta) return alpha;
    }
    if (depth <= 0 && forced < 0) return this.evaluate();

    // The transposition table.
    const slot = this.h1 & TT_MASK;
    let ttMove = -1;
    if (this.useTable && tt!.check[slot] === this.h2 && tt!.flag[slot] !== 0) {
      ttMove = tt!.move[slot]!;
      if (tt!.depth[slot]! >= depth) {
        const s = tt!.score[slot]!;
        const f = tt!.flag[slot];
        if (f === EXACT) return s;
        if (f === LOWER && s >= beta) return s;
        if (f === UPPER && s <= alpha) return s;
      }
    }

    // The moves: the one block if there's a threat (no depth used), else every column that doesn't hand them a win.
    const base = k * W;
    let n = 0;
    if (forced >= 0) this.moveBuf[base + n++] = forced;
    else {
      for (let c = 0; c < W; c++) if (this.height[c]! < this.g.H && !this.givesAway(c, p)) this.moveBuf[base + n++] = c;
      if (n === 0) return least;
      this.orderMoves(base, n, ttMove);
    }
    const next = forced >= 0 ? depth : depth - 1;

    const alpha0 = alpha;
    let best = -WIN - 1;
    let bestMove = this.moveBuf[base]!;
    for (let i = 0; i < n; i++) {
      const c = this.moveBuf[base + i]!;
      this.play(c);
      let score: number;
      if (i === 0) score = -this.negamax(next, -beta, -alpha);
      else {
        score = -this.negamax(next, -alpha - 1, -alpha);
        if (score > alpha && score < beta) score = -this.negamax(next, -beta, -alpha);
      }
      this.undo(c);
      if (this.stopped) return 0;
      if (score > best) {
        best = score;
        bestMove = c;
        if (score > alpha) {
          alpha = score;
          if (alpha >= beta) {
            this.history[p * N + c * this.g.H + this.height[c]!]! += depth * depth;
            break;
          }
        }
      }
    }

    if (this.useTable) {
      tt!.check[slot] = this.h2;
      tt!.score[slot] = best;
      tt!.depth[slot] = Math.min(depth, 127);
      tt!.flag[slot] = best <= alpha0 ? UPPER : best >= beta ? LOWER : EXACT;
      tt!.move[slot] = bestMove;
    }
    return best;
  }

  /** The best column for the side to move (which must have one). */
  search(opts: SearchOptions): SearchResult {
    const { H, N } = this.g;
    const p = this.side;
    const start = now();
    this.nodes = 0;
    this.stopped = false;
    this.deadline = start + opts.timeMs;
    this.history.fill(0);
    this.useTable = opts.table !== false;
    if (this.useTable) {
      tt ??= { check: new Int32Array(TT_SIZE), score: new Int32Array(TT_SIZE), depth: new Int8Array(TT_SIZE), flag: new Int8Array(TT_SIZE), move: new Int8Array(TT_SIZE) };
      tt.flag.fill(0);
    }
    const playable = this.g.order.filter((c) => this.height[c]! < H);
    if (!playable.length) throw new Error("no move");
    const k = this.discs;
    const done = (column: number, score: number, depth: number, solved = true): SearchResult => ({ column, score, depth, nodes: this.nodes, solved });

    const winNow = playable.find((c) => this.wins(c, p));
    if (winNow !== undefined) return done(winNow, WIN - (k + 1), 1);
    const threats = playable.filter((c) => this.wins(c, p ^ 1));
    if (threats.length) return done(threats[0]!, threats.length > 1 ? -(WIN - (k + 2)) : 0, 1, threats.length > 1);
    const safe = playable.filter((c) => !this.givesAway(c, p));
    if (safe.length <= 1) return done(safe[0] ?? playable[0]!, safe.length ? 0 : -(WIN - (k + 2)), 1, !safe.length);

    // Iterative deepening: each depth searches the last one's best move first.
    let moves = safe;
    let best = { column: moves[0]!, score: 0, depth: 0 };
    let scores = new Map<number, number>();
    for (let depth = 1; depth <= Math.min(opts.maxDepth, N - k); depth++) {
      let alpha = -WIN - 1;
      const result = new Map<number, number>();
      let bestHere = moves[0]!;
      for (let i = 0; i < moves.length; i++) {
        const c = moves[i]!;
        this.play(c);
        let score: number;
        if (i === 0) score = -this.negamax(depth - 1, -WIN - 1, -alpha);
        else {
          score = -this.negamax(depth - 1, -alpha - 1, -alpha);
          if (score > alpha && !this.stopped) score = -this.negamax(depth - 1, -WIN - 1, -alpha);
        }
        this.undo(c);
        if (this.stopped) break;
        result.set(c, score);
        if (score > alpha) [alpha, bestHere] = [score, c];
      }
      if (this.stopped) break;
      best = { column: bestHere, score: alpha, depth };
      scores = result;
      moves = [bestHere, ...moves.filter((c) => c !== bestHere)];
      // A win or a loss in sight (the quickest win, the slowest loss), or the end of the game reached: no need to look deeper.
      if (Math.abs(alpha) >= DECIDED || depth >= N - k) return done(best.column, best.score, depth, true);
      if (now() > this.deadline) break;
    }

    // Variety: any move within `margin` of the best, by a null-window test at the same depth.
    if (opts.margin && opts.rand && best.depth > 0 && Math.abs(best.score) < DECIDED) {
      const floor = best.score - opts.margin;
      const near = [best.column];
      this.deadline = Math.max(this.deadline, now() + opts.timeMs / 2);
      for (const c of moves.slice(1)) {
        // Scores other than the best's are upper bounds: one below the floor rules a move out, one above it doesn't count it in.
        if ((scores.get(c) ?? Infinity) < floor) continue;
        this.play(c);
        const score = -this.negamax(best.depth - 1, -floor, -floor + 1);
        this.undo(c);
        if (this.stopped) break;
        if (score >= floor) near.push(c);
      }
      best.column = near[opts.rand(near.length)]!;
    }
    return done(best.column, best.score, best.depth, false);
  }
}
