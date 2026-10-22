/**
 * Battleship for two, as a pure state machine.
 *
 * Each player hides a fleet (Carrier 5, Battleship 4, Cruiser 3, Submarine 3,
 * Destroyer 2) on their own 10×10 waters, then they take turns firing at a cell of
 * the other's. A shot is a miss or a hit; when every cell of a ship is hit, it's
 * sunk and the shooter is told which ship it was. Sink the whole fleet to win.
 *
 * Hidden information: where the ships are. A fleet's layout is only ever in its
 * owner's view until the game is over. Everyone sees every shot and its result,
 * and a sunk ship's cells (as at a real table, where you'd say "you sank my
 * Cruiser" and it's obvious where it was). A plain hit doesn't say which ship.
 *
 * Settings: whether ships may touch (default yes; they never overlap), whether a
 * hit earns another shot (default no: strict alternation), a placement clock
 * (when it runs out, unfinished fleets are completed at random) and a turn clock
 * (when it runs out, a random shot is fired for you; three in a row forfeits).
 */
import { emptySeating, requireSeat, type Seat, type Seating, seatOf, sitDown, standUp } from "../kit/seating";
import { nextTimer, setTimer, takeDueTimer, type Timers } from "../kit/timers";
import { type GameContext, GameError } from "../types";

export const SIZE = 10;
export const CELLS = SIZE * SIZE;
export const FLEET = [
  { id: "carrier", name: "Carrier", size: 5 },
  { id: "battleship", name: "Battleship", size: 4 },
  { id: "cruiser", name: "Cruiser", size: 3 },
  { id: "submarine", name: "Submarine", size: 3 },
  { id: "destroyer", name: "Destroyer", size: 2 },
] as const;
export type ShipId = (typeof FLEET)[number]["id"];
export const SHIP_IDS = FLEET.map((s) => s.id) as [ShipId, ...ShipId[]];
/** Turn clocks that run out in a row before you forfeit. */
export const MAX_TIMEOUTS = 3;

/** Seat 0 or 1. */
export type Side = 0 | 1;
export type BsSeat = Seat & { wins: number };

export interface BsConfig {
  /** Seconds per shot; run out and a random shot is fired for you. 0 = no clock. */
  turnSeconds: number;
  /** Seconds to place your fleet; run out and it's finished for you at random. 0 = no clock. */
  placeSeconds: number;
  /** Ships may sit next to each other (they can never overlap). */
  shipsMayTouch: boolean;
  /** A hit earns another shot. Off: strict alternation. */
  hitShootsAgain: boolean;
}

/** A ship on the grid: its bow at (row, col), running right, or down when vertical. */
export interface ShipPlacement {
  id: ShipId;
  row: number;
  col: number;
  vertical: boolean;
}

/** A shot as everyone sees it. */
export interface Shot {
  cell: number;
  hit: boolean;
}

export interface Fleet {
  playerId: string;
  ships: ShipPlacement[];
  ready: boolean;
  /** Cells (row * SIZE + col) fired at in this fleet's waters, in order. */
  shots: number[];
  /** Turn clocks that ran out on this player in a row. */
  timeouts: number;
}

export type BsEvent =
  /** `ship` and `cells` are only set when the shot sank a ship. `auto`: fired for them when their clock ran out. */
  | { type: "shot"; by: string; target: string; cell: number; result: "miss" | "hit" | "sunk"; ship: ShipId | null; cells: number[] | null; auto: boolean }
  | { type: "forfeit"; who: string; reason: "left" | "timeouts" };

export interface BsResult {
  winner: string;
  loser: string;
  /** Set when the game ended by forfeit rather than a sunk fleet. */
  forfeit: "left" | "timeouts" | null;
  /** Shots the winner fired. */
  shots: number;
}

export interface BsState extends Seating<BsSeat> {
  config: BsConfig;
  /** waiting: for two players. placing: hiding fleets. firing: taking shots. over: someone won. */
  phase: "waiting" | "placing" | "firing" | "over";
  game: number;
  /** By seat. */
  fleets: (Fleet | null)[];
  /** Whose shot it is (meaningful while firing). */
  turn: Side;
  /** Who shoots first next game; alternates. */
  opener: Side;
  log: BsEvent[];
  result: BsResult | null;
  timers: Timers<"turn" | "place">;
}

export function createState(config: BsConfig): BsState {
  return {
    config,
    ...emptySeating<BsSeat>(2),
    phase: "waiting",
    game: 0,
    fleets: [null, null],
    turn: 0,
    opener: 0,
    log: [],
    result: null,
    timers: {},
  };
}

