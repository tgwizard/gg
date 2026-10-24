/**
 * Luffarschack's rules on a bare board, with no players or clocks (those are in ./engine).
 *
 * The board is a square of `n` × `n` squares on squared paper. It's a string of cells,
 * row by row from the top left: "x" a cross (kryss) of whoever moved first this game, "o"
 * a circle (ring) of the other, "." empty. Cells are numbered 0 (top left) to n² − 1.
 * Squares are named like a spreadsheet's: a column letter (A on the left) and a row number
 * (1 at the top), so "A1" is the top left and "S19" the bottom right of a 19×19 sheet.
 *
 * Five in a row wins: across, down or diagonally. A longer line counts too (five or more,
 * the Swedish way).
 */
export type Piece = "x" | "o";
export type Cell = Piece | ".";

export const SIZES = ["15", "19", "25"] as const;
export type SizeName = (typeof SIZES)[number];
export const sizeOf = (name: SizeName): number => Number(name);

/** Column letters, A to Y (25 columns at most). */
export const COLUMNS = "ABCDEFGHIJKLMNOPQRSTUVWXY";

export const other = (p: Piece): Piece => (p === "x" ? "o" : "x");
export const emptyBoard = (n: number) => ".".repeat(n * n);
export const colOf = (n: number, cell: number) => cell % n;
export const rowOf = (n: number, cell: number) => Math.floor(cell / n);

/** "H8": column letter, then the row counted from 1 at the top. */
export const squareName = (n: number, cell: number) => `${COLUMNS[colOf(n, cell)]}${rowOf(n, cell) + 1}`;

/** The cell a square's name points at on an `n` × `n` sheet, or null if there's no such square. */
export function parseSquare(name: string, n: number): number | null {
  const m = /^([A-Za-z])(\d{1,2})$/.exec(name.trim());
  if (!m) return null;
  const col = COLUMNS.indexOf(m[1]!.toUpperCase());
  const row = Number(m[2]) - 1;
  if (col < 0 || col >= n || row < 0 || row >= n) return null;
  return row * n + col;
}

/** The four directions a line can run in, as (row, column) steps. */
export const DIRECTIONS: readonly [number, number][] = [
  [0, 1], // across
  [1, 0], // down
  [1, 1], // down to the right
  [1, -1], // down to the left
];

/** How far a run of `p` goes from `cell` (not counted) in one direction: the number of `p` in a row. */
export function reach(board: string, n: number, cell: number, dr: number, dc: number, p: string): number {
  let [r, c] = [rowOf(n, cell) + dr, colOf(n, cell) + dc];
  let k = 0;
  while (r >= 0 && r < n && c >= 0 && c < n && board[r * n + c] === p) {
    k++;
    r += dr;
    c += dc;
  }
  return k;
}

/** Five or more in a row wins. */
export const wins = (length: number) => length >= 5;

/**
 * The winning runs through `cell` (whose mark counts), as [first, last] cells of each, in
 * reading order; empty if there's none. A mark can finish two lines at once.
 */
export function winningRuns(board: string, n: number, cell: number): [number, number][] {
  const p = board[cell];
  if (p !== "x" && p !== "o") return [];
  const runs: [number, number][] = [];
  for (const [dr, dc] of DIRECTIONS) {
    const back = reach(board, n, cell, -dr, -dc, p);
    const ahead = reach(board, n, cell, dr, dc, p);
    if (!wins(back + ahead + 1)) continue;
    runs.push([cell - back * (dr * n + dc), cell + ahead * (dr * n + dc)]);
  }
  return runs;
}

/** Every cell of the winning runs through `cell`, sorted; empty if it didn't win. */
export function fiveThrough(board: string, n: number, cell: number): number[] {
  const cells = new Set<number>();
  for (const [a, b] of winningRuns(board, n, cell)) {
    const step = stepBetween(n, a, b);
    for (let x = a; ; x += step) {
      cells.add(x);
      if (x === b) break;
    }
  }
  return [...cells].sort((a, b) => a - b);
}

/** The step from cell `a` to `b` along their line (they must be on one). */
function stepBetween(n: number, a: number, b: number): number {
  if (a === b) return 1;
  const [dr, dc] = [Math.sign(rowOf(n, b) - rowOf(n, a)), Math.sign(colOf(n, b) - colOf(n, a))];
  return dr * n + dc;
}

/** Any winning line anywhere on the board (for invariants). */
export function anyFive(board: string, n: number): boolean {
  for (let cell = 0; cell < board.length; cell++) if (board[cell] !== "." && winningRuns(board, n, cell).length) return true;
  return false;
}

export function count(board: string): { x: number; o: number; empty: number } {
  let [x, o] = [0, 0];
  for (const cell of board) {
    if (cell === "x") x++;
    else if (cell === "o") o++;
  }
  return { x, o, empty: board.length - x - o };
}

export const place = (board: string, cell: number, p: Piece) => board.slice(0, cell) + p + board.slice(cell + 1);
