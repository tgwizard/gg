import { describe, expect, it } from "vitest";
import { castlingOptions, insufficientMaterial, isCapture, moveFacts, legalMoves, makeMove, parseFen, parseUci, perft, positionKey, premoves, START_FEN, toFen, toSan, toUci } from "./rules";

/** Play UCI moves from a FEN, returning the SAN of each and the final position. */
function play(fen: string, ...ucis: string[]) {
  let pos = parseFen(fen);
  const sans: string[] = [];
  for (const uci of ucis) {
    const m = legalMoves(pos).find((l) => toUci(l) === uci);
    if (!m) throw new Error(`${uci} isn't legal in ${toFen(pos)}`);
    sans.push(toSan(pos, m));
    pos = makeMove(pos, m);
  }
  return { pos, sans };
}

describe("chess rules", () => {
  // Known move counts (https://www.chessprogramming.org/Perft_Results): these catch
  // nearly every move generator bug (castling through check, en passant pins, promotions).
  it.each([
    [START_FEN, [20, 400, 8902]],
    ["r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", [48, 2039, 97862]],
    ["8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", [14, 191, 2812, 43238]],
    ["r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1", [6, 264, 9467]],
    ["rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8", [44, 1486, 62379]],
    ["r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10", [46, 2079, 89890]],
  ])("counts the positions from %s", (fen, counts) => {
    const pos = parseFen(fen);
    counts.forEach((n, i) => expect(perft(pos, i + 1)).toBe(n));
  });

  it("round-trips FEN", () => {
    for (const fen of [START_FEN, "r3k2r/8/8/8/3pP3/8/8/R3K2R b Kq e3 0 23"]) expect(toFen(parseFen(fen))).toBe(fen);
  });

  it("writes SAN, with checks, mates, castling and which piece moved", () => {
    expect(play(START_FEN, "f2f3", "e7e5", "g2g4", "d8h4").sans).toEqual(["f3", "e5", "g4", "Qh4#"]);
    expect(play("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "e1g1", "e8c8").sans).toEqual(["O-O", "O-O-O"]);
    // Two knights can reach d2; two rooks on one file can reach a4.
    expect(play("4k3/8/8/8/8/8/8/1N2KN2 w - - 0 1", "b1d2").sans).toEqual(["Nbd2"]);
    expect(play("4k3/8/R7/8/8/8/R7/4K3 w - - 0 1", "a2a4").sans).toEqual(["R2a4"]);
    expect(play("4k3/1P6/8/8/8/8/8/4K3 w - - 0 1", "b7b8q").sans).toEqual(["b8=Q+"]);
    expect(play("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1", "e5d6").sans).toEqual(["exd6"]);
  });

  it("takes en passant only right after the double step, and not into check", () => {
    const { pos } = play(START_FEN, "e2e4", "a7a6", "e4e5", "d7d5");
    expect(legalMoves(pos).map(toUci)).toContain("e5d6");
    const after = play(toFen(pos), "e5d6").pos;
    expect(after.board[parseUci("d5a1")!.from]).toBeNull(); // the d5 pawn is gone
    // Taking would expose the king along the rank.
    expect(legalMoves(parseFen("8/8/8/K2pP2r/8/8/8/7k w - d6 0 1")).map(toUci)).not.toContain("e5d6");
  });

  it("loses castling rights when the king or rook moves or the rook is taken", () => {
    expect(play("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "h1h2").pos.castling).toBe("Qkq");
    expect(play("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "e1e2").pos.castling).toBe("kq");
    expect(play("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "a1a8").pos.castling).toBe("Kk");
    // No castling out of, through or into check.
    expect(legalMoves(parseFen("r3k2r/8/8/8/8/8/8/R3K1qR w KQkq - 0 1")).map(toUci)).not.toContain("e1g1");
    expect(legalMoves(parseFen("r3k2r/8/8/8/8/5r2/8/R3K2R w KQkq - 0 1")).map(toUci)).not.toContain("e1g1");
  });

  it("says what a move takes, en passant included", () => {
    const pos = parseFen("4k3/8/8/3pP3/8/8/8/R3K2r w - d6 0 1");
    expect(moveFacts(pos, parseUci("e5d6")!)).toEqual({ piece: "p", took: "p", tookAt: parseUci("d5d5")!.from });
    expect(moveFacts(pos, parseUci("a1a8")!)).toEqual({ piece: "r", took: null, tookAt: null });
  });

  it("knows when nobody can mate", () => {
    expect(insufficientMaterial(parseFen("8/8/4k3/8/8/2KB4/8/8 w - - 0 1").board)).toBe(true);
    expect(insufficientMaterial(parseFen("8/8/4k3/8/8/2KN4/8/8 w - - 0 1").board)).toBe(true);
    expect(insufficientMaterial(parseFen("8/1b6/4k3/8/8/2KB4/8/8 w - - 0 1").board)).toBe(true); // both bishops on light squares
    expect(insufficientMaterial(parseFen("8/2b5/4k3/8/8/2KB4/8/8 w - - 0 1").board)).toBe(false);
    expect(insufficientMaterial(parseFen("8/8/4k3/8/8/2KNN3/8/8 w - - 0 1").board)).toBe(false);
    expect(insufficientMaterial(parseFen("8/8/4k3/8/8/2K5/7P/8 w - - 0 1").board)).toBe(false);
  });

  it("says why a king can't castle now", () => {
    const why = (fen: string) => Object.fromEntries(castlingOptions(parseFen(fen), "w").map((o) => [o.side, o.why]));
    expect(why("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1")).toEqual({ kingside: null, queenside: null });
    expect(why("4k3/8/8/8/8/8/8/R2QK1NR w KQ - 0 1")).toEqual({ kingside: expect.stringContaining("Clear g1 first"), queenside: expect.stringContaining("Clear d1 first") });
    expect(why("4k3/8/8/8/8/8/8/R3K2R w K - 0 1")).toEqual({ kingside: null }); // the a1 rook has moved
    expect(why("4k3/8/8/8/8/8/8/R3K2R w - - 0 1")).toEqual({}); // the king has moved
    expect(why("4k3/8/8/8/8/8/8/R4K1R w KQ - 0 1")).toEqual({});
    expect(why("4r1k1/8/8/8/8/8/8/R3K2R w KQ - 0 1")).toEqual({ kingside: "Not while your king is in check.", queenside: "Not while your king is in check." });
    expect(why("2r1k3/8/8/8/8/8/8/R3K2R w KQ - 0 1").queenside).toContain("(c1)");
    expect(why(START_FEN).queenside).toContain("Clear b1, c1 and d1 first");
    // b1 isn't crossed by the king: attacked, it doesn't matter.
    expect(why("1r2k3/8/8/8/8/8/8/R3K2R w KQ - 0 1").queenside).toBeNull();
    expect(why("r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1").kingside).toBe("Not your move yet.");
  });

  it("premoves: what a piece could do whatever the other side does first", () => {
    const dests = (fen: string, from: string) => premoves(parseFen(fen), "w").filter((m) => toUci(m).startsWith(from)).map((m) => toUci(m).slice(2));
    // A pawn can aim diagonally at an empty square (something may land there), not forward into its own piece.
    expect(dests("4k3/8/8/8/8/4N3/4P3/4K3 b - - 0 1", "e2").sort()).toEqual(["d3", "f3"]);
    // A rook stops at its own piece (it may be taken, to take back), and sees past one of theirs.
    expect(dests("4k3/8/8/8/R2p1p1P/8/8/4K3 b - - 0 1", "a4").sort()).toEqual(["a1", "a2", "a3", "a5", "a6", "a7", "a8", "b4", "c4", "d4", "e4", "f4"]);
    // Never onto its own king; castling while the other side moves, when only theirs could be in the way.
    expect(dests("4k3/8/8/8/8/8/8/R3K2R b KQ - 0 1", "h1")).not.toContain("e1");
    expect(dests("4k3/8/8/8/8/8/8/R3K1nR b KQ - 0 1", "e1")).toContain("g1");
    expect(dests("4k3/8/8/8/8/8/8/R3K1NR b KQ - 0 1", "e1")).not.toContain("g1");
  });

  it("premoves cover every move the other side's reply could allow", () => {
    let seed = 7;
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % n);
    const missed: string[] = [];
    for (let game = 0; game < 20; game++) {
      let pos = parseFen(START_FEN);
      for (let ply = 0; ply < 80; ply++) {
        const replies = legalMoves(pos);
        if (!replies.length) break;
        const waiting = new Set(premoves(pos, pos.turn === "w" ? "b" : "w").map(toUci));
        for (const r of replies) {
          // Castling and en passant take two pieces off a line at once: not covered.
          const two = (pos.board[r.from] === "K" || pos.board[r.from] === "k") && Math.abs(r.to - r.from) === 2;
          if (two || (isCapture(pos, r) && !pos.board[r.to])) continue;
          for (const m of legalMoves(makeMove(pos, r))) if (!waiting.has(toUci(m))) missed.push(`${toUci(m)} after ${toUci(r)} in ${toFen(pos)}`);
        }
        pos = makeMove(pos, replies[rand(replies.length)]!);
      }
    }
    expect(missed).toEqual([]);
  });

  it("counts an en passant square in a repeated position only when it can be used", () => {
    const noPawn = play(START_FEN, "e2e4").pos;
    expect(positionKey(noPawn)).not.toContain("e3");
    const canTake = play("4k3/8/8/8/3p4/8/4P3/4K3 w - - 0 1", "e2e4").pos;
    expect(positionKey(canTake)).toContain("e3");
  });
});
