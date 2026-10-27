/**
 * Unicorn race, as a pure state machine.
 *
 * 1–4 unicorns gallop round a loop of stops, rolling a die. Where you stop you pick up a
 * friend you don't have yet (one kind of friend at most stops, a choice at some, none on
 * the meadow). With all six aboard, the rainbow bridge opens for you: at the start you
 * turn onto it instead of going round again, and the first over it to the castle wins.
 * Every roll charges a shared rainbow, and when it's full every kid at the table gets a
 * rainbow roll: another roll after their move.
 *
 * Nothing is hidden, so the view is the state (built field by field all the same).
 */
import { emptySeating, nextClockwise, requireSeat, type Seat, type Seating, seatOf, seatsWhere, sitDown, standUp } from "../kit/seating";
import { type GameContext, GameError } from "../types";

export const SEAT_COUNT = 4;

/** The six friends to pick up, one of each color of the rainbow, in rainbow order. */
export const RIDERS = ["ladybug", "fox", "chick", "frog", "whale", "octopus"] as const;
export type Rider = (typeof RIDERS)[number];
export const RIDER_NAMES: Record<Rider, string> = { ladybug: "Ladybug", fox: "Fox", chick: "Chick", frog: "Frog", whale: "Whale", octopus: "Octopus" };

export interface Stop {
  kind: "start" | "meadow" | "stop" | "station";
  /** Who can be picked up here. */
  riders: Rider[];
}

const at = (...riders: Rider[]): Stop => ({ kind: riders.length > 1 ? "station" : "stop", riders });
const meadow: Stop = { kind: "meadow", riders: [] };

/**
 * The loop, from the start. Each friend has two stops of their own and is at three of the
 * stations, so none is much harder to find than another; about a third is meadow.
 */
export const TRACK: Stop[] = [
  { kind: "start", riders: [] },
  meadow,
  at("ladybug"),
  at("fox"),
  meadow,
  at("chick", "frog"),
  at("whale"),
  meadow,
  at("octopus"),
  at("ladybug", "whale", "fox"),
  meadow,
  at("frog"),
  at("chick"),
  meadow,
  at("octopus", "fox"),
  at("ladybug"),
  meadow,
  at("whale"),
  at("frog", "chick", "octopus"),
  at("fox"),
  meadow,
  at("chick"),
  at("whale", "ladybug"),
  meadow,
  at("frog"),
  at("octopus"),
  meadow,
  at("fox", "frog", "whale"),
  meadow,
  at("ladybug", "chick", "octopus"),
];

/** Stops on the loop; positions from here on are on the rainbow bridge. */
export const LOOP = TRACK.length;
/** Stops on the rainbow bridge after the start, the castle last. */
export const BRIDGE = 6;
/** The castle: the finish. */
export const FINISH = LOOP + BRIDGE - 1;

/**
 * The stop after `at`: round the loop, or for a unicorn with all six friends (`homeward`)
 * from the start onto the bridge, and along it to the castle.
 */
export function nextStop(at: number, homeward: boolean): number {
  if (at >= LOOP) return Math.min(FINISH, at + 1);
  if (at === 0 && homeward) return LOOP;
  return (at + 1) % LOOP;
}

/** A kid saves up at most this many rainbow rolls. */
export const MAX_RAINBOW_ROLLS = 3;

export interface UnicornConfig {
  /** How much the rainbow takes to fill: every roll adds its pips. */
  rainbowAt: number;
}

export type UnicornSeat = Seat & { kid: boolean; wins: number };

export interface Racer {
  seat: number;
  playerId: string;
  kid: boolean;
  /** Where they are: a stop on the loop (0 is the start), then LOOP… on the bridge, FINISH the castle. */
  at: number;
  /** Friends picked up, in order. */
  riders: Rider[];
  /** Rainbow rolls saved up: each is used right after a move. */
  rainbowRolls: number;
  /** Left mid-game: off the track. */
  left: boolean;
}

export type UnicornEvent =
  | { type: "roll"; who: string; value: number; rainbow: boolean; from: number; to: number }
  | { type: "pickup"; who: string; rider: Rider }
  | { type: "rainbow"; kids: string[] }
  | { type: "left"; who: string };