// --- geometry --------------------------------------------------------------

export const shipSize = (id: ShipId) => FLEET.find((s) => s.id === id)!.size;
export const shipName = (id: ShipId) => FLEET.find((s) => s.id === id)!.name;
export const cellOf = (row: number, col: number) => row * SIZE + col;
export const rowOf = (cell: number) => Math.floor(cell / SIZE);
export const colOf = (cell: number) => cell % SIZE;
/** "A1" (top left) to "J10" (bottom right): letters across, numbers down. */
export const coord = (cell: number) => `${"ABCDEFGHIJ"[colOf(cell)]}${rowOf(cell) + 1}`;

/** The cells a ship covers, or null if it runs off the grid. */
export function shipCells(s: ShipPlacement): number[] | null {
  const n = shipSize(s.id);
  if (!Number.isInteger(s.row) || !Number.isInteger(s.col) || s.row < 0 || s.col < 0) return null;
  if (s.vertical ? s.row + n > SIZE || s.col >= SIZE : s.col + n > SIZE || s.row >= SIZE) return null;
  return Array.from({ length: n }, (_, i) => (s.vertical ? cellOf(s.row + i, s.col) : cellOf(s.row, s.col + i)));
}

function touches(a: number[], b: number[]) {
  return a.some((x) => b.some((y) => Math.abs(rowOf(x) - rowOf(y)) <= 1 && Math.abs(colOf(x) - colOf(y)) <= 1));
}

/** Why a (possibly partial) layout isn't allowed, or null if it's fine. */
export function layoutError(ships: ShipPlacement[], mayTouch: boolean): string | null {
  const seen = new Set<string>();
  const placed: number[][] = [];
  for (const s of ships) {
    if (!SHIP_IDS.includes(s.id)) return "That's not a ship in the fleet.";
    if (seen.has(s.id)) return `There's only one ${shipName(s.id)}.`;
    seen.add(s.id);
    const cells = shipCells(s);
    if (!cells) return `The ${shipName(s.id)} doesn't fit there.`;
    for (const other of placed) {
      if (cells.some((c) => other.includes(c))) return "Ships can't overlap.";
      if (!mayTouch && touches(cells, other)) return "Ships can't touch in this game.";
    }
    placed.push(cells);
  }
  return null;
}

/** Fill in the missing ships at random around the ones already placed (or start over if they don't fit). */
export function randomLayout(randomInt: (n: number) => number, mayTouch: boolean, keep: ShipPlacement[] = []): ShipPlacement[] {
  for (let attempt = 0; attempt < 100; attempt++) {
    // If the kept ships box everything in, give up on them after a few tries.
    const ships = attempt < 10 ? [...keep] : [];
    // Cells a new ship can't use: taken, or (when ships mustn't touch) next to a ship.
    const blocked = Array.from({ length: CELLS }, () => false);
    const block = (s: ShipPlacement) => {
      for (const c of shipCells(s)!) {
        if (mayTouch) blocked[c] = true;
        else for (const n of around(c)) blocked[n] = true;
      }
    };
    ships.forEach(block);
    let stuck = false;
    for (const { id } of FLEET) {
      if (ships.some((s) => s.id === id)) continue;
      const options: ShipPlacement[] = [];
      for (let row = 0; row < SIZE; row++) {
        for (let col = 0; col < SIZE; col++) {
          for (const vertical of [false, true]) {
            const s = { id, row, col, vertical };
            if (shipCells(s)?.every((c) => !blocked[c])) options.push(s);
          }
        }
      }
      if (!options.length) {
        stuck = true;
        break;
      }
      const s = options[randomInt(options.length)]!;
      ships.push(s);
      block(s);
    }
    if (!stuck) return sortFleet(ships);
  }
  throw new Error("couldn't place a fleet"); // can't happen on a 10×10 grid
}

/** A cell and its (up to 8) neighbours. */
function around(cell: number): number[] {
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const r = rowOf(cell) + dr;
      const c = colOf(cell) + dc;
      if (r >= 0 && r < SIZE && c >= 0 && c < SIZE) out.push(cellOf(r, c));
    }
  }
  return out;
}

const sortFleet = (ships: ShipPlacement[]) => [...ships].sort((a, b) => SHIP_IDS.indexOf(a.id) - SHIP_IDS.indexOf(b.id));

/** Every cell with a ship on it. */
function occupied(fleet: Fleet): Set<number> {
  return new Set(fleet.ships.flatMap((s) => shipCells(s)!));
}

function shipAt(fleet: Fleet, cell: number): ShipPlacement | undefined {
  return fleet.ships.find((s) => shipCells(s)!.includes(cell));
}

