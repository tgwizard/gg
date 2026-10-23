/**
 * The rules of chess as pure functions over a position: legal moves (castling, en
 * passant, promotion, never leaving your king in check), making a move, SAN and FEN,
 * and what ends a game on the board. Shared by the engine on the server and the board
 * in the browser, which shows legal moves without asking.
 *
 * Squares are numbered a1 = 0, b1 = 1, …, h1 = 7, a2 = 8, …, h8 = 63.
 */
export type Color = "w" | "b";
export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";
export type Promotion = "q" | "r" | "b" | "n";
/** FEN letters: uppercase for White, lowercase for Black. */
export type Piece = "P" | "N" | "B" | "R" | "Q" | "K" | "p" | "n" | "b" | "r" | "q" | "k";

export interface Position {
  board: (Piece | null)[];
  turn: Color;
  /** Castling rights, FEN style: some of "KQkq". */
  castling: string;
  /** The square a pawn just skipped over (it can be taken en passant), or null. */
  ep: number | null;
  /** Half-moves since the last capture or pawn move (the fifty-move rule). */
  halfmove: number;
  fullmove: number;
}

export interface Move {
  from: number;
  to: number;
  promotion?: Promotion;
}

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
export const FILES = "abcdefgh";
export const PROMOTIONS: Promotion[] = ["q", "r", "b", "n"];
/** Material, in pawns. */
export const VALUE: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export const fileOf = (sq: number) => sq & 7;
export const rankOf = (sq: number) => sq >> 3;
export const squareName = (sq: number) => `${FILES[fileOf(sq)]}${rankOf(sq) + 1}`;
export const colorOf = (p: Piece): Color => (p === p.toUpperCase() ? "w" : "b");
export const typeOf = (p: Piece) => p.toLowerCase() as PieceType;
export const other = (c: Color): Color => (c === "w" ? "b" : "w");
export const pieceOf = (c: Color, t: PieceType) => (c === "w" ? t.toUpperCase() : t) as Piece;

export function parseSquare(name: string): number | null {
  const f = FILES.indexOf(name[0] ?? "");
  const r = Number(name[1]) - 1;
  return name.length === 2 && f >= 0 && r >= 0 && r < 8 ? r * 8 + f : null;
}

/** The square at file f, rank r (0-based), or -1 off the board. */
const at = (f: number, r: number) => (f >= 0 && f < 8 && r >= 0 && r < 8 ? r * 8 + f : -1);

const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]] as const;
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const;
const ORTHOGONAL = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const DIAGONAL = [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

// --- FEN -----------------------------------------------------------------------

export function parseFen(fen: string): Position {
  const [placement, turn, castling, ep, halfmove, fullmove] = fen.trim().split(/\s+/);
  const ranks = placement?.split("/") ?? [];
  if (ranks.length !== 8) throw new Error(`bad FEN: ${fen}`);
  const board: (Piece | null)[] = Array.from({ length: 64 }, () => null);
  ranks.forEach((row, i) => {
    let f = 0;
    for (const ch of row) {
      if (/[1-8]/.test(ch)) f += Number(ch);
      else if (/^[pnbrqkPNBRQK]$/.test(ch) && f < 8) board[(7 - i) * 8 + f++] = ch as Piece;
      else throw new Error(`bad FEN: ${fen}`);
    }
    if (f !== 8) throw new Error(`bad FEN: ${fen}`);
  });
  if (turn !== "w" && turn !== "b") throw new Error(`bad FEN: ${fen}`);
  return {
    board,
    turn,
    castling: castling && castling !== "-" ? castling.replace(/[^KQkq]/g, "") : "",
    ep: ep && ep !== "-" ? parseSquare(ep) : null,
    halfmove: Number(halfmove ?? 0) || 0,
    fullmove: Number(fullmove ?? 1) || 1,
  };
}

function placementOf(board: (Piece | null)[]): string {
  const rows: string[] = [];
  for (let r = 7; r >= 0; r--) {
    let row = "";
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = board[r * 8 + f];
      if (!p) empty++;
      else {
        row += (empty || "") + p;
        empty = 0;
      }
    }
    rows.push(row + (empty || ""));
  }
  return rows.join("/");
}

