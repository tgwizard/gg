import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { play } from "../../../ui";
import { reducedMotion } from "../../kit/ui/Flights";
import { GameOver } from "../../kit/ui/GameOver";
import { ActionTray, GameLog, Herald, TableFooter } from "../../kit/ui/GameParts";
import { PlayerPlate } from "../../kit/ui/PlayerPlate";
import { TurnTimer } from "../../kit/ui/TurnTimer";
import type { GameUIProps } from "../../ui";
import { type CannonsView, type CannonView, defaultAim, MAX_TIMEOUTS, type ShotView, shotWords } from "../engine";
import type { CannonsOp } from "../index";
import { elevation, MAX_POWER, MIN_POWER } from "../physics";
import { type Aim, type Replay, Scene } from "./Scene";
import "./cannons.css";

type Props = GameUIProps<CannonsView, CannonsOp>;

export function CannonsGame({ view, me, members, connected, sendOp, serverNow }: Props) {
  const name = (id: string) => members.get(id)?.name ?? "Player";
  const [busy, setBusy] = useState(false);
  const send = async (op: CannonsOp) => {
    setBusy(true);
    const ok = await sendOp(op);
    setBusy(false);
    return ok;
  };

  const mySeat = view.you.seat;
  const myIndex = view.cannons.findIndex((c) => c.playerId === me);
  const mine = myIndex >= 0 ? view.cannons[myIndex]! : null;
  const { replay, landed, onImpact, onDone } = useReplay(view, connected);
  const myTurn = view.phase === "aiming" && view.turn === me && !replay;
  const aim = useAim(view, me, myIndex);
  const fire = () => {
    if (!myTurn || busy || !connected) return;
    void send({ type: "fire", angle: aim.value.angle, power: aim.value.power });
  };
  useAimKeys(myTurn && connected && !busy, aim.nudge, fire);

  const open = view.seats.flatMap((s, i) => (s ? [] : [i]));
  const prompt: "pick" | "wait" | null = view.phase !== "waiting" ? null : mySeat === null ? "pick" : "wait";
  const over = view.phase === "over" && !replay;
  const shooter = view.turn;

  return (
    <div className="cannons" data-testid="cannons">
      <News view={view} me={me} name={name} replay={replay} landed={landed} myTurn={myTurn} />
      <Plates view={view} me={me} name={name} members={members} serverNow={serverNow} replaying={!!replay} />

      <Scene view={view} me={me} name={name} aim={myTurn && mine ? aim.value : null} onAim={myTurn ? aim.set : undefined} replay={replay} onImpact={onImpact} onDone={onDone}>
        {prompt && (
          <div className="cn-prompt-backdrop">
            {prompt === "pick" ? (
              <div className="cn-prompt box" role="dialog" aria-label="Take a seat">
                <h3 className="display">{open.length === view.seats.length ? "Play Cannons" : "Join the battle"}</h3>
                <p className="muted">
                  {view.seats.length === 2 ? "Two cannons, one hilly field." : `${view.seats.length} cannons, last one standing wins.`}{" "}
                  {open.length > 1 ? "Take a seat; the game starts when every seat is taken." : "The game starts as soon as you sit down."}
                </p>
                <button className="btn primary big" disabled={!connected || busy || !open.length} onClick={() => send({ type: "sit", seat: open[0]! })} data-testid="cannons-sit">
                  Take a seat
                </button>
              </div>
            ) : (
              <div className="cn-prompt box" role="status">
                <h3 className="display">Waiting for {open.length === 1 ? "an opponent" : `${open.length} more players`}</h3>
                <p className="muted">Share the room link (the people icon by the room name, at the top), or add a bot, to fill the {open.length === 1 ? "other seat" : "seats"}.</p>
              </div>
            )}
          </div>
        )}
      </Scene>

      {/* Once it's over, the result has Play again; the tray stays only for whoever's watching. */}
      {view.phase !== "waiting" && !(over && mySeat !== null) && (
        <ActionTray testId="cannons-tray" aside={!replay && <TrayAside view={view} busy={busy} connected={connected} send={send} />}>
          {myTurn ? (
            <Controls aim={aim.value} set={aim.set} nudge={aim.nudge} fire={fire} disabled={busy || !connected} last={view.shots.findLast((s) => s.by === me) ?? null} name={name} me={me} />
          ) : (
            <span className="cn-tray-text" data-testid="cannons-status">
              {trayText(view, me, name, !!replay, shooter)}
            </span>
          )}
        </ActionTray>
      )}

      <CannonsResult view={view} open={over} me={me} name={name} seated={mySeat !== null} rematch={view.canRematch && mySeat !== null ? () => send({ type: "rematch" }) : null} disabled={busy || !connected} />

      <TableFooter
        log={
          view.shots.length > 0 && (
            <GameLog title="Shots fired">
              {view.shots
                .filter((s) => !replay || s.n < replay.shot.n || landed)
                .map((s) => (
                  <li key={s.n}>{logLine(s, me, name)}</li>
                ))}
            </GameLog>
          )
        }
        actions={
          mySeat !== null && (
            <button className="btn ghost small" disabled={!connected || busy} onClick={() => send({ type: "leave" })}>
              {view.phase === "aiming" || view.phase === "flying" ? (view.shots.length ? (mine?.alive ? "Give up & leave" : "Leave seat") : "Leave (calls the game off)") : "Leave seat"}
            </button>
          )
        }
      />
    </div>
  );
}

