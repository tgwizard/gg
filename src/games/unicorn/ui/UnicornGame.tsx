import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { Button, busyWhy, play, useNarrow, usePlayerColors } from "../../../ui";
import { reducedMotion, useOnChange } from "../../kit/ui/Flights";
import { GameOver } from "../../kit/ui/GameOver";
import { GameLog, TableFooter } from "../../kit/ui/GameParts";
import { PlayerPlate } from "../../kit/ui/PlayerPlate";
import { useSend } from "../../kit/ui/useSend";
import type { GameUIProps } from "../../ui";
import { FINISH, LOOP, type Racer, RIDER_NAMES, RIDERS, type Rider, type UnicornEvent, type UnicornView } from "../engine";
import type { UnicornOp } from "../index";
import { Board, pointAt, type Token } from "./Board";
import { Die } from "./Die";
import { type BoardShape, boardShape } from "./geometry";
import { TUMBLE_MS, useGallop } from "./motion";
import { FriendRing, RIDER_LOOK, RiderToken, riderStyle } from "./riders";
import "./unicorn.css";

type Props = GameUIProps<UnicornView, UnicornOp>;

export function UnicornGame({ view, me, members, connected, sendOp }: Props) {
  const { busy, send } = useSend(sendOp);
  // No disabled buttons: one that can't be used this moment says why when pressed.
  const why = busyWhy({ busy, connected });
  const colorOf = usePlayerColors();
  const tall = useNarrow();
  const shape = useMemo(() => boardShape(view.track.length, view.bridge, tall), [view.track.length, view.bridge, tall]);
  const motion = useGallop(view, connected);
  const name = (id: string) => members.get(id)?.name ?? "Player";
  const nameOf = (id: string) => (id === me ? "You" : name(id));

  const racing = view.phase === "playing" || view.phase === "over";
  const current = view.phase === "playing" ? view.racers.find((r) => r.seat === view.turn && !r.left) : undefined;
  // On the board: the racers, or before the first race whoever's sat down, waiting at the start.
  const tokens: Token[] = racing
    ? view.racers
        .filter((r) => !r.left)
        .map((r) => ({
          playerId: r.playerId,
          name: name(r.playerId),
          color: colorOf(r.playerId),
          at: motion.at(r.playerId, r.at),
          riders: motion.riders(r.playerId, r.riders),
          gaps: true,
          // From the rainbow filling until the rainbow roll is rolled.
          powered: r.rainbowRolls > 0 || (r === current && view.rainbowRoll && view.stage === "roll"),
          hops: motion.hops(r.playerId),
          active: r === current,
          you: r.playerId === me,
        }))
    : view.seats.flatMap((s) => (s ? [{ playerId: s.playerId, name: name(s.playerId), color: colorOf(s.playerId), at: 0, riders: [], gaps: false, powered: false, hops: 0, active: false, you: s.playerId === me }] : []));

  const mine = view.racers.find((r) => r.playerId === me && !r.left);
  const choosing = view.you.pick.length > 0 && motion.settled;
  const middle = shape.controls;
  // Open once someone has all six friends (and their gallop to the last one has played out).
  const bridgeOpen = racing && view.racers.some((r) => !r.left && motion.riders(r.playerId, r.riders).length === RIDERS.length);
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;

  // Rainbow power: when the meter fills, it flows from it into every kid's unicorn (once the die has landed).
  const stage = useRef<HTMLDivElement>(null);
  const [flow, setFlow] = useState<{ key: number; from: { x: number; y: number }; to: string[] } | null>(null);
  useOnChange(racing ? view.game * 1000 + view.rainbows : null, () => {
    const kids = view.log.findLast((e) => e.type === "rainbow");
    const meter = stage.current?.querySelector(".uni-rainbow svg")?.getBoundingClientRect();
    const box = stage.current?.getBoundingClientRect();
    if (!kids || kids.type !== "rainbow" || !kids.kids.length || !meter || !box || reducedMotion()) return;
    const from = { x: ((meter.left + meter.width / 2 - box.left) / box.width) * shape.width, y: ((meter.top + meter.height * 0.55 - box.top) / box.height) * shape.height };
    const key = view.rainbows;
    setTimeout(() => setFlow({ key, from, to: kids.kids }), TUMBLE_MS);
    setTimeout(() => setFlow((f) => (f?.key === key ? null : f)), TUMBLE_MS + 1700);
  });

  return (
    <div className={`uni ${tall ? "tall" : ""}`}>
      <div className="uni-stage" ref={stage} style={{ aspectRatio: `${shape.width} / ${shape.height}` }}>
        <Board shape={shape} track={view.track} tokens={tokens} glow={choosing && mine ? mine.at : null} bridgeOpen={bridgeOpen} flow={flow} />
        <div
          className="uni-middle"
          style={{ left: pct(middle.x, shape.width), top: pct(middle.y, shape.height), width: pct(middle.width, shape.width), height: pct(middle.height, shape.height) }}
        >
          <RainbowMeter charge={view.rainbow} of={view.config.rainbowAt} filled={view.game * 1000 + view.rainbows} />
          {view.phase === "playing" ? (
            <>
              <Die
                value={view.lastRoll?.value ?? null}
                tumbling={motion.tumbling}
                settled={motion.settled}
                // A rainbow die for a rainbow roll: the one playing out, then the one up next.
                rainbow={motion.settled ? view.rainbowRoll && view.stage === "roll" : !!view.lastRoll?.rainbow}
                ready={view.you.roll && motion.settled}
                why={dieWhy(view, current!, me, name, motion.settled) ?? why}
                onRoll={() => send({ type: "roll" })}
              />
              <Turn view={view} me={me} current={current!} nameOf={nameOf} settled={motion.settled} />
            </>
          ) : (
            <Between view={view} why={why} send={send} />
          )}
        </div>
        <StopBubble view={view} me={me} name={name} shape={shape} settled={motion.settled} why={why} send={send} />
      </div>

      <Racers view={view} me={me} name={name} riders={motion.riders} current={current} why={why} send={send} />

      <GameOver
        open={view.phase === "over" && !!view.result && motion.settled}
        gameKey={view.game}
        me={me}
        title={view.result?.winners[0] === me ? "You won the race!" : `${name(view.result?.winners[0] ?? "")} wins the race!`}
        subtitle="Over the rainbow bridge to the castle, with all six friends."
        columns={["Friends"]}
        rows={[...view.racers]
          .sort((a, b) => b.riders.length - a.riders.length)
          .map((r) => ({
            playerId: r.playerId,
            name: name(r.playerId),
            winner: view.result?.winners.includes(r.playerId),
            left: r.left,
            cells: [`${r.riders.length}/${RIDERS.length}`],
            detail: (
              <span className="uni-friends small">
                {RIDERS.map((x) => (
                  <RiderToken key={x} rider={x} size="sm" missing={!r.riders.includes(x)} />
                ))}
              </span>
            ),
          }))}
        actions={
          view.canStart && view.you.seat !== null ? (
            <Button className="btn primary" why={why} onClick={() => send({ type: "start" })}>
              Race again
            </Button>
          ) : undefined
        }
        testId="uni-over"
      />

      <TableFooter
        log={view.log.length > 0 && <Log log={view.log} nameOf={nameOf} />}
        actions={
          view.you.seat !== null && (
            <Button className="btn ghost small" why={why} onClick={() => send({ type: "leave" })}>
              {view.you.racing && view.phase === "playing" ? "Leave the race" : "Leave seat"}
            </Button>
          )
        }
      />
    </div>
  );
}