export interface UnicornState extends Seating<UnicornSeat> {
  config: UnicornConfig;
  phase: "lobby" | "playing" | "over";
  game: number;
  racers: Racer[];
  /** Seat whose turn it is. */
  turn: number | null;
  /** roll: the die is next. pick: choosing who to pick up, from `choice`. */
  stage: "roll" | "pick";
  choice: Rider[] | null;
  /** The roll about to be made (or the one just made) is a rainbow roll. */
  rainbowRoll: boolean;
  /** The rainbow's charge, from 0 up to config.rainbowAt. */
  rainbow: number;
  /** Rainbows filled this game. */
  rainbows: number;
  /** The last roll, and how many rolls this game so far (so each can be told apart). */
  lastRoll: { who: string; value: number; rainbow: boolean } | null;
  rolls: number;
  log: UnicornEvent[];
  logged: number;
  result: { winners: string[] } | null;
  /** Who went first last game. */
  opener: number | null;
}

export const LOG_KEEP = 40;

export function createState(config: UnicornConfig): UnicornState {
  return {
    config,
    ...emptySeating<UnicornSeat>(SEAT_COUNT),
    phase: "lobby",
    game: 0,
    racers: [],
    turn: null,
    stage: "roll",
    choice: null,
    rainbowRoll: false,
    rainbow: 0,
    rainbows: 0,
    lastRoll: null,
    rolls: 0,
    log: [],
    logged: 0,
    result: null,
    opener: null,
  };
}

// --- helpers ---------------------------------------------------------------

const active = (state: UnicornState) => state.racers.filter((r) => !r.left);

export function racerOf(state: UnicornState, playerId: string): Racer | undefined {
  return state.racers.find((r) => r.playerId === playerId && !r.left);
}

export function currentRacer(state: UnicornState): Racer | undefined {
  return state.phase === "playing" ? active(state).find((r) => r.seat === state.turn) : undefined;
}

function logEvent(state: UnicornState, e: UnicornEvent) {
  state.log.push(e);
  state.logged++;
  if (state.log.length > LOG_KEEP) state.log.splice(0, state.log.length - LOG_KEEP);
}

/** Who's at a stop that `racer` could pick up. */
export function wanted(racer: Racer, stop: number): Rider[] {
  return stop < LOOP ? TRACK[stop]!.riders.filter((r) => !racer.riders.includes(r)) : [];
}

export function canStart(state: UnicornState): boolean {
  return state.phase !== "playing" && seatsWhere(state).length >= 1;
}

// --- seating ---------------------------------------------------------------

export function sit(state: UnicornState, playerId: string, seat: number, kid: boolean | undefined) {
  // Sitting down mid-race is fine: you're in the next one.
  const s = sitDown(state, playerId, seat, () => ({ kid: false, wins: 0 }));
  if (kid !== undefined) s.kid = kid;
}

/** Kid or grown-up: between races only. */
export function setKid(state: UnicornState, playerId: string, kid: boolean) {
  const s = state.seats[requireSeat(state, playerId)]!;
  if (state.phase === "playing" && racerOf(state, playerId)) throw new GameError("in_progress", "Wait for the race to end.");
  if (s.kid === kid) throw new GameError("no_change", kid ? "You're already a kid." : "You're already a grown-up.");
  s.kid = kid;
}

export function leave(state: UnicornState, playerId: string, ctx: GameContext) {
  requireSeat(state, playerId);
  const r = racerOf(state, playerId);
  if (state.phase === "playing" && r) {
    r.left = true;
    logEvent(state, { type: "left", who: playerId });
    if (active(state).length === 0) {
      // Nobody left racing: back to the start, with no winner.
      state.phase = "lobby";
      state.turn = null;
      state.choice = null;
      state.stage = "roll";
    } else if (state.turn === r.seat) nextTurn(state, r.seat);
  }
  standUp(state, playerId);
  void ctx;
}

// --- the race --------------------------------------------------------------

