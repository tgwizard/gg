/**
 * Tic-tac-toe: the smallest complete game, and a template for new ones. It uses
 * the shared kit for seats (scores survive standing up) and timers (turn clock,
 * pause between rounds). There's no hidden information, so the view is the state.
 */
import { z } from "zod";
import { legalLobbyOps, lobbyOps } from "../kit/lobby";
import { emptySeating, requireSeat, type Seat, type Seating, seatedPlayers, seatOf, sitDown, standUp } from "../kit/seating";
import { nextTimer, setTimer, takeDueTimer, type Timers } from "../kit/timers";
import { type GameContext, type GameDefinition, GameError } from "../types";
import { ticTacToeMeta } from "./meta";

/** Seat 0 plays X, seat 1 plays O. */
export type Mark = 0 | 1;
export type TttSeat = Seat & { wins: number };

export interface TttConfig {
  /** Seconds per move before forfeiting the round; 0 disables the clock. */
  turnSeconds: number;
}

export interface TttResult {
  winner: Mark | null;
  line: number[] | null;
  forfeit: boolean;
}

export interface TttState extends Seating<TttSeat> {
  config: TttConfig;
  board: (Mark | null)[];
  status: "waiting" | "playing" | "over";
  turn: Mark;
  /** Who opens the next round; alternates. */
  opener: Mark;
  round: number;
  draws: number;
  result: TttResult | null;
  timers: Timers<"turn" | "nextRound">;
}

export interface TttView extends Omit<TttState, "timers" | "away"> {
  turnDeadline: number | null;
  nextRoundAt: number | null;
  you: { seat: Mark | null };
}

export const NEXT_ROUND_DELAY_MS = 3500;
const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];
const MARK = ["X", "O"] as const;

const configSchema = z.object({ turnSeconds: z.number().int().min(0).max(600).default(30) });

export const tttOp = z.discriminatedUnion("type", [
  lobbyOps.sit(2),
  lobbyOps.leave,
  z.object({ type: z.literal("place"), cell: z.number().int().min(0).max(8) }),
]);
export type TttOp = z.infer<typeof tttOp>;

function bothSeated(state: TttState) {
  return state.seats.every(Boolean);
}

function startRound(state: TttState, ctx: GameContext) {
  state.board = Array.from({ length: 9 }, () => null);
  state.status = "playing";
  state.turn = state.opener;
  state.opener = (1 - state.opener) as Mark;
  state.round++;
  state.result = null;
  setTimer(state.timers, "nextRound", null);
  startTurn(state, ctx);
}

function startTurn(state: TttState, ctx: GameContext) {
  const secs = state.config.turnSeconds;
  setTimer(state.timers, "turn", secs > 0 ? ctx.now + secs * 1000 : null);
}

function endRound(state: TttState, result: TttResult, ctx: GameContext) {
  state.status = "over";
  state.result = result;
  setTimer(state.timers, "turn", null);
  const name = (m: Mark) => ctx.nameOf(state.seats[m]?.playerId ?? "");
  if (result.winner === null) {
    state.draws++;
    ctx.announce(`Round ${state.round}: a draw.`);
  } else {
    const winner = state.seats[result.winner];
    if (winner) winner.wins++;
    const how = result.forfeit ? ` (${name((1 - result.winner) as Mark) || "the other player"} forfeited)` : "";
    ctx.announce(`Round ${state.round}: ${name(result.winner)} wins as ${MARK[result.winner]}${how}.`);
  }
  setTimer(state.timers, "nextRound", bothSeated(state) ? ctx.now + NEXT_ROUND_DELAY_MS : null);
}

/** Give up a seat (forfeiting a round in progress); the next round waits for someone to take it. */
function leave(state: TttState, actor: string, ctx: GameContext) {
  const seat = requireSeat(state, actor) as Mark;
  if (state.status === "playing") endRound(state, { winner: (1 - seat) as Mark, line: null, forfeit: true }, ctx);
  standUp(state, actor);
  setTimer(state.timers, "nextRound", null);
}