/** Why the die isn't yours to roll right now, if it isn't. */
function dieWhy(view: UnicornView, current: Racer, me: string, name: (id: string) => string, settled: boolean): string | null {
  if (!settled) return "Wait for the unicorn to stop first!";
  if (view.you.roll) return null;
  if (current.playerId === me) return "Pick up a friend first!";
  return `It's ${name(current.playerId)}'s turn to roll.`;
}

/** Under the die: whose turn it is, and what to do when it's yours. */
function Turn(props: { view: UnicornView; me: string; current: Racer; nameOf(id: string): string; settled: boolean }) {
  const { view, me, current, nameOf, settled } = props;
  if (!settled) return <div className="uni-turn" data-testid="uni-turn" />;
  const yours = current.playerId === me;
  const homeward = current.riders.length === RIDERS.length;
  const text =
    view.stage === "pick"
      ? yours
        ? "Pick up a friend!"
        : `${nameOf(current.playerId)} is picking up a friend…`
      : yours
        ? view.rainbowRoll
          ? "🌈 A rainbow roll! Tap the die"
          : `Your turn! Tap the die${homeward ? ": off to the castle!" : ""}`
        : `${nameOf(current.playerId)}'s turn${view.rainbowRoll ? ": a rainbow roll!" : ""}`;
  return (
    <div className={`uni-turn ${yours ? "yours" : ""}`} data-testid="uni-turn">
      <p className="uni-whose">{text}</p>
    </div>
  );
}

