/**
 * Othello's rules on a bare board, with no players or clocks (those are in ./engine).
 *
 * The board is a string of 64 cells, row by row from the top left: "b" a black disc,
 * "w" a white one, "." empty. Squares are numbered 0 (a1, top left) to 63 (h8, bottom
 * right) and named the Othello way: a column letter, then the row counted from the top.
 */
export type Color = "b" | "w";
export type Cell = Color | ".";

export const FILES = "abcdefgh";
/** d4 and e5 white, e4 and d5 black. */
export const START_BOARD = `${".".repeat(27)}wb${".".repeat(6)}bw${".".repeat(27)}`;
export const CORNERS = [0, 7, 56, 63];

const DIRECTIONS: [number, number][] = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];

export const other = (c: Color): Color => (c === "b" ? "w" : "b");
export const rowOf = (sq: number) => Math.floor(sq / 8);
export const colOf = (sq: number) => sq % 8;
export const squareName = (sq: number) => `${FILES[colOf(sq)]}${rowOf(sq) + 1}`;

export function parseSquare(name: string): number | null {
  const m = /^([a-h])([1-8])$/.exec(name);
  return m ? (Number(m[2]) - 1) * 8 + FILES.indexOf(m[1]!) : null;
}

/** The discs `c` would turn over by playing on `sq`, nearest first along each line; none if it can't play there. */
export function flipsFor(board: string, c: Color, sq: number): number[] {
  if (board[sq] !== ".") return [];
  const them = other(c);
  const flips: number[] = [];
  for (const [dr, dc] of DIRECTIONS) {
    const line: number[] = [];
    let [r, col] = [rowOf(sq) + dr, colOf(sq) + dc];
    while (r >= 0 && r < 8 && col >= 0 && col < 8 && board[r * 8 + col] === them) {
      line.push(r * 8 + col);
      [r, col] = [r + dr, col + dc];
    }
    // A line counts only if it ends in one of yours.
    if (line.length && r >= 0 && r < 8 && col >= 0 && col < 8 && board[r * 8 + col] === c) flips.push(...line);
  }
  return flips;
}

/** Where `c` can play, in square order. */
export function legalMoves(board: string, c: Color): number[] {
  const moves: number[] = [];
  for (let sq = 0; sq < 64; sq++) if (flipsFor(board, c, sq).length) moves.push(sq);
  return moves;
}

/** `c` plays on `sq` (which must be legal): the board after, and what turned over. */
export function play(board: string, c: Color, sq: number): { board: string; flips: number[] } {
  const flips = flipsFor(board, c, sq);
  if (!flips.length) throw new Error(`${squareName(sq)} isn't a move for ${c}`);
  const cells = board.split("");
  for (const f of [sq, ...flips]) cells[f] = c;
  return { board: cells.join(""), flips };
}

export function count(board: string): { b: number; w: number; empty: number } {
  let [b, w] = [0, 0];
  for (const cell of board) {
    if (cell === "b") b++;
    else if (cell === "w") w++;
  }
  return { b, w, empty: 64 - b - w };
}