function place(state: TttState, actor: string, cell: number, ctx: GameContext) {
  const seat = requireSeat(state, actor) as Mark;
  if (state.status !== "playing") throw new GameError("not_playing", "The round isn't on.");
  if (state.turn !== seat) throw new GameError("not_your_turn", "It's not your turn.");
  if (state.board[cell] !== null) throw new GameError("taken", "That square is taken.");
  state.board[cell] = seat;
  const line = LINES.find((l) => l.every((c) => state.board[c] === seat));
  if (line) return endRound(state, { winner: seat, line, forfeit: false }, ctx);
  if (state.board.every((c) => c !== null)) return endRound(state, { winner: null, line: null, forfeit: false }, ctx);
  state.turn = (1 - seat) as Mark;
  startTurn(state, ctx);
}

export const ticTacToe: GameDefinition<TttState, TttOp, TttView, TttConfig> = {
  meta: ticTacToeMeta,
  configSchema,
  opSchema: tttOp,
  create: (config) => ({
    config,
    ...emptySeating<TttSeat>(2),
    board: Array.from({ length: 9 }, () => null),
    status: "waiting",
    turn: 0,
    opener: 0,
    round: 0,
    draws: 0,
    result: null,
    timers: {},
  }),
  apply(state, actor, op, ctx) {
    switch (op.type) {
      case "sit":
        sitDown(state, actor, op.seat, () => ({ wins: 0 }));
        if (bothSeated(state) && state.status !== "playing") startRound(state, ctx);
        return;
      case "leave":
        return leave(state, actor, ctx);
      case "place":
        return place(state, actor, op.cell, ctx);
    }
  },
  view(state, viewer) {
    const { timers, away: _away, ...rest } = state;
    const seat = seatOf(state, viewer);
    return {
      ...structuredClone(rest),
      turnDeadline: timers.turn ?? null,
      nextRoundAt: timers.nextRound ?? null,
      you: { seat: seat < 0 ? null : (seat as Mark) },
    };
  },
  players: seatedPlayers,
  removePlayer: leave,
  waitingOn: (state) => (state.status === "playing" ? [state.seats[state.turn]!.playerId] : []),
  legalOps(state, player) {
    const seat = seatOf(state, player);
    const ops: TttOp[] = legalLobbyOps(state, player);
    if (seat >= 0 && state.status === "playing" && state.turn === seat) {
      state.board.forEach((c, cell) => c === null && ops.push({ type: "place", cell }));
    }
    return ops;
  },
  nextDeadline: (state) => nextTimer(state.timers),
  onDeadline(state, ctx) {
    const due = takeDueTimer(state.timers, ctx.now);
    if (due === "turn" && state.status === "playing") {
      // Out of time: you forfeit the round and give up your seat, so nobody racks up wins
      // against an empty chair (and a table nobody's at stops playing itself).
      const late = state.seats[state.turn]!.playerId;
      leave(state, late, ctx);
      ctx.announce(`${ctx.nameOf(late)} ran out of time and left the table.`);
    } else if (due === "nextRound") {
      if (bothSeated(state)) startRound(state, ctx);
      else state.status = "waiting";
    }
  },
  bot: {
    // Takes a win when it sees one and blocks about half the time, so it's beatable.
    easy(view, ops, rand) {
      const cells = ops.flatMap((op) => (op.type === "place" ? [op.cell] : []));
      const me = view.you.seat;
      if (!cells.length || me === null) return null;
      const completes = (mark: Mark) => cells.find((c) => LINES.some((l) => l.includes(c) && l.every((x) => x === c || view.board[x] === mark)));
      const cell = completes(me) ?? (rand(2) === 0 ? completes((1 - me) as Mark) : undefined) ?? cells[rand(cells.length)]!;
      return { type: "place", cell };
    },
  },
  checkInvariants(state) {
    const x = state.board.filter((c) => c === 0).length;
    const o = state.board.filter((c) => c === 1).length;
    if (Math.abs(x - o) > 1) throw new Error(`board has ${x} X and ${o} O`);
    if (state.status === "playing" && !bothSeated(state)) throw new Error("playing without two players");
  },
};