const MEADOW = ["Oh no, there's nothing here!", "Just grass and daisies here.", "Nobody here… only a butterfly.", "Oh no, nobody's waiting here!"];

interface Saying {
  key: string;
  at: number;
  emoji: string;
  text: string;
}

/** What the last roll came to, said at the stop it ended on (a friend hopping on, an empty meadow…), or null. */
function saying(view: UnicornView, name: (id: string) => string, me: string): Saying | null {
  const i = view.log.findLastIndex((e) => e.type === "roll");
  if (i < 0 || view.phase === "lobby") return null;
  const roll = view.log[i] as Extract<UnicornEvent, { type: "roll" }>;
  const racer = view.racers.find((r) => r.playerId === roll.who);
  if (!racer || roll.to === FINISH) return null;
  const key = `${view.game}:${view.rolls}`;
  const picked = view.log.slice(i + 1).find((e): e is Extract<UnicornEvent, { type: "pickup" }> => e.type === "pickup" && e.who === roll.who);
  if (picked) return { key: `${key}:${picked.rider}`, at: roll.to, emoji: RIDER_LOOK[picked.rider].emoji, text: `The ${RIDER_NAMES[picked.rider]} hops on!` };
  if (view.stage === "pick" && view.turn === racer.seat) return null;
  if (roll.to >= LOOP) return { key, at: roll.to, emoji: "🌈", text: "Over the rainbow bridge!" };
  if (racer.riders.length === RIDERS.length) return { key, at: roll.to, emoji: "🏰", text: roll.to === 0 ? "The bridge is next!" : "Off to the castle!" };
  if (roll.to === 0) return { key, at: 0, emoji: "🦄", text: "Back at the start!" };
  const stop = view.track[roll.to]!;
  if (!stop.riders.length) return { key, at: roll.to, emoji: "🌼", text: MEADOW[view.rolls % MEADOW.length]! };
  return { key, at: roll.to, emoji: "💞", text: `Everyone here is already riding with ${roll.who === me ? "you" : name(roll.who)}!` };
}

/**
 * A bubble out of the stop a unicorn stopped at: who wants a ride there (to pick from, if
 * it's you), or for a moment what the roll came to. Only once the gallop has played out,
 * and a refresh doesn't say again what was said before.
 */
function StopBubble(props: { view: UnicornView; me: string; name(id: string): string; shape: BoardShape; settled: boolean; why: string | null; send(op: UnicornOp): unknown }) {
  const { view, me, name, shape, settled, why, send } = props;
  const say = settled ? saying(view, name, me) : null;
  const [heard, setSaid] = useState<Saying | null>(null);
  const seen = useRef(say?.key ?? null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (!say || say.key === seen.current) return;
    seen.current = say.key;
    setSaid(say);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaid(null), 3500);
  }, [say?.key]);
  useEffect(() => () => clearTimeout(timer.current), []);
  // The next roll on its way: what was said about the last one goes.
  const said = settled ? heard : null;

  const current = view.phase === "playing" ? view.racers.find((r) => r.seat === view.turn && !r.left) : undefined;
  const picking = settled && view.stage === "pick" && current && view.choice ? current : null;
  const at = picking ? picking.at : said?.at;
  if (at === undefined || (!picking && !said)) return null;
  const p = pointAt(shape, at);
  const fx = p.x / shape.width;
  const below = p.y / shape.height < 0.3;
  const align = fx < 0.25 ? "start" : fx > 0.75 ? "end" : "middle";
  const style = { left: `${fx * 100}%`, top: `${((p.y + (below ? 50 : -50)) / shape.height) * 100}%` };
  const className = `uni-bubble ${below ? "below" : "above"} ${align}`;
  if (picking) {
    const options = view.choice!;
    const mine = picking.playerId === me;
    return (
      <div className={`${className} pick`} style={style} role="group" aria-label="Who wants a ride?" data-testid="uni-bubble" key={`pick:${view.rolls}`}>
        <p className="uni-bubble-title">{mine ? (options.length === 1 ? `The ${RIDER_NAMES[options[0]!]} wants a ride!` : "Who wants a ride?") : `${name(picking.playerId)} is picking up a friend…`}</p>
        <div className="uni-choice-row">
          {options.map((r) =>
            mine ? (
              <Button key={r} className="uni-choice-btn" style={riderStyle(r)} why={why} onClick={() => send({ type: "pick", rider: r })} aria-label={`Pick up the ${RIDER_NAMES[r]}`}>
                <span aria-hidden>{RIDER_LOOK[r].emoji}</span>
                <span className="uni-choice-name">{RIDER_NAMES[r]}</span>
              </Button>
            ) : (
              <RiderToken key={r} rider={r} size="lg" />
            ),
          )}
        </div>
      </div>
    );
  }
  return (
    <div className={`${className} say`} style={style} role="status" data-testid="uni-bubble" key={said!.key}>
      <span className="uni-bubble-emoji" aria-hidden>
        {said!.emoji}
      </span>
      <span className="uni-bubble-text">{said!.text}</span>
    </div>
  );
}