export function start(state: UnicornState, actor: string, ctx: GameContext) {
  requireSeat(state, actor);
  if (state.phase === "playing") throw new GameError("in_progress", "A race is already on.");
  const seats = seatsWhere(state);
  if (!seats.length) throw new GameError("not_enough_players", "Someone has to sit down first.");
  state.racers = seats.map((seat) => {
    const s = state.seats[seat]!;
    return { seat, playerId: s.playerId, kid: s.kid, at: 0, riders: [], rainbowRolls: 0, left: false };
  });
  // Kids go first: the first race a kid picked at random, then the next one round.
  const firsts = state.racers.some((r) => r.kid) ? state.racers.filter((r) => r.kid) : state.racers;
  const opener = state.opener === null ? firsts[ctx.randomInt(firsts.length)]!.seat : nextClockwise(state.racers, state.opener)!.seat;
  state.opener = opener;
  state.turn = opener;
  state.phase = "playing";
  state.game++;
  state.stage = "roll";
  state.choice = null;
  state.rainbowRoll = false;
  state.rainbow = 0;
  state.rainbows = 0;
  state.lastRoll = null;
  state.rolls = 0;
  state.log = [];
  state.logged = 0;
  state.result = null;
}

function requireTurn(state: UnicornState, actor: string, stage: UnicornState["stage"]): Racer {
  const r = currentRacer(state);
  if (!r) throw new GameError("not_playing", "There's no race on.");
  if (r.playerId !== actor) throw new GameError("not_your_turn", "It's not your turn.");
  if (state.stage !== stage) throw new GameError("wrong_stage", stage === "roll" ? "Pick up a friend first." : "Roll the die first.");
  return r;
}

export function roll(state: UnicornState, actor: string, ctx: GameContext) {
  const r = requireTurn(state, actor, "roll");
  const value = ctx.randomInt(6) + 1;
  const from = r.at;
  const homeward = r.riders.length === RIDERS.length;
  // The castle needn't be hit exactly: galloping past it is getting there.
  for (let i = 0; i < value && r.at !== FINISH; i++) r.at = nextStop(r.at, homeward);
  state.lastRoll = { who: actor, value, rainbow: state.rainbowRoll };
  state.rolls++;
  logEvent(state, { type: "roll", who: actor, value, rainbow: state.rainbowRoll, from, to: r.at });
  charge(state, value, ctx);
  if (r.at === FINISH) return finish(state, r, ctx);

  // Whoever's here who you haven't got wants a ride; you pick them up yourself, even if there's only one.
  const options = wanted(r, r.at);
  if (options.length) {
    state.stage = "pick";
    state.choice = options;
    return;
  }
  endMove(state, r, ctx);
}

export function pick(state: UnicornState, actor: string, rider: Rider, ctx: GameContext) {
  const r = requireTurn(state, actor, "pick");
  if (!state.choice!.includes(rider)) throw new GameError("not_here", `There's no ${RIDER_NAMES[rider]} for you here.`);
  state.stage = "roll";
  state.choice = null;
  pickUp(state, r, rider, ctx);
  endMove(state, r, ctx);
}

/** Every roll charges the rainbow; full, it gives every kid racing a rainbow roll. */
function charge(state: UnicornState, value: number, ctx: GameContext) {
  state.rainbow += value;
  if (state.rainbow < state.config.rainbowAt) return;
  state.rainbow = 0;
  state.rainbows++;
  const kids = active(state).filter((r) => r.kid);
  for (const k of kids) k.rainbowRolls = Math.min(MAX_RAINBOW_ROLLS, k.rainbowRolls + 1);
  logEvent(state, { type: "rainbow", kids: kids.map((k) => k.playerId) });
  if (kids.length) ctx.announce(`Rainbow power! ${kids.map((k) => ctx.nameOf(k.playerId)).join(" & ")} ${kids.length === 1 ? "gets" : "get"} a rainbow roll.`);
}

