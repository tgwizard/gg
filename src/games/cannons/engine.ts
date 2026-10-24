/**
 * Cannons for 2–4, as a state machine around ./physics: each player is a cannon on a
 * side-view landscape, and they take turns firing at each other. The game ends when one
 * cannon is left standing.
 *
 * A turn: the wind changes (it's shown before you aim), you send an angle and a power
 * (whole numbers), and the server works out the whole flight at once. The crater and any
 * hit happen in the state straight away, but the game waits ("flying") for as long as
 * the ball takes to fly and burst on screen, and only then says what happened in the
 * chat and moves on, so nobody hears about a hit before they've seen it.
 *
 * The first game starts when every seat is taken; "Play again" starts the next on a new
 * field, with the next seat opening. Leaving before anyone has fired calls the game off;
 * after that, your cannon is out. When a turn clock (if set) runs out, the turn goes by
 * without a shot (a shot fired for you might win you the game); three in a row and you're out.
 *
 * Nothing is hidden, but the view is still built field by field.
 */
import { emptySeating, requireSeat, type Seat, type Seating, seatOf, sitDown, standUp } from "../kit/seating";
import { nextTimer, setTimer, takeDueTimer, type Timers } from "../kit/timers";
import { type GameContext, GameError } from "../types";
import { COLUMNS, crater, elevation, type Flight, flight, groundAt, MAX_GROUND, MAX_POWER, MIN_POWER, SEA_LEVEL, STEP, TICK_MS, WIDTH, whole } from "./physics";
import { makeField, type TerrainStyle } from "./terrain";

export const WIND_LEVELS = ["none", "light", "strong"] as const;
export type WindLevel = (typeof WIND_LEVELS)[number];
/** The strongest wind at each level, either way. */
export const WIND_MAX: Record<WindLevel, number> = { none: 0, light: 5, strong: 10 };
/** Turn clocks that run out in a row before you're out. */
export const MAX_TIMEOUTS = 3;
/** After a ball lands: time for the burst and a breath before the next turn. */
export const SETTLE_MS = 1400;
/** Shots kept in the history (only each player's latest keeps its path). */
const MAX_SHOTS = 40;

export interface CannonsConfig {
  /** Seats; the game starts when they're all taken. */
  players: number;
  terrain: TerrainStyle;
  wind: WindLevel;
  /** Seconds to aim; 0 = no clock. */
  turnSeconds: number;
}

export type CannonsSeat = Seat & { wins: number };

export interface Cannon {
  playerId: string;
  seat: number;
  x: number;
  alive: boolean;
  /** Why it's out: hit (by `by`), its player left, or ran out of time too often. */
  out: "hit" | "left" | "timeouts" | null;
  by: string | null;
  /** Turn clocks that ran out on it in a row. */
  timeouts: number;
}

/** Where a shot ended relative to the cannon nearest to it (not the shooter's). */
export interface Near {
  playerId: string;
  /** Meters along the line from the shooter to them: negative is short, positive past them. */
  dx: number;
  /** Meters above (positive) or below the ground under them. */
  dy: number;
  /** Which way they are from the shooter: 1 right, -1 left. */
  side: 1 | -1;
}

export interface Shot {
  /** 1 for the game's first shot. */
  n: number;
  by: string;
  angle: number;
  power: number;
  wind: number;
  end: Flight["end"];
  x: number;
  y: number;
  /** Whose cannon it hit (maybe the shooter's own). */
  hit: string | null;
  near: Near | null;
  ticks: number;
  /** The flight (x, y pairs); kept only on each player's latest shot, for its trace. */
  path: number[] | null;
}

export interface CannonsResult {
  /** The last cannon standing; null if nobody is. */
  winner: string | null;
  /** How the last of the others went out. */
  reason: "hit" | "left" | "timeouts";
  shots: number;
}

export interface CannonsState extends Seating<CannonsSeat> {
  config: CannonsConfig;
  /** waiting: for players. aiming: someone's turn. flying: a shot is in the air (on screen). over: one cannon left. */
  phase: "waiting" | "aiming" | "flying" | "over";
  game: number;
  /** The seat that fires first in the next game. */
  opener: number;
  terrain: number[];
  cannons: Cannon[];
  /** Whose turn, as an index into `cannons` (while flying: who fired). */
  turn: number;
  /** Now: positive blows right. */
  wind: number;
  shots: Shot[];
  /** Shots fired this game. */
  fired: number;
  /** Whose clock just ran out (their turn went by without a shot), until the next shot. */
  passed: string | null;
  result: CannonsResult | null;
  timers: Timers<"turn" | "land">;
}