/** Before a race (or after one): what to do, and the start button. */
function Between({ view, why, send }: { view: UnicornView; why: string | null; send(op: UnicornOp): unknown }) {
  const seated = view.seats.filter(Boolean).length;
  return (
    <div className="uni-between">
      <p className="display uni-title">Unicorn race</p>
      {view.phase === "lobby" && (
        <p className="muted">
          {view.you.seat === null ? "Sit down below, as a kid or a grown-up." : seated < 4 ? "Start when everyone's here: up to four can race." : "Everyone's here!"}
        </p>
      )}
      {view.canStart && view.you.seat !== null && view.phase === "lobby" && (
        <Button className="btn primary big" why={why} onClick={() => send({ type: "start" })}>
          Start the race
        </Button>
      )}
    </div>
  );
}

/** Each seat: a racer with the friends aboard, someone waiting, or a place to sit. */
function Racers(props: { view: UnicornView; me: string; name(id: string): string; riders(id: string, fallback: Rider[]): Rider[]; current: Racer | undefined; why: string | null; send(op: UnicornOp): unknown }) {
  const { view, me, name, current, why, send } = props;
  const racing = view.phase !== "lobby";
  return (
    <div className="uni-racers" data-testid="uni-racers">
      {view.seats.map((seat, i) => {
        const r = racing ? view.racers.find((x) => x.seat === i && !x.left) : undefined;
        const id = r?.playerId ?? seat?.playerId;
        if (!id) {
          if (view.you.seat !== null && racing) return null;
          return (
            <div key={i} className="uni-seat open" data-testid={`uni-seat-${i}`}>
              {view.you.seat === null ? (
                <>
                  <span className="label">Join the race as a…</span>
                  <div className="uni-join">
                    {AGES.map((a) => (
                      <Button key={a.label} className={`uni-age-pick ${a.kid ? "kid" : "grown"}`} why={why} onClick={() => send({ type: "sit", seat: i, kid: a.kid })} aria-label={`Join as a ${a.label.toLowerCase()}`}>
                        <span className="uni-age-emoji" aria-hidden>
                          {a.emoji}
                        </span>
                        {a.label}
                      </Button>
                    ))}
                  </div>
                </>
              ) : (
                <span className="label">Open seat</span>
              )}
            </div>
          );
        }
        const kid = r ? r.kid : !!seat?.kid;
        const shown = r ? props.riders(r.playerId, r.riders) : [];
        const you = id === me;
        const powered = !!r && (r.rainbowRolls > 0 || (r === current && view.rainbowRoll && view.stage === "roll"));
        return (
          <div key={i} className="uni-seat" data-testid={`uni-seat-${i}`}>
            <PlayerPlate
              className={powered ? "uni-powered" : undefined}
              playerId={id}
              name={name(id)}
              you={you}
              active={!!r && r === current}
              winner={!!r && view.phase === "over" && !!view.result?.winners.includes(id)}
              tags={<span className={`tag uni-age-tag ${kid ? "kid" : ""}`}>{kid ? "🧸 kid" : "☕ grown-up"}</span>}
            >
              {r ? (
                <div className="uni-plate-body">
                  <FriendRing riders={shown} />
                  <div className="uni-plate-status">
                    <strong>
                      {shown.length < RIDERS.length
                        ? `${RIDERS.length - shown.length} ${RIDERS.length - shown.length === 1 ? "friend" : "friends"} to go`
                        : r.at >= LOOP
                          ? "On the rainbow bridge!"
                          : "Off to the castle!"}
                    </strong>
                    {powered && <span className="uni-rainbow-rolls">🌈 Rainbow power!{r.rainbowRolls > 1 ? ` ×${r.rainbowRolls}` : ""}</span>}
                  </div>
                </div>
              ) : (
                <div className="plate-line status">
                  {seat!.wins} {seat!.wins === 1 ? "win" : "wins"}
                  {view.phase === "playing" ? " · next race" : ""}
                </div>
              )}
              {you && !(r && view.phase === "playing") && (
                <div className={`uni-age-switch ${kid ? "kid" : "grown"}`} role="group" aria-label="You're racing as">
                  {AGES.map((a) => (
                    // Pressing the one you are already does nothing: it's a switch, not an action.
                    <Button key={a.label} className="uni-age-side" aria-pressed={kid === a.kid} why={kid === a.kid ? null : why} onClick={() => kid !== a.kid && send({ type: "kid", kid: a.kid })}>
                      <span aria-hidden>{a.emoji}</span> {a.label}
                    </Button>
                  ))}
                </div>
              )}
            </PlayerPlate>
          </div>
        );
      })}
    </div>
  );
}

