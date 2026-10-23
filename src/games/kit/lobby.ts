/**
 * The table moves most games share: taking and leaving a seat, sitting out a round,
 * and starting. Games build their op schema from these, so anything that plays
 * generically (bots, the conformance tests) can tell table moves from game moves
 * without knowing the game.
 */
import { z } from "zod";
import { type Seat, type Seating, seatOf } from "./seating";

export const lobbyOps = {
  /** Take an empty seat. */
  sit: (seatCount: number) => z.object({ type: z.literal("sit"), seat: z.number().int().min(0).max(seatCount - 1) }),
  /** Give up your seat (forfeiting whatever is in progress). */
  leave: z.object({ type: z.literal("leave") }),
  /** Keep your seat but skip the next rounds. */
  sitOut: z.object({ type: z.literal("sitOut") }),
  sitIn: z.object({ type: z.literal("sitIn") }),
  /** Start the next game or hand with whoever is seated. */
  start: z.object({ type: z.literal("start") }),
};

/** Sitting down and leaving: every seated game has these. */
export type SeatOp = { type: "sit"; seat: number } | { type: "leave" };
export type LobbyOp = SeatOp | { type: "sitOut" } | { type: "sitIn" } | { type: "start" };

const LOBBY_TYPES = new Set<string>(["sit", "leave", "sitOut", "sitIn", "start"]);

export function isLobbyOp(op: unknown): op is LobbyOp {
  return typeof op === "object" && op !== null && LOBBY_TYPES.has((op as { type?: string }).type ?? "");
}

/**
 * The legal table moves for a player: a seat to take if they have none, otherwise
 * leaving, sitting out or back in (if the game has it), and starting when it can.
 */
export function legalLobbyOps(t: Seating<Seat>, player: string): SeatOp[];
export function legalLobbyOps(t: Seating<Seat>, player: string, opts: { sitOut?: boolean; canStart?: boolean }): LobbyOp[];
export function legalLobbyOps(t: Seating<Seat>, player: string, opts: { sitOut?: boolean; canStart?: boolean } = {}): LobbyOp[] {
  const seat = seatOf(t, player);
  if (seat < 0) return t.seats.flatMap((s, i) => (s ? [] : [{ type: "sit" as const, seat: i }]));
  const ops: LobbyOp[] = [{ type: "leave" }];
  if (opts.sitOut) ops.push(t.seats[seat]!.sittingOut ? { type: "sitIn" } : { type: "sitOut" });
  if (opts.canStart) ops.push({ type: "start" });
  return ops;
}