export function createState(config: CannonsConfig): CannonsState {
  return {
    config,
    ...emptySeating<CannonsSeat>(config.players),
    phase: "waiting",
    game: 0,
    opener: 0,
    terrain: Array.from({ length: COLUMNS }, () => 100),
    cannons: [],
    turn: 0,
    wind: 0,
    shots: [],
    fired: 0,
    passed: null,
    result: null,
    timers: {},
  };
}

const allSeated = (state: CannonsState) => state.seats.every(Boolean);
export const canRematch = (state: CannonsState) => state.phase === "over" && allSeated(state);
const alive = (state: CannonsState) => state.cannons.filter((c) => c.alive);
const cannonOf = (state: CannonsState, playerId: string) => state.cannons.find((c) => c.playerId === playerId);

// --- seating -------------------------------------------------------------------

export function sit(state: CannonsState, playerId: string, seat: number, ctx: GameContext) {
  sitDown(state, playerId, seat, () => ({ wins: 0 }));
  if (state.phase === "waiting" && allSeated(state)) startGame(state, ctx);
}

export function leave(state: CannonsState, playerId: string, ctx: GameContext) {
  requireSeat(state, playerId);
  if (state.phase === "flying") land(state, ctx);
  const cannon = cannonOf(state, playerId);
  if ((state.phase === "aiming" || state.phase === "flying") && cannon?.alive) {
    if (state.fired === 0) {
      // Nothing's happened yet: call it off, and the next game is this one again.
      state.phase = "waiting";
      state.game--;
      state.opener = (state.opener + state.seats.length - 1) % state.seats.length;
      state.cannons = [];
      state.shots = [];
      setTimer(state.timers, "turn", null);
      ctx.announce(`The Cannons game was called off: ${ctx.nameOf(playerId)} left before anyone fired.`);
    } else {
      knockOut(cannon, "left", null);
      ctx.announce(`${ctx.nameOf(playerId)} left: their cannon is out.`);
      if (!settle(state, "left", ctx) && state.cannons[state.turn] === cannon) nextTurn(state, ctx);
    }
  }
  standUp(state, playerId);
}

export function rematch(state: CannonsState, actor: string, ctx: GameContext) {
  requireSeat(state, actor);
  if (state.phase !== "over") throw new GameError("in_progress", "A game is already on.");
  if (!allSeated(state)) throw new GameError("not_enough_players", "Every seat needs a player.");
  startGame(state, ctx);
}

function startGame(state: CannonsState, ctx: GameContext) {
  state.game++;
  const seats = state.seats.map((s, i) => ({ playerId: s!.playerId, seat: i }));
  // Who stands where is shuffled; the field is new every game.
  for (let i = seats.length - 1; i > 0; i--) {
    const j = ctx.randomInt(i + 1);
    [seats[i], seats[j]] = [seats[j]!, seats[i]!];
  }
  const field = makeField(state.config.terrain, ctx.randomInt(2 ** 31), seats.length);
  state.terrain = field.terrain;
  state.cannons = seats.map((s, i) => ({ playerId: s.playerId, seat: s.seat, x: field.xs[i]!, alive: true, out: null, by: null, timeouts: 0 }));
  state.turn = state.cannons.findIndex((c) => c.seat === state.opener);
  state.opener = (state.opener + 1) % state.seats.length;
  state.shots = [];
  state.fired = 0;
  state.passed = null;
  state.result = null;
  const max = WIND_MAX[state.config.wind];
  state.wind = max ? ctx.randomInt(2 * max + 1) - max : 0;
  state.phase = "aiming";
  startTurn(state, ctx);
}

// --- shooting --------------------------------------------------------------------

function startTurn(state: CannonsState, ctx: GameContext) {
  const secs = state.config.turnSeconds;
  setTimer(state.timers, "turn", secs > 0 ? ctx.now + secs * 1000 : null);
}