// --- the shot on screen ---------------------------------------------------------

/**
 * The shot to show flying: only one that arrives live (one more than the last view
 * had, in the same game), never after a refresh, which shows the field as it is now.
 */
function useReplay(view: CannonsView, connected: boolean) {
  const [replay, setReplay] = useState<Replay | null>(null);
  const [landed, setLanded] = useState(false);
  const seen = useRef<{ view: CannonsView; connected: boolean } | null>(null);
  useLayoutEffect(() => {
    const before = seen.current;
    seen.current = { view, connected };
    if (!before || before.view.game !== view.game) {
      setReplay(null);
      return;
    }
    const shot = view.shots.at(-1);
    const was = before.view.shots.at(-1)?.n ?? 0;
    if (!shot?.path || shot.n !== was + 1 || !before.connected || !connected) return;
    if (reducedMotion()) {
      // Nothing flies, but you still hear it land.
      if (shot.end !== "off") play(shot.hit ? "hit" : "boom");
      return;
    }
    setLanded(false);
    setReplay({ shot, terrain: before.view.terrain, cannons: before.view.cannons });
  }, [view, connected]);
  return {
    replay,
    landed,
    onImpact: () => setLanded(true),
    onDone: () => setReplay(null),
  };
}

// --- aiming ---------------------------------------------------------------------

/** Your aim: what you fired last (or a first guess), changed by dragging, the controls and the keys. */
function useAim(view: CannonsView, me: string, myIndex: number) {
  const fresh = (): Aim => {
    const last = view.shots.findLast((s) => s.by === me);
    return last ? { angle: last.angle, power: last.power } : defaultAim(view.cannons, myIndex);
  };
  const [aim, setAim] = useState<Aim>(fresh);
  const game = useRef(view.game);
  useEffect(() => {
    if (game.current === view.game) return;
    game.current = view.game;
    setAim(fresh());
  }, [view.game]);
  const clamp = (a: Aim): Aim => ({ angle: Math.max(0, Math.min(180, Math.round(a.angle))), power: Math.max(MIN_POWER, Math.min(MAX_POWER, Math.round(a.power))) });
  return {
    value: aim,
    set: (a: Aim) => setAim(clamp(a)),
    nudge: (angle: number, power: number) => setAim((a) => clamp({ angle: a.angle + angle, power: a.power + power })),
  };
}

/** ← → turn the barrel, ↑ ↓ change the power (with Shift, by 5), Space fires. */
function useAimKeys(on: boolean, nudge: (angle: number, power: number) => void, fire: () => void) {
  const latest = useRef({ nudge, fire });
  latest.current = { nudge, fire };
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || t?.closest("input, textarea, select, button, a, [contenteditable]")) return;
      const step = e.shiftKey ? 5 : 1;
      const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
      if (moves[e.key]) {
        e.preventDefault();
        latest.current.nudge(...moves[e.key]!);
      } else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        latest.current.fire();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [on]);
}

