/**
 * Four in a Row's rules on a bare board, with no players or clocks (those are in ./engine).
 *
 * The board stands upright: `columns` wide and `rows` tall. It's a string of cells, row by
 * row from the top left: "x" a disc of whoever moved first this game, "o" the other's,
 * "." empty. Cells are numbered 0 (top left) to columns × rows − 1 (bottom right). A disc
 * dropped into a column falls to the lowest empty cell. Columns are numbered 1 (left) to
 * `columns`, and rows 1 (the bottom) to `rows`, as players say them.
 */
export type Piece = "x" | "o";
export type Cell = Piece | ".";

export const SIZES = ["7x6", "8x7", "9x7"] as const;
export type SizeName = (typeof SIZES)[number];
export interface Size {
  columns: number;
  rows: number;
}

export function parseSize(name: SizeName): Size {
  const [columns, rows] = name.split("x").map(Number) as [number, number];
  return { columns, rows };
}

export const other = (p: Piece): Piece => (p === "x" ? "o" : "x");
export const emptyBoard = (size: Size) => ".".repeat(size.columns * size.rows);
export const cellAt = (size: Size, col: number, rowFromTop: number) => rowFromTop * size.columns + col;
export const colOf = (size: Size, cell: number) => cell % size.columns;
export const rowOf = (size: Size, cell: number) => Math.floor(cell / size.columns);
/** Row as players count it: 1 is the bottom. */
export const rowNumber = (size: Size, cell: number) => size.rows - rowOf(size, cell);

/** The cell a disc dropped in column `col` (0-based) lands on, or null if the column is full. */
export function landing(board: string, size: Size, col: number): number | null {
  if (col < 0 || col >= size.columns) return null;
  for (let r = size.rows - 1; r >= 0; r--) if (board[cellAt(size, col, r)] === ".") return cellAt(size, col, r);
  return null;
}

/** Columns (0-based) with room for another disc, left to right. */
export function openColumns(board: string, size: Size): number[] {
  const cols: number[] = [];
  for (let c = 0; c < size.columns; c++) if (board[c] === ".") cols.push(c);
  return cols;
}

/** `p` drops a disc in column `col` (which must have room): the board after, and the cell it landed on. */
export function drop(board: string, size: Size, p: Piece, col: number): { board: string; cell: number } {
  const cell = landing(board, size, col);
  if (cell === null) throw new Error(`column ${col + 1} is full`);
  return { board: board.slice(0, cell) + p + board.slice(cell + 1), cell };
}

const LINES: [number, number][] = [
  [0, 1], // across
  [1, 0], // up and down
  [1, 1], // down to the right
  [1, -1], // down to the left
];

/**
 * Every disc in a line of four or more through `cell` of the same piece, the cell
 * included; empty if there's none. Two lines through one disc give both.
 */
export function fourThrough(board: string, size: Size, cell: number): number[] {
  const p = board[cell];
  if (p !== "x" && p !== "o") return [];
  const [r0, c0] = [rowOf(size, cell), colOf(size, cell)];
  const won = new Set<number>();
  for (const [dr, dc] of LINES) {
    const line = [cell];
    for (const sign of [1, -1]) {
      let [r, c] = [r0 + dr * sign, c0 + dc * sign];
      while (r >= 0 && r < size.rows && c >= 0 && c < size.columns && board[cellAt(size, c, r)] === p) {
        line.push(cellAt(size, c, r));
        [r, c] = [r + dr * sign, c + dc * sign];
      }
    }
    if (line.length >= 4) for (const x of line) won.add(x);
  }
  return [...won].sort((a, b) => a - b);
}

/** Any four in a row anywhere on the board (for invariants). */
export function anyFour(board: string, size: Size): boolean {
  for (let cell = 0; cell < board.length; cell++) if (board[cell] !== "." && fourThrough(board, size, cell).length) return true;
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

/** No disc floats above an empty cell. */
export function settled(board: string, size: Size): boolean {
  for (let c = 0; c < size.columns; c++) {
    for (let r = 1; r < size.rows; r++) if (board[cellAt(size, c, r)] === "." && board[cellAt(size, c, r - 1)] !== ".") return false;
  }
  return true;
}