export function toFen(pos: Position): string {
  const ep = pos.ep === null ? "-" : squareName(pos.ep);
  return `${placementOf(pos.board)} ${pos.turn} ${pos.castling || "-"} ${ep} ${pos.halfmove} ${pos.fullmove}`;
}

/**
 * What makes positions the same for threefold repetition: the pieces, who's to move,
 * castling rights, and an en passant square only when a pawn could actually take there.
 */
export function positionKey(pos: Position): string {
  const ep = pos.ep !== null && legalMoves(pos).some((m) => m.to === pos.ep && pos.board[m.from] === pieceOf(pos.turn, "p")) ? squareName(pos.ep) : "-";
  return `${placementOf(pos.board)} ${pos.turn} ${pos.castling || "-"} ${ep}`;
}

// --- attacks -------------------------------------------------------------------

/** Whether `by` attacks `sq` (pins don't matter: a pinned piece still gives check). */
export function attacked(board: (Piece | null)[], sq: number, by: Color): boolean {
  const f = fileOf(sq);
  const r = rankOf(sq);
  const is = (s: number, types: string) => {
    const p = s >= 0 ? board[s] : null;
    return !!p && colorOf(p) === by && types.includes(typeOf(p));
  };
  const pawnRank = by === "w" ? r - 1 : r + 1;
  if (is(at(f - 1, pawnRank), "p") || is(at(f + 1, pawnRank), "p")) return true;
  if (KNIGHT.some(([df, dr]) => is(at(f + df, r + dr), "n"))) return true;
  if (KING.some(([df, dr]) => is(at(f + df, r + dr), "k"))) return true;
  const slides = (dirs: readonly (readonly [number, number])[], types: string) =>
    dirs.some(([df, dr]) => {
      for (let i = 1; ; i++) {
        const s = at(f + df * i, r + dr * i);
        if (s < 0) return false;
        if (board[s]) return is(s, types);
      }
    });
  return slides(ORTHOGONAL, "rq") || slides(DIAGONAL, "bq");
}

export function kingSquare(board: (Piece | null)[], c: Color): number {
  return board.indexOf(pieceOf(c, "k"));
}

export function inCheck(pos: Position): boolean {
  const k = kingSquare(pos.board, pos.turn);
  return k >= 0 && attacked(pos.board, k, other(pos.turn));
}

// --- moves ---------------------------------------------------------------------