const AGES = [
  { kid: true, label: "Kid", emoji: "🧸" },
  { kid: false, label: "Grown-up", emoji: "☕" },
];

/** The rainbow over the middle, filling with every roll. */
function RainbowMeter({ charge, of, filled }: { charge: number; of: number; filled: number }) {
  const [burst, setBurst] = useState(false);
  // Full: it flashes (once the die has landed), and starts again.
  useOnChange(filled, () => {
    setTimeout(() => {
      setBurst(true);
      play("sparkle");
    }, TUMBLE_MS);
    setTimeout(() => setBurst(false), TUMBLE_MS + 1200);
  });
  const bands = ["--uni-red", "--uni-orange", "--uni-yellow", "--uni-green", "--uni-blue", "--uni-purple"];
  const frac = burst ? 1 : Math.min(1, charge / of);
  return (
    <div className={`uni-rainbow ${burst ? "burst" : ""}`} data-testid="uni-rainbow" title={`Rainbow power: ${charge} of ${of}`}>
      <svg viewBox="0 0 220 116" aria-hidden>
        {bands.map((c, i) => {
          const r = 100 - i * 11;
          const d = `M ${110 - r} 110 A ${r} ${r} 0 0 1 ${110 + r} 110`;
          return (
            <g key={c}>
              <path className="uni-band empty" d={d} />
              {frac > 0 && <path className="uni-band" d={d} pathLength={1} style={{ stroke: `var(${c})`, strokeDasharray: `${frac} 2` } as CSSProperties} />}
            </g>
          );
        })}
      </svg>
      <span className="uni-rainbow-label label">Rainbow power</span>
    </div>
  );
}

function Log({ log, nameOf }: { log: UnicornEvent[]; nameOf(id: string): string }) {
  return (
    <GameLog title="What happened">
      {[...log].reverse().map((e, i) => (
        <li key={i}>
          {e.type === "roll"
            ? `${nameOf(e.who)} rolled ${e.value}${e.rainbow ? " (a rainbow roll)" : ""}.`
            : e.type === "pickup"
              ? `${nameOf(e.who)} picked up the ${RIDER_NAMES[e.rider]} ${RIDER_LOOK[e.rider].emoji}.`
              : e.type === "rainbow"
                ? e.kids.length
                  ? `Rainbow power! A rainbow roll for ${e.kids.map(nameOf).join(" & ")}.`
                  : "The rainbow filled up (no kids racing to get a roll)."
                : `${nameOf(e.who)} left the race.`}
        </li>
      ))}
    </GameLog>
  );
}
