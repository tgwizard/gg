/**
 * The built-in Luffarschack bot: no search, just threats, the way a decent player looks at
 * the paper. For every empty square near the marks it asks what a mark there would make,
 * for itself (attack) and for the other side (the same square as a block), line by line:
 * five, an open four (two ways to finish: unstoppable), a four (one way), an open three
 * (one more makes an open four), a closed three, or just room to grow. Combinations count
 * extra (a four and an open three at once, two open threes). Then it takes the square
 * worth the most: a win, else a block of a win, else an open four, else a block of an
 * open three, and so on, with a little randomness among near-equals so games vary.
 *
 * It's quick (a few milliseconds a move on a 19×19 sheet) and never misses a five or a
 * block of one; a player who builds two threats at once can beat it.
 *
 * Easy, it looks only at what each square makes, not at wins by fours, cares less about
 * stopping the other side (now and then it misses a five), and picks loosely.
 */
import { chance, easy } from "../kit/bot";
import type { GameBot } from "../types";
import type { LuffaView } from "./engine";
import type { LuffaOp } from "./index";
import { parseSquare, squareName, wins } from "./rules";

const EMPTY = 0;
type Mark = 1 | 2;

/** What a mark makes along one line. */
const Shape = { None: 0, ClosedThree: 1, OpenThree: 2, Four: 3, OpenFour: 4, Five: 5 } as const;
type Shape = (typeof Shape)[keyof typeof Shape];

/** How much a square is worth, for one side. */
export const VALUE = {
  five: 1_000_000,
  openFour: 100_000,
  fourThree: 95_000,
  doubleThree: 20_000,
  openThree: 2_000,
  four: 1_500,
  closedThree: 300,
  /** The first square of the other side's win by fours. */
  theirFours: 60_000,
};
/** A block counts for a bit less than the same thing made for yourself: your own five comes before stopping theirs. */
const DEFENSE = 0.9;

class Sheet {
  readonly cells: Int8Array;
  constructor(
    readonly n: number,
    board: string,
  ) {
    this.cells = Int8Array.from(board, (c) => (c === "x" ? 1 : c === "o" ? 2 : EMPTY));
  }

  /** How many `p` in a row from (r, c), not counting it, stepping (dr, dc). */
  private reach(r: number, c: number, dr: number, dc: number, p: number): number {
    const { n, cells } = this;
    let k = 0;
    for (r += dr, c += dc; r >= 0 && r < n && c >= 0 && c < n && cells[r * n + c] === p; r += dr, c += dc) k++;
    return k;
  }

  /**
   * The empty squares on the line through `cell` (which holds `p`) that would make a
   * winning line of `p` with `cell` in it: two or more is an open four. Pushed onto `into`
   * if given; the count either way.
   */
  private finishes(cell: number, dr: number, dc: number, p: number, into?: number[]): number {
    const { n, cells } = this;
    const [r0, c0] = [Math.floor(cell / n), cell % n];
    let k = 0;
    for (let s = -4; s <= 4; s++) {
      if (!s) continue;
      const [r, c] = [r0 + s * dr, c0 + s * dc];
      if (r < 0 || r >= n || c < 0 || c >= n || cells[r * n + c] !== EMPTY) continue;
      // The run through the new mark, and whether it takes `cell` in.
      const back = this.reach(r, c, -dr, -dc, p);
      const ahead = this.reach(r, c, dr, dc, p);
      if (s > 0 ? back < s : ahead < -s) continue;
      if (wins(back + ahead + 1)) {
        k++;
        into?.push(r * n + c);
      }
    }
    return k;
  }

  /** Every empty square that would finish a winning line through `cell` (which holds `p`). */
  finishPoints(cell: number, p: number): number[] {
    const out: number[] = [];
    for (const [dr, dc] of LINES) this.finishes(cell, dr, dc, p, out);
    return [...new Set(out)];
  }

  /** Would `p` on the empty `cell` make a winning line? */
  makesFive(cell: number, p: number): boolean {
    const { n } = this;
    const [r0, c0] = [Math.floor(cell / n), cell % n];
    for (const [dr, dc] of LINES) if (wins(this.reach(r0, c0, -dr, -dc, p) + this.reach(r0, c0, dr, dc, p) + 1)) return true;
    return false;
  }