/** Moves that follow how the pieces move, whether or not they leave the king in check. */
function pseudoMoves(pos: Position): Move[] {
  const { board, turn } = pos;
  const moves: Move[] = [];
  const enemy = (s: number) => s >= 0 && !!board[s] && colorOf(board[s]!) !== turn;
  const free = (s: number) => s >= 0 && !board[s];

  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq];
    if (!p || colorOf(p) !== turn) continue;
    const f = fileOf(sq);
    const r = rankOf(sq);
    const t = typeOf(p);
    if (t === "p") {
      const dir = turn === "w" ? 1 : -1;
      const last = turn === "w" ? 7 : 0;
      const push = (to: number) => {
        if (rankOf(to) === last) for (const promotion of PROMOTIONS) moves.push({ from: sq, to, promotion });
        else moves.push({ from: sq, to });
      };
      const one = at(f, r + dir);
      if (free(one)) {
        push(one);
        const two = at(f, r + 2 * dir);
        if (r === (turn === "w" ? 1 : 6) && free(two)) moves.push({ from: sq, to: two });
      }
      for (const df of [-1, 1]) {
        const to = at(f + df, r + dir);
        if (enemy(to) || (to >= 0 && to === pos.ep)) push(to);
      }
    } else if (t === "n" || t === "k") {
      for (const [df, dr] of t === "n" ? KNIGHT : KING) {
        const to = at(f + df, r + dr);
        if (free(to) || enemy(to)) moves.push({ from: sq, to });
      }
    } else {
      const dirs = t === "r" ? ORTHOGONAL : t === "b" ? DIAGONAL : [...ORTHOGONAL, ...DIAGONAL];
      for (const [df, dr] of dirs) {
        for (let i = 1; ; i++) {
          const to = at(f + df * i, r + dr * i);
          if (to < 0) break;
          if (free(to)) moves.push({ from: sq, to });
          else {
            if (enemy(to)) moves.push({ from: sq, to });
            break;
          }
        }
      }
    }
  }

  // Castling: the king and rook haven't moved, nothing between them, and the king
  // isn't in check, doesn't pass through check and doesn't land in it.
  const home = turn === "w" ? 4 : 60;
  if (board[home] === pieceOf(turn, "k")) {
    const them = other(turn);
    const rook = pieceOf(turn, "r");
    const safe = (...sqs: number[]) => sqs.every((s) => !attacked(board, s, them));
    const [kingSide, queenSide] = turn === "w" ? ["K", "Q"] : ["k", "q"];
    if (pos.castling.includes(kingSide) && board[home + 3] === rook && free(home + 1) && free(home + 2) && safe(home, home + 1, home + 2)) {
      moves.push({ from: home, to: home + 2 });
    }
    if (pos.castling.includes(queenSide) && board[home - 4] === rook && free(home - 1) && free(home - 2) && free(home - 3) && safe(home, home - 1, home - 2)) {
      moves.push({ from: home, to: home - 2 });
    }
  }
  return moves;
}

export function legalMoves(pos: Position): Move[] {
  return pseudoMoves(pos).filter((m) => {
    const next = makeMove(pos, m);
    return !attacked(next.board, kingSquare(next.board, pos.turn), next.turn);
  });
}

const CASTLING_SQUARES: Record<number, string> = { 0: "Q", 7: "K", 56: "q", 63: "k" };

/** The position after `m`, which must be at least pseudo-legal. */
export function makeMove(pos: Position, m: Move): Position {
  const board = pos.board.slice();
  const p = board[m.from]!;
  const c = colorOf(p);
  const t = typeOf(p);
  let captured = !!board[m.to];
  board[m.to] = p;
  board[m.from] = null;
  let ep: number | null = null;
  if (t === "p") {
    if (m.to === pos.ep && fileOf(m.to) !== fileOf(m.from)) {
      board[m.to + (c === "w" ? -8 : 8)] = null;
      captured = true;
    }
    if (Math.abs(m.to - m.from) === 16) ep = (m.from + m.to) / 2;
    if (m.promotion) board[m.to] = pieceOf(c, m.promotion);
  }
  if (t === "k" && Math.abs(m.to - m.from) === 2) {
    const [rookFrom, rookTo] = m.to > m.from ? [m.from + 3, m.from + 1] : [m.from - 4, m.from - 1];
    board[rookTo] = board[rookFrom]!;
    board[rookFrom] = null;
  }
  let castling = pos.castling;
  if (t === "k") castling = castling.replace(c === "w" ? /[KQ]/g : /[kq]/g, "");
  for (const s of [m.from, m.to]) if (CASTLING_SQUARES[s]) castling = castling.replace(CASTLING_SQUARES[s], "");
  return {
    board,
    turn: other(c),
    castling,
    ep,
    halfmove: t === "p" || captured ? 0 : pos.halfmove + 1,
    fullmove: pos.fullmove + (c === "b" ? 1 : 0),
  };
}

/** Whether a move takes something (en passant included). */
export function isCapture(pos: Position, m: Move): boolean {
  return !!pos.board[m.to] || (pos.board[m.from] === pieceOf(pos.turn, "p") && m.to === pos.ep && fileOf(m.to) !== fileOf(m.from));
}

