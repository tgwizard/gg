import { type CSSProperties, useMemo } from "react";
import { hash2, playerStyle } from "../../../ui";
import { LOOP, RIDER_NAMES, RIDERS, type Rider, type Stop } from "../engine";
import { type BoardShape, crowd, type Point } from "./geometry";
import { RIDER_LOOK } from "./riders";

export interface Token {
  playerId: string;
  name: string;
  color: number;
  /** Where they are (on the loop, or LOOP… on the bridge). */
  at: number;
  riders: Rider[];
  /** Show the empty places of friends still to find (in a race). */
  gaps: boolean;
  /** Powered up by the rainbow: a rainbow roll still to roll. */
  powered: boolean;
  hops: number;
  active: boolean;
  you: boolean;
}

/** Where a position is on the board: a stop on the loop or on the bridge. */
export const pointAt = (shape: BoardShape, at: number): Point => (at < LOOP ? shape.stops[at]! : shape.bridge[at - LOOP]!);

const BANDS = ["--uni-red", "--uni-orange", "--uni-yellow", "--uni-green", "--uni-blue", "--uni-purple"];

/**
 * The meadow: the path round it and its stops, the rainbow bridge to the castle (faded until
 * someone has all six friends, `bridgeOpen`), and the unicorns, each with its friends round it.
 */
export function Board(props: {
  shape: BoardShape;
  track: Stop[];
  tokens: Token[];
  glow: number | null;
  bridgeOpen: boolean;
  /** Rainbow power flowing from the meter (at `from`, in board units) into these unicorns. */
  flow: { key: number; from: Point; to: string[] } | null;
}) {
  const { shape, track, tokens } = props;
  const decor = useMemo(() => meadowDecor(shape), [shape]);
  const line = (points: Point[]) => points.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" L ");
  const d = `M ${line(shape.path)} Z`;
  const bridge = `M ${line(shape.bridgePath)}`;
  const together = new Map<number, Token[]>();
  for (const t of tokens) together.set(t.at, [...(together.get(t.at) ?? []), t]);
  const castle = shape.bridge.at(-1)!;
  return (
    <svg className="uni-board" viewBox={`0 0 ${shape.width} ${shape.height}`} role="img" aria-label="The meadow">
      {decor.map((x, i) =>
        x.kind === "tuft" ? (
          <path key={i} className="uni-tuft" d={`M ${x.x - 7} ${x.y + 4} q 3 -10 5 -1 q 2 -13 4 0 q 3 -9 5 1`} />
        ) : (
          <g key={i} className={`uni-flower ${x.kind}`} transform={`translate(${x.x} ${x.y}) scale(${x.size})`}>
            {[0, 72, 144, 216, 288].map((a) => (
              <circle key={a} cx={Math.cos((a * Math.PI) / 180) * 4} cy={Math.sin((a * Math.PI) / 180) * 4} r={3.4} />
            ))}
            <circle className="uni-flower-heart" r={2.4} />
          </g>
        ),
      )}
      <g className={`uni-bridge ${props.bridgeOpen ? "open" : ""}`} data-testid="uni-bridge" data-open={props.bridgeOpen || undefined}>
        <title>{props.bridgeOpen ? "The rainbow bridge is open, for unicorns with all six friends" : "The rainbow bridge: it opens when you have all six friends"}</title>
        {BANDS.map((c, i) => (
          <path key={c} className="uni-bridge-band" d={bridge} style={{ stroke: `var(${c})`, strokeWidth: 44 - i * 7 }} />
        ))}
        {shape.bridge.slice(0, -1).map((p, i) => (
          <circle key={i} className="uni-cloud" cx={p.x} cy={p.y} r={17} data-stop={LOOP + i} />
        ))}
        <g transform={`translate(${castle.x} ${castle.y})`} data-stop={LOOP + shape.bridge.length - 1}>
          <circle className="uni-castle" r={48} />
          <text className="uni-castle-face" textAnchor="middle" dominantBaseline="central" y={-2}>
            🏰
          </text>
        </g>
      </g>
      <path className="uni-path-edge" d={d} />
      <path className="uni-path" d={d} />
      {shape.stops.map((p, i) => (
        <StopMark key={i} at={p} stop={track[i]!} index={i} glow={props.glow === i} />
      ))}
      {props.flow &&
        tokens
          .filter((t) => props.flow!.to.includes(t.playerId))
          .map((t) => {
            const here = together.get(t.at)!;
            const off = crowd(here.length, here.indexOf(t), here.length > 2 ? 46 : 40);
            const p = pointAt(shape, t.at);
            const [x, y] = [p.x + off.x, p.y + off.y];
            const { from } = props.flow!;
            const lift = Math.min(from.y, y) - 140;
            const path = `M ${from.x} ${from.y} Q ${(from.x + x) / 2} ${lift} ${x} ${y}`;
            return (
              <g key={`${props.flow!.key}:${t.playerId}`} className="uni-flow" aria-hidden>
                {BANDS.map((c, i) => (
                  <path key={c} d={path} pathLength={1} style={{ stroke: `var(${c})`, strokeWidth: 18 - i * 3 }} />
                ))}
              </g>
            );
          })}
      {/* Always in the same order: moving one to the top (the one whose turn it is, say) would replay its last hop and its friends hopping on. */}
      {tokens.map((t) => {
        const here = together.get(t.at)!;
        // Apart enough that their rings of friends don't hide each other.
        const off = crowd(here.length, here.indexOf(t), here.length > 2 ? 46 : 40);
        const p = pointAt(shape, t.at);
        return (
          <g
            key={t.playerId}
            className={`uni-token ${t.active ? "active" : ""} ${t.you ? "you" : ""} ${t.powered ? "powered" : ""}`}
            style={{ ...playerStyle(t.color), transform: `translate(${p.x + off.x}px, ${p.y + off.y}px)` } as CSSProperties}
            data-testid="uni-token"
            data-player={t.playerId}
            data-stop={t.at}
            data-powered={t.powered || undefined}
          >
            <title>{t.powered ? `${t.name}: rainbow power!` : t.name}</title>
            {t.powered && <Aura />}
            {/* Two names for the same hop, so each new one restarts it without remounting the friends. */}
            <g className={t.hops ? (t.hops % 2 ? "uni-hop-a" : "uni-hop-b") : undefined}>
              <ellipse className="uni-token-shadow" cy={24} rx={18} ry={5} />
              <circle className="uni-token-base" r={23} />
              <text className="uni-token-face" y={1} textAnchor="middle" dominantBaseline="central">
                🦄
              </text>
              {RIDERS.map((r) => (t.riders.includes(r) ? <Friend key={r} rider={r} /> : t.gaps ? <Gap key={r} rider={r} /> : null))}
            </g>
          </g>
        );
      })}
    </svg>
  );
}