export function isSunk(fleet: Fleet, s: ShipPlacement): boolean {
  return shipCells(s)!.every((c) => fleet.shots.includes(c));
}

function allSunk(fleet: Fleet) {
  return fleet.ships.length === FLEET.length && fleet.ships.every((s) => isSunk(fleet, s));
}

const shotsFired = (fleet: Fleet | null) => fleet?.shots.length ?? 0;

// --- seating ---------------------------------------------------------------

const bothSeated = (state: BsState) => state.seats.every(Boolean);

export function sit(state: BsState, playerId: string, seat: number, ctx: GameContext) {
  sitDown(state, playerId, seat, () => ({ wins: 0 }));
  // The first game starts as soon as both seats fill; after a game, "Play again" starts the next.
  if (state.phase === "waiting" && bothSeated(state)) startGame(state, ctx);
}

export function leave(state: BsState, playerId: string, ctx: GameContext) {
  const seat = requireSeat(state, playerId) as Side;
  if (state.phase === "placing") {
    // Nothing's been fired yet: just call the game off.
    state.phase = "waiting";
    state.fleets = [null, null];
    setTimer(state.timers, "place", null);
  } else if (state.phase === "firing") {
    state.log.push({ type: "forfeit", who: playerId, reason: "left" });
    finish(state, (1 - seat) as Side, "left", ctx);
  }
  standUp(state, playerId);
}

// --- placing ---------------------------------------------------------------

function startGame(state: BsState, ctx: GameContext) {
  if (!bothSeated(state)) throw new GameError("not_enough_players", "Two players need to be seated.");
  state.phase = "placing";
  state.game++;
  state.fleets = state.seats.map((s) => ({ playerId: s!.playerId, ships: [], ready: false, shots: [], timeouts: 0 }));
  state.log = [];
  state.result = null;
  setTimer(state.timers, "turn", null);
  const secs = state.config.placeSeconds;
  setTimer(state.timers, "place", secs > 0 ? ctx.now + secs * 1000 : null);
}

export function rematch(state: BsState, actor: string, ctx: GameContext) {
  requireSeat(state, actor);
  if (state.phase !== "over") throw new GameError("in_progress", "A game is already on.");
  startGame(state, ctx);
}

/** The actor's fleet while they're still placing it. */
function placingFleet(state: BsState, actor: string): Fleet {
  const seat = requireSeat(state, actor);
  if (state.phase !== "placing") throw new GameError("not_placing", "Ships are placed before the shooting starts.");
  const fleet = state.fleets[seat]!;
  if (fleet.ready) throw new GameError("ready", "You're ready. Change your fleet first.");
  return fleet;
}

/** Set your (possibly unfinished) layout. */
export function arrange(state: BsState, actor: string, ships: ShipPlacement[]) {
  const fleet = placingFleet(state, actor);
  const err = layoutError(ships, state.config.shipsMayTouch);
  if (err) throw new GameError("bad_layout", err);
  fleet.ships = sortFleet(ships.map((s) => ({ id: s.id, row: s.row, col: s.col, vertical: s.vertical })));
}

export function randomize(state: BsState, actor: string, ctx: GameContext) {
  const fleet = placingFleet(state, actor);
  fleet.ships = randomLayout(ctx.randomInt, state.config.shipsMayTouch);
}

export function ready(state: BsState, actor: string, ctx: GameContext) {
  const fleet = placingFleet(state, actor);
  if (fleet.ships.length !== FLEET.length) throw new GameError("fleet_incomplete", "Place all five ships first.");
  fleet.ready = true;
  if (state.fleets.every((f) => f!.ready)) startFiring(state, ctx);
}

export function unready(state: BsState, actor: string) {
  const seat = requireSeat(state, actor);
  if (state.phase !== "placing") throw new GameError("not_placing", "The shooting has started.");
  state.fleets[seat]!.ready = false;
}

function startFiring(state: BsState, ctx: GameContext) {
  state.phase = "firing";
  setTimer(state.timers, "place", null);
  state.turn = state.opener;
  state.opener = (1 - state.opener) as Side;
  startTurn(state, ctx);
}

// --- firing ----------------------------------------------------------------

function startTurn(state: BsState, ctx: GameContext) {
  const secs = state.config.turnSeconds;
  setTimer(state.timers, "turn", secs > 0 ? ctx.now + secs * 1000 : null);
}