/** What a move does: the piece that moves, and what it takes and where (en passant takes beside it). */
export function moveFacts(pos: Position, m: Move): { piece: PieceType; took: PieceType | null; tookAt: number | null } {
  const piece = typeOf(pos.board[m.from]!);
  if (pos.board[m.to]) return { piece, took: typeOf(pos.board[m.to]!), tookAt: m.to };
  if (piece === "p" && m.to === pos.ep && fileOf(m.to) !== fileOf(m.from)) return { piece, took: "p", tookAt: m.to + (pos.turn === "w" ? -8 : 8) };
  return { piece, took: null, tookAt: null };
}

// --- notation ------------------------------------------------------------------

export const toUci = (m: Move) => `${squareName(m.from)}${squareName(m.to)}${m.promotion ?? ""}`;

export function parseUci(uci: string): Move | null {
  const from = parseSquare(uci.slice(0, 2));
  const to = parseSquare(uci.slice(2, 4));
  const promotion = uci[4] as Promotion | undefined;
  if (from === null || to === null || uci.length > 5 || (promotion && !PROMOTIONS.includes(promotion))) return null;
  return promotion ? { from, to, promotion } : { from, to };
}

export const sameMove = (a: Move, b: Move) => a.from === b.from && a.to === b.to && (a.promotion ?? null) === (b.promotion ?? null);

/** Standard algebraic notation ("Nbd7", "exd6", "O-O", "e8=Q#"). `m` must be legal. */
export function toSan(pos: Position, m: Move, legal: Move[] = legalMoves(pos)): string {
  const p = pos.board[m.from]!;
  const t = typeOf(p);
  let san: string;
  if (t === "k" && Math.abs(m.to - m.from) === 2) san = m.to > m.from ? "O-O" : "O-O-O";
  else {
    const takes = isCapture(pos, m) ? "x" : "";
    if (t === "p") san = `${takes ? FILES[fileOf(m.from)] : ""}${takes}${squareName(m.to)}${m.promotion ? `=${m.promotion.toUpperCase()}` : ""}`;
    else {
      // Say which piece when another of the same kind could go there too.
      const rivals = legal.filter((o) => o.to === m.to && o.from !== m.from && pos.board[o.from] === p);
      let which = "";
      if (rivals.length) {
        if (!rivals.some((o) => fileOf(o.from) === fileOf(m.from))) which = FILES[fileOf(m.from)]!;
        else if (!rivals.some((o) => rankOf(o.from) === rankOf(m.from))) which = String(rankOf(m.from) + 1);
        else which = squareName(m.from);
      }
      san = `${t.toUpperCase()}${which}${takes}${squareName(m.to)}`;
    }
  }
  const next = makeMove(pos, m);
  if (inCheck(next)) san += legalMoves(next).length ? "+" : "#";
  return san;
}

// --- endings -------------------------------------------------------------------

/** Neither side can possibly mate: kings alone, or with one minor piece, or bishops all on one color. */
export function insufficientMaterial(board: (Piece | null)[]): boolean {
  const minors: number[] = [];
  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq];
    if (!p) continue;
    const t = typeOf(p);
    if (t === "p" || t === "r" || t === "q") return false;
    if (t !== "k") minors.push(sq);
  }
  if (minors.length <= 1) return true;
  const shade = (sq: number) => (fileOf(sq) + rankOf(sq)) % 2;
  return minors.every((sq) => typeOf(board[sq]!) === "b" && shade(sq) === shade(minors[0]!));
}

/** Whether `c` has nothing but a king (then running the other side out of time can't win). */
export function loneKing(board: (Piece | null)[], c: Color): boolean {
  return board.every((p) => !p || colorOf(p) !== c || typeOf(p) === "k");
}

/** Material on the board, in pawns. */
export function material(board: (Piece | null)[], c: Color): number {
  return board.reduce((n, p) => (p && colorOf(p) === c ? n + VALUE[typeOf(p)] : n), 0);
}

/** Positions reached from `pos` in `depth` moves: the standard move generator check. */
export function perft(pos: Position, depth: number): number {
  if (depth === 0) return 1;
  const moves = legalMoves(pos);
  if (depth === 1) return moves.length;
  return moves.reduce((n, m) => n + perft(makeMove(pos, m), depth - 1), 0);
}