const arrow = (angle: number) => (angle === 90 ? "↑" : angle < 90 ? "↗" : "↖");

function Controls(props: {
  aim: Aim;
  set(a: Aim): void;
  nudge(angle: number, power: number): void;
  fire(): void;
  disabled: boolean;
  last: ShotView | null;
  me: string;
  name(id: string): string;
}) {
  const { aim, set, nudge, disabled } = props;
  const up = elevation(aim.angle).up;
  return (
    <div className="cn-controls" data-testid="cannons-controls">
      <div className="cn-dial">
        <div className="cn-dial-head">
          <span className="label">Angle</span>
          <output className="cn-value" data-testid="cannons-angle" aria-label={`Angle ${aim.angle}`}>
            {up}° {arrow(aim.angle)}
          </output>
        </div>
        <div className="cn-dial-row">
          <button type="button" className="btn subtle small cn-step" disabled={disabled} onClick={() => nudge(1, 0)} aria-label="Turn left">
            ◀
          </button>
          <input
            type="range"
            className="cn-range"
            min={0}
            max={180}
            value={180 - aim.angle}
            disabled={disabled}
            aria-label="Angle (left to right)"
            onChange={(e) => set({ ...aim, angle: 180 - Number(e.target.value) })}
          />
          <button type="button" className="btn subtle small cn-step" disabled={disabled} onClick={() => nudge(-1, 0)} aria-label="Turn right">
            ▶
          </button>
        </div>
      </div>
      <div className="cn-dial">
        <div className="cn-dial-head">
          <span className="label">Power</span>
          <output className="cn-value" data-testid="cannons-power">
            {aim.power}
          </output>
        </div>
        <div className="cn-dial-row">
          <button type="button" className="btn subtle small cn-step" disabled={disabled} onClick={() => nudge(0, -1)} aria-label="Less power">
            −
          </button>
          <input type="range" className="cn-range" min={MIN_POWER} max={MAX_POWER} value={aim.power} disabled={disabled} aria-label="Power" onChange={(e) => set({ ...aim, power: Number(e.target.value) })} />
          <button type="button" className="btn subtle small cn-step" disabled={disabled} onClick={() => nudge(0, 1)} aria-label="More power">
            +
          </button>
        </div>
      </div>
      <button type="button" className="btn primary big cn-fire" disabled={disabled} onClick={props.fire} data-testid="cannons-fire">
        Fire!
      </button>
      <p className="cn-hint">
        {props.last ? (
          <>
            <span className="label">Your last shot</span> {elevation(props.last.angle).up}° {arrow(props.last.angle)} · power {props.last.power}: {shotWords(props.last, (id) => (id === props.me ? "you" : props.name(id)))}
          </>
        ) : (
          <>
            Drag on the field to aim · <kbd>←</kbd> <kbd>→</kbd> angle · <kbd>↑</kbd> <kbd>↓</kbd> power · <kbd>Space</kbd> fires
          </>
        )}
      </p>
    </div>
  );
}

// --- the players --------------------------------------------------------------