/** The wind for the next shot: it drifts, sometimes a lot, sometimes swinging round. */
function shiftWind(state: CannonsState, ctx: GameContext) {
  const max = WIND_MAX[state.config.wind];
  if (!max) return;
  const step = Math.max(1, Math.round(max * 0.5));
  state.wind = Math.max(-max, Math.min(max, state.wind + ctx.randomInt(2 * step + 1) - step));
}

export function fire(state: CannonsState, actor: string, angle: number, power: number, ctx: GameContext) {
  requireSeat(state, actor);
  if (state.phase === "flying") throw new GameError("flying", "Wait for the ball to land.");
  if (state.phase !== "aiming") throw new GameError("not_playing", "There's no game on.");
  const cannon = state.cannons[state.turn]!;
  if (cannon.playerId !== actor) throw new GameError("not_your_turn", "It's not your turn.");
  if (!Number.isInteger(angle) || angle < 0 || angle > 180) throw new GameError("bad_angle", "The angle is a whole number from 0 to 180.");
  if (!Number.isInteger(power) || power < MIN_POWER || power > MAX_POWER) throw new GameError("bad_power", `The power is a whole number from ${MIN_POWER} to ${MAX_POWER}.`);
  cannon.timeouts = 0;
  state.passed = null;

  const f = flight({ terrain: state.terrain, cannons: state.cannons, shooter: state.turn, angle, power, wind: state.wind });
  const hit = f.hit === null ? null : state.cannons[f.hit]!;
  const shot: Shot = {
    n: ++state.fired,
    by: actor,
    angle,
    power,
    wind: state.wind,
    end: f.end,
    x: f.x,
    y: f.y,
    hit: hit?.playerId ?? null,
    near: nearest(state, cannon, f),
    ticks: f.ticks,
    path: f.path,
  };
  if (f.end !== "off") state.terrain = crater(state.terrain, f.x, f.y);
  if (hit) knockOut(hit, "hit", actor);
  // Only the latest shot of each player keeps its path (for the trace).
  for (const s of state.shots) if (s.by === actor) s.path = null;
  state.shots.push(shot);
  if (state.shots.length > MAX_SHOTS) state.shots.splice(0, state.shots.length - MAX_SHOTS);

  state.phase = "flying";
  setTimer(state.timers, "turn", null);
  setTimer(state.timers, "land", ctx.now + f.ticks * TICK_MS + SETTLE_MS);
}

/** The cannon (other than the shooter's) nearest to where a flight ended, and where it ended relative to it. */
function nearest(state: CannonsState, shooter: Cannon, f: Flight): Near | null {
  const others = state.cannons.filter((c) => c.alive && c !== shooter);
  if (!others.length) return null;
  const target = others.reduce((a, b) => (Math.abs(b.x - f.x) < Math.abs(a.x - f.x) ? b : a));
  const side = target.x >= shooter.x ? 1 : -1;
  return { playerId: target.playerId, dx: whole((f.x - target.x) * side), dy: whole(f.y - groundAt(state.terrain, target.x)), side };
}

function knockOut(cannon: Cannon, why: NonNullable<Cannon["out"]>, by: string | null) {
  cannon.alive = false;
  cannon.out = why;
  cannon.by = by;
}

/** The ball has landed (on screen): say what happened, then the next turn or the end. */
function land(state: CannonsState, ctx: GameContext) {
  setTimer(state.timers, "land", null);
  state.phase = "aiming";
  const shot = state.shots.at(-1);
  if (shot?.hit) {
    const by = ctx.nameOf(shot.by);
    ctx.announce(shot.hit === shot.by ? `${by} hit their own cannon!` : `${by} hit ${ctx.nameOf(shot.hit)}'s cannon!`);
  }
  if (!settle(state, "hit", ctx)) nextTurn(state, ctx);
}

/** If one cannon (or none) is left, the game is over: the last one went out `how`. */
function settle(state: CannonsState, how: CannonsResult["reason"], ctx: GameContext): boolean {
  const standing = alive(state);
  if (standing.length > 1) return false;
  finish(state, { winner: standing[0]?.playerId ?? null, reason: how, shots: state.fired }, ctx);
  return true;
}

function nextTurn(state: CannonsState, ctx: GameContext) {
  const n = state.cannons.length;
  for (let k = 1; k <= n; k++) {
    const i = (state.turn + k) % n;
    if (state.cannons[i]!.alive) {
      state.turn = i;
      break;
    }
  }
  shiftWind(state, ctx);
  startTurn(state, ctx);
}