  /**
   * A win by fours (VCF): a mark of `p` making a four the other side must block, again and
   * again, until one is an open four or two at once. The first mark of such a sequence, or
   * null. Only sound when the other side has no four of its own to start with: a block that
   * makes them a four ends the line of thought (they'd win instead).
   */
  vcf(p: Mark, depth = 10, budget = { nodes: 4000 }): number | null {
    const q = p === 1 ? 2 : 1;
    const { cells } = this;
    const fours: { cell: number; block: number }[] = [];
    // An open four (or two fours) wins at once; the plain fours are for looking deeper.
    for (const c of near(this, (v) => v === p)) {
      cells[c] = p;
      const pts = this.finishPoints(c, p);
      cells[c] = EMPTY;
      if (pts.length >= 2) return c;
      if (pts.length === 1) fours.push({ cell: c, block: pts[0]! });
    }
    if (depth <= 0) return null;
    for (const { cell, block } of fours) {
      if (--budget.nodes < 0) return null;
      cells[cell] = p;
      cells[block] = q;
      const won = this.finishPoints(block, q).length === 0 && this.vcf(p, depth - 1, budget) !== null;
      cells[block] = EMPTY;
      cells[cell] = EMPTY;
      if (won) return cell;
    }
    return null;
  }

  /** What `cell` (holding `p`) makes along one line. */
  private shape(cell: number, dr: number, dc: number, p: number): Shape {
    const { n, cells } = this;
    const [r0, c0] = [Math.floor(cell / n), cell % n];
    if (wins(this.reach(r0, c0, -dr, -dc, p) + this.reach(r0, c0, dr, dc, p) + 1)) return Shape.Five;
    const f = this.finishes(cell, dr, dc, p);
    if (f >= 2) return Shape.OpenFour;
    if (f === 1) return Shape.Four;
    // A three: one more mark on this line makes a four (open or not).
    let best: Shape = Shape.None;
    for (let s = -4; s <= 4 && best !== Shape.OpenThree; s++) {
      if (!s) continue;
      const [r, c] = [r0 + s * dr, c0 + s * dc];
      if (r < 0 || r >= n || c < 0 || c >= n || cells[r * n + c] !== EMPTY) continue;
      const e = r * n + c;
      cells[e] = p;
      const g = this.finishes(cell, dr, dc, p);
      cells[e] = EMPTY;
      if (g >= 2) best = Shape.OpenThree;
      else if (g === 1) best = Shape.ClosedThree;
    }
    return best;
  }

  /** Room to grow: for each stretch of five through `cell` free of the other side, more for more of `p` in it. */
  private room(cell: number, dr: number, dc: number, p: number): number {
    const { n, cells } = this;
    const [r0, c0] = [Math.floor(cell / n), cell % n];
    let total = 0;
    for (let start = -4; start <= 0; start++) {
      let mine = 0;
      let open = true;
      for (let i = start; i < start + 5 && open; i++) {
        const [r, c] = [r0 + i * dr, c0 + i * dc];
        if (r < 0 || r >= n || c < 0 || c >= n) open = false;
        else {
          const v = cells[r * n + c];
          if (v === p) mine++;
          else if (v !== EMPTY) open = false;
        }
      }
      if (open) total += mine === 1 ? 1 : mine === 2 ? 6 : mine >= 3 ? 20 : 0;
    }
    return total;
  }

  /** What a mark of `p` on the empty `cell` is worth to `p`. */
  value(cell: number, p: Mark): number {
    this.cells[cell] = p;
    let [fives, openFours, fours, openThrees, closedThrees, room] = [0, 0, 0, 0, 0, 0];
    for (const [dr, dc] of LINES) {
      const s = this.shape(cell, dr, dc, p);
      if (s === Shape.Five) fives++;
      else if (s === Shape.OpenFour) openFours++;
      else if (s === Shape.Four) fours++;
      else if (s === Shape.OpenThree) openThrees++;
      else if (s === Shape.ClosedThree) closedThrees++;
      room += this.room(cell, dr, dc, p);
    }
    this.cells[cell] = EMPTY;
    if (fives) return VALUE.five;
    if (openFours || fours >= 2) return VALUE.openFour;
    if (fours && openThrees) return VALUE.fourThree;
    if (openThrees >= 2) return VALUE.doubleThree;
    return fours * VALUE.four + openThrees * VALUE.openThree + closedThrees * VALUE.closedThree + room;
  }
}

const LINES: readonly [number, number][] = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

