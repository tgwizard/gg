/**
 * Go's rules on a bare board, with no players or clocks (those are in ./engine).
 *
 * The board is a string of size×size cells, row by row from the top left: "b" a black
 * stone, "w" a white one, "." empty. Points are numbered from 0 at the top left and
 * named the Go way: a column letter (A to T, skipping I), then the row counted from the
 * bottom, so A1 is the bottom left corner.
 *
 * Suicide isn't allowed, and no move may bring back a position the board has had before
 * (positional superko), which covers ko. Scoring is by area: your stones on the board
 * plus the empty points only you surround, once dead stones are taken off.
 */
export type Color = "b" | "w";
export type Size = 9 | 13 | 19;

export const SIZES: Size[] = [9, 13, 19];
export const COLUMNS = "ABCDEFGHJKLMNOPQRST";
/** Points White gets for moving second; the half point means there are no draws. */
export const KOMI = 7.5;

export const other = (c: Color): Color => (c === "b" ? "w" : "b");
export const emptyBoard = (size: Size) => ".".repeat(size * size);
export const sizeOf = (board: string) => Math.round(Math.sqrt(board.length)) as Size;

export const pointName = (p: number, size: number) => `${COLUMNS[p % size]}${size - Math.floor(p / size)}`;

export function parsePoint(name: string, size: number): number | null {
  const m = /^([A-HJ-T])(\d{1,2})$/.exec(name);
  if (!m) return null;
  const col = COLUMNS.indexOf(m[1]!);
  const row = Number(m[2]);
  if (col >= size || row < 1 || row > size) return null;
  return (size - row) * size + col;
}

const NEIGHBORS = new Map<number, number[][]>();
/** Each point's neighbors up, left, right and down (fewer on the edge). */
export function neighbors(size: number): number[][] {
  let n = NEIGHBORS.get(size);
  if (!n) {
    n = Array.from({ length: size * size }, (_, p) => {
      const [r, c] = [Math.floor(p / size), p % size];
      const out: number[] = [];
      if (r > 0) out.push(p - size);
      if (c > 0) out.push(p - 1);
      if (c < size - 1) out.push(p + 1);
      if (r < size - 1) out.push(p + size);
      return out;
    });
    NEIGHBORS.set(size, n);
  }
  return n;
}

/** The star points (hoshi), as printed on the board. */
export function starPoints(size: number): number[] {
  const at = (col: number, row: number) => row * size + col;
  if (size === 9) return [at(2, 2), at(6, 2), at(4, 4), at(2, 6), at(6, 6)];
  if (size === 13) return [at(3, 3), at(9, 3), at(6, 6), at(3, 9), at(9, 9)];
  const lines = [3, 9, 15];
  return lines.flatMap((r) => lines.map((c) => at(c, r)));
}

/** The stones connected to the one on `p`, and their liberties (empty neighbors). */
export function chainAt(board: string, p: number): { stones: number[]; liberties: number[] } {
  const nbrs = neighbors(sizeOf(board));
  const color = board[p];
  const stones = [p];
  const seen = new Set(stones);
  const liberties = new Set<number>();
  for (let i = 0; i < stones.length; i++) {
    for (const q of nbrs[stones[i]!]!) {
      if (seen.has(q)) continue;
      if (board[q] === color) {
        seen.add(q);
        stones.push(q);
      } else if (board[q] === ".") liberties.add(q);
    }
  }
  return { stones, liberties: [...liberties] };
}

/** Every chain of stones on the board, each listed once. */
export function chains(board: string): { color: Color; stones: number[]; liberties: number[] }[] {
  const done = new Set<number>();
  const out = [];
  for (let p = 0; p < board.length; p++) {
    if (board[p] === "." || done.has(p)) continue;
    const chain = chainAt(board, p);
    for (const s of chain.stones) done.add(s);
    out.push({ color: board[p] as Color, ...chain });
  }
  return out;
}

export type Illegal = "occupied" | "suicide" | "repeat";

/**
 * `c` plays on `p`: the board after, and the stones it took off. Repeating a position
 * is checked only when `seen` (the positions so far, by `positionKey`) is given.
 */
export function tryPlay(board: string, c: Color, p: number, seen?: Set<string>): { board: string; captured: number[] } | { illegal: Illegal } {
  if (board[p] !== ".") return { illegal: "occupied" };
  const cells = board.split("");
  cells[p] = c;
  const placed = cells.join("");
  const captured: number[] = [];
  for (const q of neighbors(sizeOf(board))[p]!) {
    if (placed[q] !== other(c) || captured.includes(q)) continue;
    const chain = chainAt(placed, q);
    if (!chain.liberties.length) captured.push(...chain.stones);
  }
  for (const q of captured) cells[q] = ".";
  const after = captured.length ? cells.join("") : placed;
  if (!captured.length && !chainAt(after, p).liberties.length) return { illegal: "suicide" };
  if (seen?.has(positionKey(after))) return { illegal: "repeat" };
  return { board: after, captured: captured.sort((a, b) => a - b) };
}

/** Where `c` can play, in point order, given the positions so far. */
export function legalPoints(board: string, c: Color, seen: Set<string>): number[] {
  const out: number[] = [];
  for (let p = 0; p < board.length; p++) if (board[p] === "." && !("illegal" in tryPlay(board, c, p, seen))) out.push(p);
  return out;
}

/**
 * A short fingerprint of a position (two 32-bit hashes), to remember every position
 * the game has had without keeping whole boards.
 */
export function positionKey(board: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9747b28c;
  for (let i = 0; i < board.length; i++) {
    const c = board.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
    h2 ^= h2 >>> 13;
  }
  return `${(h1 >>> 0).toString(36)}.${(h2 >>> 0).toString(36)}`;
}

/**
 * The score by area, with the stones on `dead` taken off: each side's stones plus the
 * empty points only they surround (no komi). `owner` has, per point, whose it counts
 * as ("b", "w", or "." for neither).
 */
export function areaScore(board: string, dead: Iterable<number> = []): { b: number; w: number; owner: string } {
  const nbrs = neighbors(sizeOf(board));
  const cells = board.split("");
  for (const p of dead) cells[p] = ".";
  const owner = [...cells];
  const done = new Set<number>();
  for (let p = 0; p < cells.length; p++) {
    if (cells[p] !== "." || done.has(p)) continue;
    // An empty region, and which colors border it.
    const region = [p];
    done.add(p);
    const borders = new Set<string>();
    for (let i = 0; i < region.length; i++) {
      for (const q of nbrs[region[i]!]!) {
        if (cells[q] === ".") {
          if (!done.has(q)) {
            done.add(q);
            region.push(q);
          }
        } else borders.add(cells[q]!);
      }
    }
    const who = borders.size === 1 ? [...borders][0]! : ".";
    for (const q of region) owner[q] = who;
  }
  let [b, w] = [0, 0];
  for (const o of owner) {
    if (o === "b") b++;
    else if (o === "w") w++;
  }
  return { b, w, owner: owner.join("") };
}