function finish(state: CannonsState, result: CannonsResult, ctx: GameContext) {
  state.phase = "over";
  state.result = result;
  setTimer(state.timers, "turn", null);
  setTimer(state.timers, "land", null);
  const seat = state.seats.find((s) => s?.playerId === result.winner);
  if (seat) seat.wins++;
  const who = result.winner ? ctx.nameOf(result.winner) : null;
  ctx.announce(`Cannons game ${state.game}: ${who ? `${who} wins, the last cannon standing` : "nobody's left standing"} after ${result.shots} ${result.shots === 1 ? "shot" : "shots"}.`);
}

// --- timers --------------------------------------------------------------------

export function nextDeadline(state: CannonsState): number | null {
  return nextTimer(state.timers);
}

export function onDeadline(state: CannonsState, ctx: GameContext) {
  const due = takeDueTimer(state.timers, ctx.now);
  if (due === "land" && state.phase === "flying") return land(state, ctx);
  if (due !== "turn" || state.phase !== "aiming") return;
  const cannon = state.cannons[state.turn]!;
  cannon.timeouts++;
  if (cannon.timeouts >= MAX_TIMEOUTS) {
    knockOut(cannon, "timeouts", null);
    ctx.announce(`${ctx.nameOf(cannon.playerId)} ran out of time ${MAX_TIMEOUTS} times in a row: their cannon is out.`);
    if (!settle(state, "timeouts", ctx)) nextTurn(state, ctx);
    return;
  }
  // Out of time: the turn goes by without a shot (firing for them could win them the game).
  state.passed = cannon.playerId;
  ctx.announce(`${ctx.nameOf(cannon.playerId)} ran out of time: no shot this turn (${cannon.timeouts} of ${MAX_TIMEOUTS}).`);
  nextTurn(state, ctx);
}

const lastAim = (state: CannonsState, playerId: string) => state.shots.findLast((s) => s.by === playerId) ?? null;

/** A first aim: 45° up towards the nearest cannon, at middling power. */
export function defaultAim(cannons: { x: number; alive: boolean }[], me: number): { angle: number; power: number } {
  const x = cannons[me]?.x ?? 0;
  const others = cannons.filter((c, i) => i !== me && c.alive);
  const target = others.length ? others.reduce((a, b) => (Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a)) : null;
  return { angle: !target || target.x >= x ? 45 : 135, power: 60 };
}

// --- who and what --------------------------------------------------------------

export function waitingOn(state: CannonsState): string[] {
  return state.phase === "aiming" ? [state.cannons[state.turn]!.playerId] : [];
}

export function checkInvariants(state: CannonsState) {
  if (state.terrain.length !== COLUMNS || state.terrain.some((h) => !Number.isInteger(h) || h < 0 || h > MAX_GROUND)) throw new Error("bad terrain");
  if (state.seats.length !== state.config.players) throw new Error("seats don't match the config");
  const max = WIND_MAX[state.config.wind];
  if (!Number.isInteger(state.wind) || Math.abs(state.wind) > max) throw new Error(`wind ${state.wind} out of range`);
  if (state.shots.length > MAX_SHOTS) throw new Error("too many shots kept");
  const traced = state.shots.filter((s) => s.path).map((s) => s.by);
  if (new Set(traced).size !== traced.length) throw new Error("a player with more than one trace");
  if (state.phase === "waiting") return;
  if (state.cannons.length !== state.seats.length) throw new Error("a cannon per seat");
  for (const c of state.cannons) {
    if (c.x < 0 || c.x > WIDTH) throw new Error("a cannon off the field");
    if (c.alive && state.phase !== "over" && state.seats[c.seat]?.playerId !== c.playerId) throw new Error(`${c.playerId}'s cannon stands without them`);
    if (c.alive !== (c.out === null)) throw new Error("alive and out disagree");
  }
  const standing = alive(state).length;
  if (state.phase === "aiming") {
    if (standing < 2) throw new Error("aiming with fewer than two cannons");
    if (!state.cannons[state.turn]?.alive) throw new Error("the turn is a wreck's");
    if (state.result) throw new Error("a result while playing");
    if (state.timers.land !== undefined) throw new Error("a landing while aiming");
  }
  if (state.phase === "flying" && state.timers.land === undefined) throw new Error("flying without a landing");
  if (state.phase === "over" && (!state.result || standing > 1)) throw new Error("over without a result");
}