function pickUp(state: UnicornState, r: Racer, rider: Rider, ctx: GameContext) {
  r.riders.push(rider);
  logEvent(state, { type: "pickup", who: r.playerId, rider });
  if (r.riders.length === RIDERS.length) ctx.announce(`${ctx.nameOf(r.playerId)} has all six friends! The rainbow bridge is open: back to the start, then over it to the castle.`);
}

/** After a move: a kid's rainbow roll, or the next racer's turn. */
function endMove(state: UnicornState, r: Racer, ctx: GameContext) {
  if (state.phase !== "playing") return;
  void ctx;
  if (r.rainbowRolls > 0) {
    r.rainbowRolls--;
    state.rainbowRoll = true;
    state.stage = "roll";
    return;
  }
  nextTurn(state, r.seat);
}

function nextTurn(state: UnicornState, from: number) {
  state.turn = nextClockwise(active(state), from)!.seat;
  state.stage = "roll";
  state.choice = null;
  state.rainbowRoll = false;
}

function finish(state: UnicornState, winner: Racer, ctx: GameContext) {
  state.phase = "over";
  state.turn = null;
  state.stage = "roll";
  state.choice = null;
  state.rainbowRoll = false;
  state.result = { winners: [winner.playerId] };
  const seat = state.seats[seatOf(state, winner.playerId)];
  if (seat) seat.wins++;
  ctx.announce(`${ctx.nameOf(winner.playerId)} reaches the castle with all six friends and wins the race!`);
}

/** What `playerId` can do in the race right now. */
export function raceOptions(state: UnicornState, playerId: string): { roll: boolean; pick: Rider[] } {
  const r = currentRacer(state);
  if (!r || r.playerId !== playerId) return { roll: false, pick: [] };
  return state.stage === "roll" ? { roll: true, pick: [] } : { roll: false, pick: [...state.choice!] };
}

// --- views -----------------------------------------------------------------

export interface UnicornView {
  config: UnicornConfig;
  track: Stop[];
  /** Stops on the bridge, the castle last: positions LOOP to LOOP + bridge - 1. */
  bridge: number;
  seats: (UnicornSeat | null)[];
  phase: UnicornState["phase"];
  game: number;
  racers: Racer[];
  turn: number | null;
  stage: UnicornState["stage"];
  choice: Rider[] | null;
  rainbowRoll: boolean;
  rainbow: number;
  rainbows: number;
  lastRoll: UnicornState["lastRoll"];
  rolls: number;
  log: UnicornEvent[];
  logged: number;
  result: UnicornState["result"];
  canStart: boolean;
  you: { seat: number | null; racing: boolean; roll: boolean; pick: Rider[] };
}

/** Nothing here is secret, but it's built field by field anyway, so nothing new leaks by accident. */
export function viewFor(state: UnicornState, viewer: string): UnicornView {
  const seat = seatOf(state, viewer);
  return {
    config: { rainbowAt: state.config.rainbowAt },
    track: TRACK.map((s) => ({ kind: s.kind, riders: [...s.riders] })),
    bridge: BRIDGE,
    seats: state.seats.map((s) => (s ? { playerId: s.playerId, sittingOut: s.sittingOut, kid: s.kid, wins: s.wins } : null)),
    phase: state.phase,
    game: state.game,
    racers: state.racers.map((r) => ({ seat: r.seat, playerId: r.playerId, kid: r.kid, at: r.at, riders: [...r.riders], rainbowRolls: r.rainbowRolls, left: r.left })),
    turn: state.turn,
    stage: state.stage,
    choice: state.choice ? [...state.choice] : null,
    rainbowRoll: state.rainbowRoll,
    rainbow: state.rainbow,
    rainbows: state.rainbows,
    lastRoll: state.lastRoll ? { ...state.lastRoll } : null,
    rolls: state.rolls,
    log: state.log.map((e) => (e.type === "rainbow" ? { type: "rainbow", kids: [...e.kids] } : { ...e })),
    logged: state.logged,
    result: state.result ? { winners: [...state.result.winners] } : null,
    canStart: canStart(state),
    you: { seat: seat < 0 ? null : seat, racing: !!racerOf(state, viewer), ...raceOptions(state, viewer) },
  };
}
