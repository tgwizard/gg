import { type PointerEvent, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { play, playerStyle, usePlayerColors } from "../../../ui";
import { reducedMotion } from "../../kit/ui/Flights";
import type { CannonsView, CannonView, ShotView } from "../engine";
import { along, BARREL, dir, elevation, HEIGHT, MAX_POWER, MIN_POWER, PIVOT, STEP, TICK_MS, WIDTH } from "../physics";

/** A shot being shown as it flies: the ground and cannons as they were before it, until it lands. */
export interface Replay {
  shot: ShotView;
  terrain: number[];
  cannons: CannonView[];
}

export interface Aim {
  angle: number;
  power: number;
}

/** Below bedrock shown under the field, and the default camera. */
const FLOOR = 16;
const HOME = { x: 0, y: -FLOOR, w: WIDTH, h: HEIGHT + FLOOR };
/** World meters per power point when dragging to aim. */
const DRAG_SCALE = 2.2;
/** How long the burst and the camera's way back take after the ball lands. */
const AFTER_MS = 1100;

type Box = typeof HOME;
const sy = (y: number) => HEIGHT - y;
const viewBox = (b: Box) => `${b.x} ${sy(b.y + b.h)} ${b.w} ${b.h}`;

/**
 * The field from the side: sky, distant hills, the ground (with craters and scorch
 * marks), the cannons in their players' colors, each player's last shot as a faint trail,
 * and while it's your turn, your aim. A live shot flies along its path with a trail, the
 * camera widening to keep it in view, and bursts where it lands.
 */
export function Scene(props: {
  view: CannonsView;
  me: string;
  /** Your aim, shown on your cannon, while it's yours to set. */
  aim: Aim | null;
  onAim?(aim: Aim): void;
  replay: Replay | null;
  name(playerId: string): string;
  onImpact(): void;
  onDone(): void;
  children?: ReactNode;
}) {
  const { view, replay, aim } = props;
  const colorOf = usePlayerColors();
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const ball = useRef<SVGCircleElement>(null);
  const trail = useRef<SVGPolylineElement>(null);
  const [landed, setLanded] = useState(false);

  // Screen pixels per meter, so labels and cannons stay readable on a phone.
  const [ppm, setPpm] = useState(1);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setPpm(Math.max(0.2, el.clientWidth / WIDTH));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Drawn a bit larger than life (a ball within HIT_RADIUS of the middle hits), and more so on a small screen.
  const grow = Math.max(1.45, Math.min(2.3, 30 / (22 * ppm)));
  const label = 13 / ppm;

  // Before the ball lands, the ground and cannons are as they were when it was fired.
  const flying = replay && !landed;
  const terrain = flying ? replay.terrain : view.terrain;
  const cannons = flying ? replay.cannons : view.cannons;

  useEffect(() => {
    if (!replay) return;
    setLanded(false);
    const el = svg.current!;
    const shot = replay.shot;
    const impactMs = shot.ticks * TICK_MS;
    const points: string[] = [];
    let cam = { ...HOME };
    let hit = false;
    let raf = 0;
    const start = performance.now();
    play("cannon");
    const frame = (now: number) => {
      const ms = now - start;
      const pos = along({ path: shot.path ?? [], ticks: shot.ticks }, ms);
      let want = HOME;
      if (!pos.done) {
        points.push(`${pos.x.toFixed(1)},${sy(pos.y).toFixed(1)}`);
        ball.current?.setAttribute("cx", pos.x.toFixed(1));
        ball.current?.setAttribute("cy", sy(pos.y).toFixed(1));
        trail.current?.setAttribute("points", points.join(" "));
        want = cover(pos.x, pos.y);
      } else if (!hit) {
        hit = true;
        ball.current?.setAttribute("cx", "-9999");
        if (shot.end !== "off") play(shot.hit ? "hit" : "boom");
        setLanded(true);
        props.onImpact();
      }
      // Follow the ball, easing in and out; back home once it's landed.
      const k = pos.done ? 0.08 : 0.15;
      cam = { x: cam.x + (want.x - cam.x) * k, y: cam.y + (want.y - cam.y) * k, w: cam.w + (want.w - cam.w) * k, h: cam.h + (want.h - cam.h) * k };
      el.setAttribute("viewBox", viewBox(cam));
      if (ms > impactMs + AFTER_MS) {
        el.setAttribute("viewBox", viewBox(HOME));
        props.onDone();
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      el.setAttribute("viewBox", viewBox(HOME));
    };
    // One run per shot.
  }, [replay?.shot.n, view.game]);

  // Dragging from your cannon sets the angle (the direction) and the power (how far).
  const mine = view.cannons.find((c) => c.playerId === props.me && c.alive);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const aimAt = (e: PointerEvent<SVGSVGElement>) => {
    if (!mine || !props.onAim) return;
    const pt = toWorld(svg.current!, e.clientX, e.clientY);
    if (!pt) return;
    const pivot = { x: mine.x, y: mine.y + PIVOT * grow };
    const dx = pt.x - pivot.x;
    const dy = pt.y - pivot.y;
    const angle = dy <= 0 ? (dx >= 0 ? 0 : 180) : Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
    const power = Math.round(Math.hypot(dx, dy) / DRAG_SCALE);
    props.onAim({ angle: Math.max(0, Math.min(180, angle)), power: Math.max(MIN_POWER, Math.min(MAX_POWER, power)) });
  };
  const aiming = !!(aim && mine && props.onAim);

  const ground = useMemo(() => groundPath(terrain), [terrain]);
  const far = useMemo(() => farHills(view.terrain, view.game), [view.game]);
  const craters = view.shots.filter((s) => s.end !== "off" && (!flying || s.n !== replay?.shot.n));
  const traces = view.shots.filter((s) => s.path && s.n !== (replay?.shot.n ?? -1));
  const stars = useMemo(() => starsFor(view.game), [view.game]);
  const drift = view.wind === 0 || reducedMotion() ? undefined : { animationDuration: `${Math.round(240 / Math.abs(view.wind))}s`, animationDirection: view.wind > 0 ? "normal" : "reverse" };

  return (
    <div ref={wrap} className={`cn-scene ${aiming ? "aiming" : ""}`} data-testid="cannons-scene">
      <svg
        ref={svg}
        className="cn-svg"
        viewBox={viewBox(HOME)}
        preserveAspectRatio="xMidYMax meet"
        role="img"
        aria-label={sceneLabel(view, props.me)}
        onPointerDown={(e) => {
          if (!aiming) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, moved: false };
          if (e.pointerType === "mouse") aimAt(e);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
          d.moved = true;
          aimAt(e);
        }}
        onPointerUp={(e) => {
          if (drag.current && e.pointerType !== "mouse" && !drag.current.moved) aimAt(e);
          drag.current = null;
        }}
        onPointerCancel={() => (drag.current = null)}
      >
        <defs>
          <linearGradient id="cn-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: "var(--cannons-sky-top)" }} />
            <stop offset="1" style={{ stopColor: "var(--cannons-sky-bottom)" }} />
          </linearGradient>
          <linearGradient id="cn-earth" gradientUnits="userSpaceOnUse" x1="0" y1={sy(320)} x2="0" y2={sy(0)}>
            <stop offset="0" style={{ stopColor: "var(--cannons-earth)" }} />
            <stop offset="1" style={{ stopColor: "var(--cannons-earth-2)" }} />
          </linearGradient>
          <pattern id="cn-grain" width="46" height="34" patternUnits="userSpaceOnUse">
            <circle cx="8" cy="9" r="1.6" />
            <circle cx="30" cy="5" r="1.1" />
            <circle cx="22" cy="24" r="2" />
            <circle cx="40" cy="28" r="1.3" />
          </pattern>
          <clipPath id="cn-ground-clip">
            <path d={ground.fill} />
          </clipPath>
        </defs>

        <rect x={-WIDTH * 2} y={-HEIGHT * 4} width={WIDTH * 5} height={HEIGHT * 6} fill="url(#cn-sky)" />
        <g className="cn-stars" aria-hidden>
          {stars.map(([x, y, r], i) => (
            <circle key={i} cx={x} cy={sy(y)} r={r} />
          ))}
        </g>
        <circle className="cn-sun" cx={WIDTH * 0.82} cy={sy(HEIGHT * 0.84)} r={26} />
        <g className="cn-clouds" style={drift} aria-hidden>
          {[-WIDTH, 0, WIDTH].map((dx) => (
            <g key={dx} transform={`translate(${dx} 0)`}>
              <Cloud x={130} y={430} s={1} />
              <Cloud x={420} y={470} s={0.75} />
              <Cloud x={640} y={400} s={0.9} />
            </g>
          ))}
        </g>
        <path className="cn-far" d={far} />

        {traces.map((s) => (
          <g key={`t${s.n}`} className={`cn-trace ${s.by === props.me ? "mine" : ""}`} style={playerStyle(colorOf(s.by))} data-testid="cannons-trace">
            <polyline points={pathPoints(s.path!)} />
            {s.end !== "off" && <circle cx={s.x} cy={sy(s.y)} r={4.5} />}
          </g>
        ))}

        <path className="cn-ground" d={ground.fill} fill="url(#cn-earth)" />
        <g clipPath="url(#cn-ground-clip)">
          {craters.map((s) => (
            <ellipse key={`c${s.n}`} className="cn-scorch" cx={s.x} cy={sy(s.y) + 4} rx={20} ry={11} />
          ))}
        </g>
        <path className="cn-ground-grain" d={ground.fill} fill="url(#cn-grain)" />
        <path className="cn-grass" d={ground.top} />
        <path className="cn-grass-tip" d={ground.top} transform="translate(0 -1.6)" />

        {cannons.map((c) => (
          <CannonShape
            key={c.playerId}
            cannon={c}
            terrain={terrain}
            color={colorOf(c.playerId)}
            angle={replay && replay.shot.by === c.playerId ? replay.shot.angle : c.playerId === props.me && aim ? aim.angle : c.angle}
            grow={grow}
            label={label}
            name={c.playerId === props.me ? "You" : props.name(c.playerId)}
            turn={view.phase === "aiming" && view.turn === c.playerId}
          />
        ))}
        {aiming && mine && <AimGuide cannon={mine} aim={aim!} grow={grow} label={label} />}

        {replay && (
          <g className="cn-shot" style={playerStyle(colorOf(replay.shot.by))}>
            <polyline ref={trail} className="cn-trail" points="" />
            <circle ref={ball} className="cn-ball" cx={-9999} cy={0} r={Math.max(4, 3.5 / ppm)} />
            {landed && replay.shot.end !== "off" && (
              <g className={`cn-boom ${replay.shot.hit ? "big" : ""}`} transform={`translate(${replay.shot.x} ${sy(replay.shot.y)})`}>
                <circle className="cn-boom-flash" r={replay.shot.hit ? 30 : 20} />
                <circle className="cn-boom-ring" r={replay.shot.hit ? 26 : 18} />
                {[-1, 0, 1].map((i) => (
                  <circle key={i} className="cn-boom-smoke" cx={i * 9} cy={-6 - Math.abs(i) * 2} r={8} style={{ animationDelay: `${120 + (i + 1) * 60}ms` }} />
                ))}
              </g>
            )}
          </g>
        )}
      </svg>
      <WindBadge wind={view.wind} max={view.windMax} />
      {replay && landed && replay.shot.end === "off" && <div className="cn-off label">{offText(replay.shot)}</div>}
      {props.children}
    </div>
  );
}

/** The camera that keeps (x, y) in view: the field, widened to take in the ball, at the field's shape. */
function cover(x: number, y: number): Box {
  const pad = 50;
  const x0 = Math.min(HOME.x, x - pad);
  const x1 = Math.max(HOME.x + HOME.w, x + pad);
  const y1 = Math.max(HOME.y + HOME.h, y + pad);
  let w = x1 - x0;
  let h = y1 - HOME.y;
  // Keep the shape: grow the other way to match, from the middle across and from the floor up.
  const ratio = HOME.w / HOME.h;
  if (w / h > ratio) h = w / ratio;
  else w = h * ratio;
  const cx = (x0 + x1) / 2;
  return { x: Math.min(x0, Math.max(x1 - w, cx - w / 2)), y: HOME.y, w, h };
}

function toWorld(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } | null {
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  return { x: p.x, y: sy(p.y) };
}

function groundPath(terrain: number[]) {
  const pts = terrain.map((h, i) => `${i * STEP},${sy(h)}`);
  return { fill: `M0,${sy(-HEIGHT)} L${pts.join(" L")} L${WIDTH},${sy(-HEIGHT)} Z`, top: `M${pts.join(" L")}` };
}

/** A softer range of hills far behind, its own shape each game. */
function farHills(terrain: number[], game: number): string {
  const avg = terrain.reduce((a, b) => a + b, 0) / terrain.length;
  const pts: string[] = [];
  for (let x = -WIDTH; x <= WIDTH * 2; x += 20) {
    const h = avg + 60 + 34 * Math.sin(x / 140 + game * 1.7) + 18 * Math.sin(x / 61 + game * 0.9);
    pts.push(`${x},${sy(h).toFixed(1)}`);
  }
  return `M${-WIDTH},${sy(-HEIGHT)} L${pts.join(" L")} L${WIDTH * 2},${sy(-HEIGHT)} Z`;
}

function starsFor(game: number): [number, number, number][] {
  let seed = 7 + game * 13;
  const next = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  return Array.from({ length: 34 }, () => [next() * WIDTH, 260 + next() * 300, 0.8 + next() * 1.4]);
}

const pathPoints = (path: number[]) => {
  const out: string[] = [];
  for (let i = 0; i + 1 < path.length; i += 2) out.push(`${path[i]},${sy(path[i + 1]!)}`);
  return out.join(" ");
};

function Cloud({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g className="cn-cloud" transform={`translate(${x} ${sy(y)}) scale(${s})`}>
      <ellipse cx={0} cy={0} rx={46} ry={14} />
      <ellipse cx={-16} cy={-9} rx={20} ry={14} />
      <ellipse cx={12} cy={-12} rx={24} ry={17} />
    </g>
  );
}

/** A cannon on its wheel, barrel at `angle`, in its player's color; a wreck once it's out. */
function CannonShape(props: { cannon: CannonView; terrain: number[]; color: number; angle: number; grow: number; label: number; name: string | null; turn: boolean }) {
  const { cannon: c, grow } = props;
  const y = props.terrain.length ? groundAtView(props.terrain, c.x) : c.y;
  const tilt = c.alive ? -props.angle : props.angle < 90 ? 12 : 168;
  return (
    <g
      className={`cn-cannon ${c.alive ? "" : "out"} ${props.turn ? "turn" : ""}`}
      style={playerStyle(props.color)}
      transform={`translate(${c.x} ${sy(y)}) scale(${grow})`}
      data-testid={`cannons-cannon-${c.seat}`}
      data-alive={c.alive}
    >
      {props.turn && <ellipse className="cn-turn-glow" cx={0} cy={-6} rx={20} ry={14} />}
      <g transform={`translate(0 ${-PIVOT}) rotate(${tilt})`}>
        <rect className="cn-barrel" x={-3} y={-3.4} width={BARREL + 4} height={6.8} rx={3} />
        <rect className="cn-muzzle" x={BARREL - 1} y={-4.2} width={3.4} height={8.4} rx={1.4} />
      </g>
      <path className="cn-body" d="M-11,-2.5 C-11,-11 -6,-14 0,-14 C6,-14 11,-11 11,-2.5 Z" />
      <circle className="cn-wheel" cx={0} cy={-5} r={5} />
      <circle className="cn-hub" cx={0} cy={-5} r={1.6} />
      {!c.alive && (
        <g className="cn-wisps" aria-hidden>
          <circle cx={-2} cy={-18} r={4} />
          <circle cx={3} cy={-24} r={5} />
        </g>
      )}
      {props.name && (
        <text className="cn-name" x={0} y={-22} style={{ fontSize: props.label / grow }}>
          {props.name}
        </text>
      )}
    </g>
  );
}

function groundAtView(terrain: number[], x: number) {
  const i = Math.min(terrain.length - 2, Math.max(0, Math.floor(x / STEP)));
  const t = (x - i * STEP) / STEP;
  return terrain[i]! + (terrain[i + 1]! - terrain[i]!) * t;
}

/** Your aim: a dotted line out of the barrel, as long as the power, with the numbers at its end. */
function AimGuide({ cannon, aim, grow, label }: { cannon: CannonView; aim: Aim; grow: number; label: number }) {
  const { cos, sin } = dir(aim.angle);
  const px = cannon.x;
  const py = cannon.y + PIVOT * grow;
  const from = (BARREL + 6) * grow;
  const to = from + 20 + aim.power * 1.3;
  const [x0, y0, x1, y1] = [px + cos * from, py + sin * from, px + cos * to, py + sin * to];
  return (
    <g className="cn-aim" aria-hidden>
      <line x1={x0} y1={sy(y0)} x2={x1} y2={sy(y1)} />
      <circle cx={x1} cy={sy(y1)} r={5 * grow} />
      <text x={x1 + (cos >= 0 ? 10 : -10) * grow} y={sy(y1 + 4 * grow)} textAnchor={cos >= 0 ? "start" : "end"} style={{ fontSize: label }}>
        {elevation(aim.angle).up}° · {aim.power}
      </text>
    </g>
  );
}

/** The wind: a flag blowing its way, how hard, and the number. */
function WindBadge({ wind, max }: { wind: number; max: number }) {
  const strength = max ? Math.abs(wind) / max : 0;
  const way = wind > 0 ? "right" : "left";
  return (
    <div className={`cn-wind ${wind === 0 ? "calm" : way}`} data-testid="cannons-wind" aria-label={wind === 0 ? "No wind" : `Wind ${Math.abs(wind)} blowing ${way}`}>
      <svg viewBox="0 0 40 24" className="cn-flag" aria-hidden>
        <line x1={wind < 0 ? 34 : 6} y1={2} x2={wind < 0 ? 34 : 6} y2={23} />
        {wind === 0 ? (
          <path d="M6,3 L9,3 L9,13 L6,13 Z" />
        ) : (
          <path d={wind > 0 ? `M6,3 L${10 + 24 * strength},${6 + 2 * (1 - strength)} L6,${11 + 2 * (1 - strength)} Z` : `M34,3 L${30 - 24 * strength},${6 + 2 * (1 - strength)} L34,${11 + 2 * (1 - strength)} Z`} />
        )}
      </svg>
      <span>{wind === 0 ? "No wind" : `Wind ${Math.abs(wind)} ${wind > 0 ? "→" : "←"}`}</span>
    </div>
  );
}

function offText(shot: ShotView) {
  return shot.x < 0 ? "← Off the edge" : shot.x > WIDTH ? "Off the edge →" : "Gone!";
}

function sceneLabel(view: CannonsView, me: string) {
  const live = view.cannons.filter((c) => c.alive).length;
  return `The field: ${view.cannons.length} cannons, ${live} still standing${view.cannons.some((c) => c.playerId === me && c.alive) ? ", yours among them" : ""}.`;
}