// --- views ---------------------------------------------------------------------

export interface CannonView {
  playerId: string;
  seat: number;
  x: number;
  /** The ground under it now. */
  y: number;
  alive: boolean;
  out: Cannon["out"];
  by: string | null;
  timeouts: number;
  /** Where its barrel points: the angle of its last shot, or a first aim. */
  angle: number;
}

export type ShotView = Shot;

export interface CannonsView {
  config: CannonsConfig;
  seats: (CannonsSeat | null)[];
  phase: CannonsState["phase"];
  game: number;
  /** Ground heights (meters) every `step` meters from x = 0 to `width`. */
  terrain: number[];
  world: { width: number; step: number };
  cannons: CannonView[];
  /** Whose turn it is (while flying: who fired). */
  turn: string | null;
  turnDeadline: number | null;
  /** When the ball in the air will have landed (server time), while flying. */
  landsAt: number | null;
  /** Positive blows right; `windMax` is the strongest it gets in this game. */
  wind: number;
  windMax: number;
  /** This game's shots, oldest first; each player's latest has its `path`. */
  shots: ShotView[];
  /** Whose clock just ran out, so their turn went by without a shot. */
  passed: string | null;
  result: CannonsResult | null;
  canRematch: boolean;
  you: { seat: number | null };
  /** The situation in words, from your cannon (for bots). */
  situation: string[];
}

export function viewFor(state: CannonsState, viewer: string): CannonsView {
  const seat = seatOf(state, viewer);
  const cannons: CannonView[] = state.cannons.map((c, i) => ({
    playerId: c.playerId,
    seat: c.seat,
    x: c.x,
    y: whole(groundAt(state.terrain, c.x)),
    alive: c.alive,
    out: c.out,
    by: c.by,
    timeouts: c.timeouts,
    angle: lastAim(state, c.playerId)?.angle ?? defaultAim(state.cannons, i).angle,
  }));
  const playing = state.phase === "aiming" || state.phase === "flying";
  const view: CannonsView = {
    config: { players: state.config.players, terrain: state.config.terrain, wind: state.config.wind, turnSeconds: state.config.turnSeconds },
    seats: state.seats.map((s) => (s ? { playerId: s.playerId, sittingOut: s.sittingOut, wins: s.wins } : null)),
    phase: state.phase,
    game: state.game,
    terrain: [...state.terrain],
    world: { width: WIDTH, step: STEP },
    cannons,
    turn: playing ? state.cannons[state.turn]!.playerId : null,
    turnDeadline: state.phase === "aiming" ? (state.timers.turn ?? null) : null,
    landsAt: state.phase === "flying" ? (state.timers.land ?? null) : null,
    wind: state.wind,
    windMax: WIND_MAX[state.config.wind],
    shots: state.shots.map((s) => ({
      n: s.n,
      by: s.by,
      angle: s.angle,
      power: s.power,
      wind: s.wind,
      end: s.end,
      x: s.x,
      y: s.y,
      hit: s.hit,
      near: s.near ? { playerId: s.near.playerId, dx: s.near.dx, dy: s.near.dy, side: s.near.side } : null,
      ticks: s.ticks,
      path: s.path ? [...s.path] : null,
    })),
    passed: state.passed ?? null,
    result: state.result ? { winner: state.result.winner, reason: state.result.reason, shots: state.result.shots } : null,
    canRematch: canRematch(state),
    you: { seat: seat < 0 ? null : seat },
    situation: [],
  };
  view.situation = situation(view, viewer);
  return view;
}

// --- in words --------------------------------------------------------------------

const m = (n: number) => `${Math.abs(Math.round(n))} m`;
const windWords = (w: number) => (w === 0 ? "no wind" : `wind ${Math.abs(w)} blowing ${w > 0 ? "right" : "left"}`);

/** An angle as people say it: "50° up, to the right". */
export function aimWords(angle: number): string {
  const e = elevation(angle);
  return e.way === "up" ? "straight up" : `${e.up}° up, to the ${e.way}`;
}