export function fire(state: BsState, actor: string, cell: number, ctx: GameContext, auto = false) {
  const seat = requireSeat(state, actor) as Side;
  if (state.phase !== "firing") throw new GameError("not_firing", "There's nothing to fire at yet.");
  if (state.turn !== seat) throw new GameError("not_your_turn", "It's not your turn.");
  if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS) throw new GameError("bad_cell", "That's off the grid.");
  const target = state.fleets[1 - seat]!;
  if (target.shots.includes(cell)) throw new GameError("already_fired", `You've already fired at ${coord(cell)}.`);
  if (!auto) state.fleets[seat]!.timeouts = 0;

  const ship = shipAt(target, cell);
  target.shots.push(cell);
  const sunk = !!ship && isSunk(target, ship);
  state.log.push({
    type: "shot",
    by: actor,
    target: target.playerId,
    cell,
    result: sunk ? "sunk" : ship ? "hit" : "miss",
    ship: sunk ? ship.id : null,
    cells: sunk ? shipCells(ship)! : null,
    auto,
  });
  if (allSunk(target)) return finish(state, seat, null, ctx);
  if (!(ship && state.config.hitShootsAgain)) state.turn = (1 - seat) as Side;
  startTurn(state, ctx);
}

function finish(state: BsState, winner: Side, forfeit: BsResult["forfeit"], ctx: GameContext) {
  state.phase = "over";
  setTimer(state.timers, "turn", null);
  setTimer(state.timers, "place", null);
  const w = state.fleets[winner]!;
  const l = state.fleets[1 - winner]!;
  state.result = { winner: w.playerId, loser: l.playerId, forfeit, shots: shotsFired(l) };
  const seat = state.seats[winner];
  if (seat?.playerId === w.playerId) seat.wins++;
  const [wn, ln] = [ctx.nameOf(w.playerId), ctx.nameOf(l.playerId)];
  if (forfeit === "left") ctx.announce(`Battleship game ${state.game}: ${wn} wins, ${ln} left the battle.`);
  else if (forfeit === "timeouts") ctx.announce(`Battleship game ${state.game}: ${wn} wins, ${ln} ran out of time ${MAX_TIMEOUTS} times in a row.`);
  else ctx.announce(`Battleship game ${state.game}: ${wn} sank ${ln}'s whole fleet in ${state.result.shots} shots!`);
}

// --- timers ----------------------------------------------------------------

export function nextDeadline(state: BsState): number | null {
  return nextTimer(state.timers);
}

export function onDeadline(state: BsState, ctx: GameContext) {
  const due = takeDueTimer(state.timers, ctx.now);
  if (due === "place" && state.phase === "placing") {
    // Out of time: finish unfinished fleets at random, keeping what's been placed.
    for (const fleet of state.fleets) {
      if (fleet!.ready) continue;
      fleet!.ships = randomLayout(ctx.randomInt, state.config.shipsMayTouch, fleet!.ships);
      fleet!.ready = true;
    }
    startFiring(state, ctx);
  } else if (due === "turn" && state.phase === "firing") {
    const fleet = state.fleets[state.turn]!;
    fleet.timeouts++;
    if (fleet.timeouts >= MAX_TIMEOUTS) {
      state.log.push({ type: "forfeit", who: fleet.playerId, reason: "timeouts" });
      return finish(state, (1 - state.turn) as Side, "timeouts", ctx);
    }
    const open = openCells(state.fleets[1 - state.turn]!);
    fire(state, fleet.playerId, open[ctx.randomInt(open.length)]!, ctx, true);
  }
}

export function openCells(target: Fleet): number[] {
  const fired = new Set(target.shots);
  return Array.from({ length: CELLS }, (_, i) => i).filter((i) => !fired.has(i));
}

// --- who and what ----------------------------------------------------------

export function waitingOn(state: BsState): string[] {
  if (state.phase === "placing") return state.fleets.flatMap((f) => (f && !f.ready ? [f.playerId] : []));
  if (state.phase === "firing") return [state.fleets[state.turn]!.playerId];
  return [];
}

export function canRematch(state: BsState) {
  return state.phase === "over" && bothSeated(state);
}