function Plates(props: { view: CannonsView; me: string; name(id: string): string; members: Props["members"]; serverNow: number; replaying: boolean }) {
  const { view } = props;
  // In the game: one per cannon, left to right as they stand. Before it: the seats.
  const rows: { playerId: string | null; cannon: CannonView | null; seat: number }[] = view.cannons.length
    ? [...view.cannons].sort((a, b) => a.x - b.x).map((c) => ({ playerId: c.playerId, cannon: c, seat: c.seat }))
    : view.seats.map((s, i) => ({ playerId: s?.playerId ?? null, cannon: null, seat: i }));
  return (
    <div className={`cn-plates n${rows.length}`}>
      {rows.map(({ playerId, cannon, seat }) => {
        if (!playerId) {
          return (
            <div key={`open${seat}`} className="cn-open-seat">
              <span className="label">Open seat</span>
            </div>
          );
        }
        const seated = view.seats[seat]?.playerId === playerId ? view.seats[seat] : null;
        const turn = (view.phase === "aiming" || view.phase === "flying") && view.turn === playerId;
        const won = view.phase === "over" && !props.replaying && view.result?.winner === playerId;
        let status = "";
        if (cannon && !cannon.alive && !(props.replaying && cannon.out === "hit")) {
          status = cannon.out === "left" ? "left" : cannon.out === "timeouts" ? "out of time" : cannon.by === playerId ? "hit itself" : `hit by ${cannon.by === props.me ? "you" : props.name(cannon.by!)}`;
        } else if (turn) status = view.phase === "flying" ? "fired!" : "aiming…";
        else if (!seated && view.phase !== "waiting") status = "left";
        if (cannon?.alive && cannon.timeouts > 0) status = [status, `${cannon.timeouts} of ${MAX_TIMEOUTS} timeouts`].filter(Boolean).join(" · ");
        const wins = seated ? `${seated.wins} ${seated.wins === 1 ? "win" : "wins"}` : "";
        return (
          <PlayerPlate
            key={playerId}
            playerId={playerId}
            name={props.name(playerId)}
            you={playerId === props.me}
            online={props.members.get(playerId)?.online !== false}
            active={turn && view.phase === "aiming"}
            winner={won}
            dim={!!cannon && !cannon.alive && !(props.replaying && cannon.out === "hit")}
            testId={`cannons-plate-${seat}`}
          >
            <div className="plate-line status">{[status, wins].filter(Boolean).join(" · ") || " "}</div>
            {turn && view.phase === "aiming" && <TurnTimer deadline={view.turnDeadline} totalMs={view.config.turnSeconds * 1000} serverNow={props.serverNow} />}
          </PlayerPlate>
        );
      })}
    </div>
  );
}

// --- words --------------------------------------------------------------------

const who = (id: string, me: string, name: (id: string) => string) => (id === me ? "You" : name(id));
const nameFor = (me: string, name: (id: string) => string) => (id: string) => (id === me ? "you" : name(id));

/** "Bob's shot landed 40 m short of you (to the left)." */
function shotSentence(s: ShotView, me: string, name: (id: string) => string): string {
  const shooter = s.by === me ? "Your shot" : `${name(s.by)}'s shot`;
  const words = shotWords(s, nameFor(me, name)).replace("hit its own cannon", s.by === me ? "hit your own cannon" : "hit their own cannon");
  return `${shooter} ${words}${s.hit ? "!" : "."}`;
}

function logLine(s: ShotView, me: string, name: (id: string) => string) {
  const words = shotWords(s, nameFor(me, name)).replace("hit its own cannon", s.by === me ? "hit your own cannon" : "hit their own cannon");
  return (
    <>
      <span className="cn-log-aim">
        {who(s.by, me, name)}: {elevation(s.angle).up}° {arrow(s.angle)} · {s.power} · {s.wind === 0 ? "no wind" : `wind ${Math.abs(s.wind)} ${s.wind > 0 ? "→" : "←"}`}
      </span>{" "}
      — {words}
    </>
  );
}

function News(props: { view: CannonsView; me: string; name(id: string): string; replay: Replay | null; landed: boolean; myTurn: boolean }) {
  const { view, me, name, replay } = props;
  let text: string;
  let tone = "";
  if (replay && !props.landed) {
    const s = replay.shot;
    text = `${s.by === me ? "You fire" : `${name(s.by)} fires`}: ${elevation(s.angle).up}° ${arrow(s.angle)}, power ${s.power}…`;
  } else if (view.phase === "waiting") {
    text = view.game === 0 ? "Each player is a cannon. Take turns firing; the last cannon standing wins." : "The game was called off. Waiting for players.";
  } else {
    const last = (replay ? replay.shot : null) ?? view.shots.at(-1);
    text = last ? shotSentence(last, me, name) : props.myTurn ? "You fire first." : `${name(view.turn ?? "")} fires first.`;
    if (view.passed && !replay) text = `${view.passed === me ? "You" : name(view.passed)} ran out of time: no shot. ${props.myTurn ? "Your turn." : `${name(view.turn ?? "")}'s turn.`}`;
    else if (last?.hit) tone = last.hit === me ? "bad" : last.by === me ? "good" : "";
  }
  return (
    <Herald testId="cannons-news" className={`cn-news ${tone}`}>
      <span>{text}</span>
    </Herald>
  );
}