/**
 * Where a shot ended, as the shooter would hear it: "landed 40 m short of Bob (to his
 * left)", "went off the right edge". `name` names a player (and `you` is the listener).
 */
export function shotWords(shot: ShotView, name: (playerId: string) => string, heights = false): string {
  if (shot.hit) return shot.hit === shot.by ? "hit its own cannon" : `hit ${name(shot.hit)}`;
  if (shot.end === "off") {
    const edge = shot.x < 0 ? "left" : shot.x > WIDTH ? "right" : null;
    if (!edge) return "flew off for good";
    return shot.y < SEA_LEVEL + 2 ? `went off the ${edge} edge, into the sea` : `went off the ${edge} edge`;
  }
  const n = shot.near;
  if (!n) return `landed at x = ${shot.x} m`;
  const who = name(n.playerId);
  const where = n.dx * n.side < 0 ? "left" : "right";
  let words = Math.abs(n.dx) <= 3 ? `landed right next to ${who}` : `landed ${m(n.dx)} ${n.dx < 0 ? "short of" : "past"} ${who} (to the ${where})`;
  if (heights && Math.abs(n.dy) >= 30) words += `, on ground ${m(n.dy)} ${n.dy > 0 ? "higher" : "lower"} than theirs`;
  return words;
}

/** The situation from `viewer`'s cannon, for bots: where everyone is, the ground between, the wind, and how the last shots went. */
function situation(view: CannonsView, viewer: string): string[] {
  if (view.phase === "waiting") return [];
  const meIndex = view.cannons.findIndex((c) => c.playerId === viewer);
  const me = view.cannons[meIndex];
  const name = (id: string) => (id === viewer ? "you" : `player ${id}`);
  const lines: string[] = [];
  lines.push(`The field runs from x = 0 m (the left edge) to x = ${WIDTH} m (the right edge), with cliffs down to the sea at both; heights are meters above the bottom.`);
  if (!me || !me.alive) {
    for (const c of view.cannons) lines.push(`${name(c.playerId)}: x = ${c.x} m, ground ${c.y} m high${c.alive ? "" : " (out)"}.`);
  } else {
    lines.push(`Your cannon is at x = ${me.x} m, on ground ${me.y} m high.`);
    for (const c of view.cannons) {
      if (c === me || !c.alive) continue;
      const dx = c.x - me.x;
      const dy = c.y - me.y;
      const side = dx >= 0 ? "right" : "left";
      lines.push(
        `The cannon of player ${c.playerId} is ${m(dx)} to your ${side} (x = ${c.x} m), ${Math.abs(dy) < 5 ? "at about your height" : `${m(dy)} ${dy > 0 ? "higher" : "lower"} than you`}. To shoot at it, use an angle ${side === "right" ? "below 90" : "above 90"}.`,
      );
      const between = highest(view.terrain, Math.min(c.x, me.x) + 15, Math.max(c.x, me.x) - 15);
      if (between && between.h > Math.max(me.y, c.y) + 15) lines.push(`Between you, the ground rises to ${between.h} m at x = ${between.x} m (${m(between.h - me.y)} above you): aim high enough to clear it.`);
    }
  }
  if (view.phase === "aiming" || view.phase === "flying") {
    lines.push(
      view.windMax === 0
        ? "There's no wind in this game."
        : `Wind now: ${view.wind === 0 ? "none" : `${Math.abs(view.wind)}, blowing ${view.wind > 0 ? "right" : "left"}`} (on a scale of ${view.windMax} either way). It pushes the ball sideways, more the longer it flies; it changes a little every turn.`,
    );
  }
  const shots = view.shots.slice(-8);
  if (shots.length) {
    lines.push("Recent shots (oldest first):");
    for (const s of shots) lines.push(`- #${s.n} by ${name(s.by)}: angle ${s.angle} (${aimWords(s.angle)}), power ${s.power}, ${windWords(s.wind)}: ${shotWords(s, name, true)}.`);
  }
  return lines;
}

function highest(terrain: number[], from: number, to: number): { x: number; h: number } | null {
  let best: { x: number; h: number } | null = null;
  for (let i = Math.max(0, Math.ceil(from / STEP)); i <= Math.min(COLUMNS - 1, Math.floor(to / STEP)); i++) {
    if (!best || terrain[i]! > best.h) best = { x: i * STEP, h: terrain[i]! };
  }
  return best;
}