export function checkInvariants(state: BsState) {
  if (state.fleets.length !== 2) throw new Error("need two fleets");
  for (const f of state.fleets) {
    if (!f) continue;
    const err = layoutError(f.ships, state.config.shipsMayTouch);
    if (err) throw new Error(`bad layout: ${err}`);
    if (f.ready && f.ships.length !== FLEET.length) throw new Error("ready with an unfinished fleet");
    if (new Set(f.shots).size !== f.shots.length) throw new Error("fired at the same cell twice");
    if (f.shots.some((c) => !Number.isInteger(c) || c < 0 || c >= CELLS)) throw new Error("fired off the grid");
    if (f.shots.length && !f.ready) throw new Error("fired at an unready fleet");
  }
  if (state.phase === "placing" || state.phase === "firing") {
    for (const [i, f] of state.fleets.entries()) {
      if (f?.playerId !== state.seats[i]?.playerId) throw new Error(`fleet ${i} doesn't belong to whoever's seated`);
    }
  }
  if (state.phase === "placing" && state.fleets.every((f) => f!.ready)) throw new Error("everyone's ready but still placing");
  if (state.phase === "firing") {
    if (!state.fleets.every((f) => f!.ready)) throw new Error("firing before everyone's ready");
    if (state.fleets.some((f) => allSunk(f!))) throw new Error("firing at a sunk fleet");
    const [a, b] = state.fleets.map(shotsFired);
    if (!state.config.hitShootsAgain && Math.abs(a! - b!) > 1) throw new Error(`shots out of step: ${a} vs ${b}`);
  }
  if (state.phase === "over" && state.result && !state.result.forfeit) {
    const loser = state.fleets.find((f) => f?.playerId === state.result!.loser);
    if (!loser || !allSunk(loser)) throw new Error("won without sinking the fleet");
  }
}

// --- views -----------------------------------------------------------------

export interface BoardView {
  seat: Side;
  playerId: string;
  ready: boolean;
  /** Shots fired into these waters, in order. Public. */
  shots: Shot[];
  /** Ships of this fleet that are sunk, and where they were. Public. */
  sunk: { id: ShipId; cells: number[] }[];
  /** The whole layout: only for its owner, or for everyone once the game is over. */
  ships: ShipPlacement[] | null;
  /** Turn clocks that ran out on this player in a row. */
  timeouts: number;
}

export interface BsView {
  config: BsConfig;
  seats: (BsSeat | null)[];
  phase: BsState["phase"];
  game: number;
  /** Whose shot it is, while firing. */
  turn: Side | null;
  turnDeadline: number | null;
  placeDeadline: number | null;
  /** By seat; empty before the first game. */
  boards: (BoardView | null)[];
  /** The latest events, oldest first. */
  log: BsEvent[];
  result: BsResult | null;
  canRematch: boolean;
  you: { seat: Side | null };
}

const LOG_IN_VIEW = 30;

function eventView(e: BsEvent): BsEvent {
  return e.type === "shot"
    ? { type: "shot", by: e.by, target: e.target, cell: e.cell, result: e.result, ship: e.ship, cells: e.cells ? [...e.cells] : null, auto: e.auto }
    : { type: "forfeit", who: e.who, reason: e.reason };
}

function boardView(f: Fleet, seat: Side, showShips: boolean): BoardView {
  const ships = occupied(f);
  return {
    seat,
    playerId: f.playerId,
    ready: f.ready,
    shots: f.shots.map((cell) => ({ cell, hit: ships.has(cell) })),
    sunk: f.ships.filter((s) => isSunk(f, s)).map((s) => ({ id: s.id, cells: shipCells(s)! })),
    ships: showShips ? f.ships.map((s) => ({ id: s.id, row: s.row, col: s.col, vertical: s.vertical })) : null,
    timeouts: f.timeouts,
  };
}

/** Built field by field: never spread from state, so a fleet's layout can't leak. */
export function viewFor(state: BsState, viewer: string): BsView {
  const seat = seatOf(state, viewer);
  const reveal = state.phase === "over";
  return {
    config: {
      turnSeconds: state.config.turnSeconds,
      placeSeconds: state.config.placeSeconds,
      shipsMayTouch: state.config.shipsMayTouch,
      hitShootsAgain: state.config.hitShootsAgain,
    },
    seats: state.seats.map((s) => (s ? { playerId: s.playerId, sittingOut: s.sittingOut, wins: s.wins } : null)),
    phase: state.phase,
    game: state.game,
    turn: state.phase === "firing" ? state.turn : null,
    turnDeadline: state.phase === "firing" ? (state.timers.turn ?? null) : null,
    placeDeadline: state.phase === "placing" ? (state.timers.place ?? null) : null,
    boards: state.fleets.map((f, i) => (f ? boardView(f, i as Side, reveal || f.playerId === viewer) : null)),
    log: state.log.slice(-LOG_IN_VIEW).map(eventView),
    result: state.result
      ? { winner: state.result.winner, loser: state.result.loser, forfeit: state.result.forfeit, shots: state.result.shots }
      : null,
    canRematch: canRematch(state),
    you: { seat: seat < 0 ? null : (seat as Side) },
  };
}