/** Rainbow power, round a unicorn that has a rainbow roll to come: a turning ring of the colors, and twinkles. */
function Aura() {
  return (
    <g className="uni-aura" aria-hidden>
      <g className="uni-aura-ring">
        {BANDS.map((c, i) => {
          const a0 = (i / 6) * 2 * Math.PI;
          const a1 = ((i + 1) / 6) * 2 * Math.PI;
          const r = 46;
          return <path key={c} d={`M ${(Math.cos(a0) * r).toFixed(1)} ${(Math.sin(a0) * r).toFixed(1)} A ${r} ${r} 0 0 1 ${(Math.cos(a1) * r).toFixed(1)} ${(Math.sin(a1) * r).toFixed(1)}`} style={{ stroke: `var(${c})` }} />;
        })}
      </g>
      {[0, 1, 2].map((i) => (
        <text key={i} className={`uni-twinkle t${i}`} textAnchor="middle" dominantBaseline="central">
          ✨
        </text>
      ))}
    </g>
  );
}

/** Where a friend still to find will ride, round a unicorn. */
function Gap({ rider }: { rider: Rider }) {
  const angle = -Math.PI / 2 + (RIDERS.indexOf(rider) / RIDERS.length) * 2 * Math.PI;
  return <circle className="uni-friend-gap" cx={(Math.cos(angle) * 33).toFixed(1)} cy={(Math.sin(angle) * 33).toFixed(1)} r={8} style={{ "--rc": RIDER_LOOK[rider].color } as CSSProperties} />;
}