function trayText(view: CannonsView, me: string, name: (id: string) => string, replaying: boolean, shooter: string | null): string {
  if (replaying) return "Watch it fly…";
  if (view.phase === "aiming" || view.phase === "flying") {
    if (view.phase === "flying") return "Watch it fly…";
    if (shooter === me) return "Your shot.";
    const mine = view.cannons.find((c) => c.playerId === me);
    return `${name(shooter ?? "")} is aiming${mine && !mine.alive ? "" : mine ? " (maybe at you)" : ""}…`;
  }
  if (view.phase === "over") return view.seats.some((s) => !s) ? "Take the open seat to play the next game." : "You're watching.";
  return "";
}

function TrayAside(props: { view: CannonsView; busy: boolean; connected: boolean; send(op: CannonsOp): void }) {
  const { view } = props;
  const disabled = props.busy || !props.connected;
  if (view.phase !== "over") return null;
  const open = view.seats.findIndex((s) => !s);
  return open < 0 ? null : (
    <button className="btn subtle" disabled={disabled} onClick={() => props.send({ type: "sit", seat: open })}>
      Take the open seat
    </button>
  );
}

/** The end: the last cannon standing, and how everyone shot. */
function CannonsResult(props: { view: CannonsView; open: boolean; me: string; name(id: string): string; seated: boolean; rematch: (() => void) | null; disabled: boolean }) {
  const { view, me, name } = props;
  const r = view.result;
  const you = (id: string) => id === me;
  let subtitle = "";
  if (r) {
    const others = view.cannons.length > 2 ? "the last of the others" : "the other player";
    const how = { hit: "", left: ` (${others} left)`, timeouts: ` (${others} ran out of time)` }[r.reason];
    subtitle = r.winner ? `The last cannon standing, after ${r.shots} ${r.shots === 1 ? "shot" : "shots"}${how}.` : "Nobody's left standing.";
  }
  // Winner first, then whoever lasted longest.
  const order = [...view.cannons].sort((a, b) => Number(b.alive) - Number(a.alive) || outOrder(view, b) - outOrder(view, a));
  return (
    <GameOver
      open={props.open && !!r}
      gameKey={view.game}
      me={me}
      testId="cannons-result"
      title={r?.winner ? (you(r.winner) ? "You win!" : `${name(r.winner)} wins!`) : "Nobody wins"}
      subtitle={subtitle}
      columns={["Shots", "Hits", "Out", "Wins here"]}
      rows={order.map((c) => {
        const seat = view.seats[c.seat]?.playerId === c.playerId ? view.seats[c.seat] : null;
        const shots = view.shots.filter((s) => s.by === c.playerId);
        return {
          playerId: c.playerId,
          name: name(c.playerId),
          winner: r?.winner === c.playerId,
          left: !seat,
          cells: [shots.length, shots.filter((s) => s.hit && s.hit !== c.playerId).length, c.alive ? "–" : c.out === "hit" ? (c.by === c.playerId ? "own goal" : `by ${c.by === me ? "you" : name(c.by!)}`) : c.out === "left" ? "left" : "time", seat?.wins ?? "–"],
        };
      })}
      actions={
        props.rematch ? (
          <button className="btn primary" disabled={props.disabled} onClick={props.rematch}>
            Play again
          </button>
        ) : (
          props.seated && <span className="muted small">Waiting for every seat to fill.</span>
        )
      }
    />
  );
}

/** When a cannon went out: the shot that hit it, or late for other reasons. */
function outOrder(view: CannonsView, c: CannonView): number {
  if (c.alive) return Infinity;
  const shot = view.shots.find((s) => s.hit === c.playerId);
  return shot ? shot.n : view.shots.length + 1;
}