/** Empty squares within two of a mark that `which` picks out (where anything happens), and in `allowed` if given. */
function near(sheet: Sheet, which: (v: number) => boolean, allowed?: Set<number>): number[] {
  const { n, cells } = sheet;
  const out = new Set<number>();
  for (let cell = 0; cell < cells.length; cell++) {
    if (cells[cell] === EMPTY || !which(cells[cell]!)) continue;
    const [r0, c0] = [Math.floor(cell / n), cell % n];
    for (let r = Math.max(0, r0 - 2); r <= Math.min(n - 1, r0 + 2); r++) {
      for (let c = Math.max(0, c0 - 2); c <= Math.min(n - 1, c0 + 2); c++) {
        const e = r * n + c;
        if (cells[e] === EMPTY && (!allowed || allowed.has(e))) out.add(e);
      }
    }
  }
  return [...out];
}

/**
 * The bot's square for `me` on a board (see ./rules for the format), from the `allowed`
 * cells. Picks at random among squares worth nearly as much as the best (`soft`: a good
 * deal less, playing easy).
 */
export function choose(board: string, n: number, me: "x" | "o", allowed: number[], rand: (maxExclusive: number) => number, soft = false): number {
  const sheet = new Sheet(n, board);
  const ok = new Set(allowed);
  const mid = (n - 1) / 2;
  if (!board.includes("x") && !board.includes("o")) {
    // The first mark: in the middle, give or take a square.
    const pick = Math.round(mid + rand(3) - 1) * n + Math.round(mid + rand(3) - 1);
    return ok.has(pick) ? pick : allowed[rand(allowed.length)]!;
  }
  const mine: Mark = me === "x" ? 1 : 2;
  const theirs: Mark = mine === 1 ? 2 : 1;
  let pool = near(sheet, (v) => v !== EMPTY, ok);
  if (!pool.length) pool = allowed;
  // Five now, or stop theirs.
  for (const p of [mine, theirs]) {
    if (soft && p === theirs && chance(rand, 30)) continue;
    const five = pool.find((cell) => sheet.makesFive(cell, p));
    if (five !== undefined) return five;
  }
  // A win by fours, if there's one.
  const vcf = soft ? null : sheet.vcf(mine);
  if (vcf !== null && ok.has(vcf)) return vcf;
  // Where their own win by fours would start: worth taking first.
  const danger = soft ? null : sheet.vcf(theirs);
  const defense = soft ? 0.3 : DEFENSE;
  const scored = pool.map((cell) => {
    const [r, c] = [Math.floor(cell / n), cell % n];
    // A touch of the middle, so it doesn't wander off to the edges.
    const central = -0.2 * Math.hypot(r - mid, c - mid);
    return { cell, score: sheet.value(cell, mine) + defense * sheet.value(cell, theirs) + (cell === danger ? VALUE.theirFours : 0) + central };
  });
  const best = Math.max(...scored.map((s) => s.score));
  // Near-equals: within 8% of the best (60% playing easy), or a few points when nothing much is going on.
  const close = scored.filter((s) => s.score >= best - Math.max(3, Math.abs(best) * (soft ? 0.6 : 0.08)));
  return close[rand(close.length)]!.cell;
}

export const luffarschackBot: GameBot<LuffaView, LuffaOp> = {
  play(view, ops, rand, opts) {
    const me = view.you.color;
    if (!me || view.phase !== "playing" || view.turn !== me) return null;
    const allowed = ops.flatMap((op) => {
      const cell = op.type === "mark" ? parseSquare(op.square, view.size) : null;
      return cell === null ? [] : [cell];
    });
    if (!allowed.length) return null;
    return { type: "mark", square: squareName(view.size, choose(view.board, view.size, me, allowed, rand, easy(opts))) };
  },
};

/**
 * Where `p` could make five right now (`five`), and where an open four or better
 * (`openFour`: from an open three, say), on the empty squares near the marks.
 */
export function threats(board: string, n: number, p: "x" | "o"): { five: number[]; openFour: number[] } {
  const sheet = new Sheet(n, board);
  const mark: Mark = p === "x" ? 1 : 2;
  const pool = near(sheet, (v) => v !== EMPTY);
  return { five: pool.filter((c) => sheet.makesFive(c, mark)), openFour: pool.filter((c) => sheet.value(c, mark) >= VALUE.openFour) };
}