/** A friend riding with a unicorn: in a ring round it, each in their own place (a rainbow, once all six are aboard). They hop on from the stop. */
function Friend({ rider }: { rider: Rider }) {
  const angle = -Math.PI / 2 + (RIDERS.indexOf(rider) / RIDERS.length) * 2 * Math.PI;
  const x = Math.cos(angle) * 33;
  const y = Math.sin(angle) * 33;
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`} data-testid="uni-friend" data-rider={rider}>
      <g className="uni-friend" style={{ "--rc": RIDER_LOOK[rider].color, "--jx": `${(-x).toFixed(1)}px`, "--jy": `${(-y).toFixed(1)}px` } as CSSProperties}>
        <circle r={11} />
        <text textAnchor="middle" dominantBaseline="central" y={1}>
          {RIDER_LOOK[rider].emoji}
        </text>
      </g>
    </g>
  );
}

function StopMark({ at, stop, index, glow }: { at: Point; stop: Stop; index: number; glow: boolean }) {
  const label = stop.kind === "start" ? "Start" : stop.riders.length ? stop.riders.map((r) => RIDER_NAMES[r]).join(", ") : "Meadow";
  return (
    <g className={`uni-stop ${stop.kind} ${glow ? "glow" : ""}`} transform={`translate(${at.x} ${at.y})`} data-stop={index}>
      <title>{label}</title>
      {glow && <circle className="uni-stop-glow" r={52} />}
      {stop.kind === "start" ? (
        <>
          <circle className="uni-start" r={40} />
          <Arch />
          <text className="uni-start-text" y={22} textAnchor="middle">
            Start
          </text>
        </>
      ) : stop.kind === "meadow" ? (
        <circle className="uni-meadow-stone" r={17} />
      ) : stop.kind === "stop" ? (
        <>
          <circle className="uni-stone" r={34} style={{ "--rc": RIDER_LOOK[stop.riders[0]!].color } as CSSProperties} />
          <text className="uni-stop-face" textAnchor="middle" dominantBaseline="central" y={2}>
            {RIDER_LOOK[stop.riders[0]!].emoji}
          </text>
        </>
      ) : (
        <>
          <circle className="uni-station" r={40} />
          {stop.riders.map((r, i) => {
            const p = crowd(stop.riders.length, i, stop.riders.length === 2 ? 17 : 19);
            return <Mini key={r} rider={r} at={p} />;
          })}
        </>
      )}
    </g>
  );
}

function Mini({ rider, at }: { rider: Rider; at: Point }) {
  return (
    <g transform={`translate(${at.x} ${at.y})`} style={{ "--rc": RIDER_LOOK[rider].color } as CSSProperties}>
      <circle className="uni-mini" r={16} />
      <text className="uni-mini-face" textAnchor="middle" dominantBaseline="central" y={1}>
        {RIDER_LOOK[rider].emoji}
      </text>
    </g>
  );
}

/** A little rainbow over the start. */
function Arch() {
  return (
    <g className="uni-arch" transform="translate(0 6)">
      {["--uni-red", "--uni-orange", "--uni-yellow", "--uni-green", "--uni-blue", "--uni-purple"].map((c, i) => {
        const r = 26 - i * 3.2;
        return <path key={c} d={`M ${-r} 0 A ${r} ${r} 0 0 1 ${r} 0`} style={{ stroke: `var(${c})` }} />;
      })}
    </g>
  );
}

/** Flowers and tufts of grass scattered over the meadow, the same every time, off the path. */
function meadowDecor(shape: BoardShape) {
  const out: { kind: "tuft" | "a" | "b" | "c"; x: number; y: number; size: number }[] = [];
  const near = (points: Point[], x: number, y: number, d: number) => points.some((p, i) => i % 6 === 0 && Math.hypot(p.x - x, p.y - y) < d);
  const clear = (x: number, y: number) =>
    shape.stops.every((s) => Math.hypot(s.x - x, s.y - y) > 58) && !near(shape.path, x, y, 30) && !near(shape.bridgePath, x, y, 36) && Math.hypot(shape.bridge.at(-1)!.x - x, shape.bridge.at(-1)!.y - y) > 80;
  for (let i = 0; out.length < 70 && i < 600; i++) {
    const x = 24 + hash2(i, 1) * (shape.width - 48);
    const y = 24 + hash2(i, 2) * (shape.height - 48);
    const c = shape.controls;
    // Keep the middle's busy part clear for the rainbow and the die.
    if (x > c.x + 30 && x < c.x + c.width - 30 && y > c.y + 40 && y < c.y + c.height - 40) continue;
    if (!clear(x, y)) continue;
    const k = hash2(i, 3);
    out.push({ kind: k < 0.45 ? "tuft" : k < 0.7 ? "a" : k < 0.88 ? "b" : "c", x, y, size: 0.8 + hash2(i, 4) * 0.6 });
  }
  return out;
}
