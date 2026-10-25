import { type CSSProperties, type PointerEvent, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { play, playerStyle, usePlayerColors } from "../../../ui";
import { reducedMotion } from "../../kit/ui/Flights";
import type { CannonsView, CannonView, ShotView } from "../engine";
import { along, BARREL, COLUMNS, dir, elevation, HEIGHT, MAX_POWER, MIN_POWER, PIVOT, SEA_LEVEL, STEP, TICK_MS, WIDTH } from "../physics";

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
/** How long the burst and the camera's way back take after the ball lands (longer for a hit, to let the smoke roll). */
const AFTER_MS = 1100;
const AFTER_HIT_MS = 1700;
/** How long the camera stays on a splash in the sea. */
const SPLASH_LOOK_MS = 900;
/** How long the field shakes when a cannon is hit. */
const SHAKE_MS = 520;

type Box = typeof HOME;
const sy = (y: number) => HEIGHT - y;
const viewBox = (b: Box) => `${b.x} ${sy(b.y + b.h)} ${b.w} ${b.h}`;

/** A ball that came down off the side, into the sea below the cliffs. */
const splashed = (s: ShotView) => s.end === "off" && (s.x < 0 || s.x > WIDTH) && s.y < SEA_LEVEL + 2;

/**
 * The field from the side: sky, hazy mountains and wooded hills far off, the ground in
 * layers (topsoil, clay, rock) ending in cliffs down to the sea at both edges, field guns
 * in their players' colors, each player's last shot as a faint trail, and while it's your
 * turn, your aim. A live shot flies along its path with a trail, the camera widening to
 * keep it in view, and bursts where it lands: dirt, a splash, or a fireball on a hit.
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
  const [shaking, setShaking] = useState(false);

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
    let shake: ReturnType<typeof setTimeout> | undefined;
    // Timed from the first frame: its timestamp can be a little before now.
    let start: number | null = null;
    play("cannon");
    const frame = (now: number) => {
      start ??= now;
      const ms = now - start;
      const pos = along({ path: shot.path ?? [], ticks: shot.ticks }, ms);
      let want = HOME;
      // A splash is off the field: stay on it a moment, cliff and all, before coming back.
      const looking = pos.done && splashed(shot) && ms < impactMs + SPLASH_LOOK_MS;
      if (looking) want = cover(shot.x, shot.y + 60, 130);
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
        else if (splashed(shot)) play("splash");
        if (shot.hit && !reducedMotion()) {
          setShaking(true);
          shake = setTimeout(() => setShaking(false), SHAKE_MS);
        }
        setLanded(true);
        props.onImpact();
      }
      // Follow the ball, easing in and out; back home once it's landed.
      const k = pos.done && !looking ? 0.08 : 0.15;
      cam = { x: cam.x + (want.x - cam.x) * k, y: cam.y + (want.y - cam.y) * k, w: cam.w + (want.w - cam.w) * k, h: cam.h + (want.h - cam.h) * k };
      el.setAttribute("viewBox", viewBox(cam));
      if (ms > impactMs + (shot.hit ? AFTER_HIT_MS : AFTER_MS)) {
        el.setAttribute("viewBox", viewBox(HOME));
        props.onDone();
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(shake);
      setShaking(false);
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

  const ground = useMemo(() => groundPath(terrain, view.game), [terrain, view.game]);
  const layers = useMemo(() => ({ clay: layerPath(terrain, 16, 7, view.game), rock: layerPath(terrain, 70, 18, view.game + 2) }), [terrain, view.game]);
  const backdrop = useMemo(() => farLand(view.terrain, view.game), [view.game]);
  const craters = view.shots.filter((s) => s.end !== "off" && (!flying || s.n !== replay?.shot.n));
  const grass = useMemo(() => tufts(terrain, view.game, craters.map((s) => s.x)), [terrain, view.game, craters.length]);
  const traces = view.shots.filter((s) => s.path && s.n !== (replay?.shot.n ?? -1));
  const stars = useMemo(() => starsFor(view.game), [view.game]);
  const drift = view.wind === 0 || reducedMotion() ? undefined : { animationDuration: `${Math.round(240 / Math.abs(view.wind))}s`, animationDirection: view.wind > 0 ? "normal" : "reverse" };
  const burst = replay && landed ? replay.shot : null;

  return (
    <div ref={wrap} className={`cn-scene ${aiming ? "aiming" : ""} ${shaking ? "shake" : ""}`} data-testid="cannons-scene">
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
          <linearGradient id="cn-sea" gradientUnits="userSpaceOnUse" x1="0" y1={sy(SEA_LEVEL)} x2="0" y2={sy(-60)}>
            <stop offset="0" style={{ stopColor: "var(--cannons-sea)" }} />
            <stop offset="1" style={{ stopColor: "var(--cannons-sea-2)" }} />
          </linearGradient>
          <radialGradient id="cn-fireball">
            <stop offset="0" style={{ stopColor: "var(--cannons-fire)" }} />
            <stop offset="0.4" style={{ stopColor: "var(--cannons-fire-2)" }} />
            <stop offset="0.78" style={{ stopColor: "var(--cannons-fire-3)", stopOpacity: 0.9 }} />
            <stop offset="1" style={{ stopColor: "var(--cannons-fire-3)", stopOpacity: 0 }} />
          </radialGradient>
          <pattern id="cn-grain" width="46" height="34" patternUnits="userSpaceOnUse">
            <circle cx="8" cy="9" r="1.6" />
            <circle cx="30" cy="5" r="1.1" />
            <circle cx="22" cy="24" r="2" />
            <circle cx="40" cy="28" r="1.3" />
          </pattern>
          <pattern id="cn-cracks" width="64" height="40" patternUnits="userSpaceOnUse">
            <path d="M2,12 l9,-3 l8,4 l12,-2 M36,30 l10,-4 l7,3 l9,-1 M18,34 l5,-6 M50,8 l4,6" />
          </pattern>
          <radialGradient id="cn-spot">
            <stop offset="0" style={{ stopColor: "var(--gold)", stopOpacity: 0.6 }} />
            <stop offset="0.6" style={{ stopColor: "var(--gold)", stopOpacity: 0.22 }} />
            <stop offset="1" style={{ stopColor: "var(--gold)", stopOpacity: 0 }} />
          </radialGradient>
          <filter id="cn-soft" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3.5" />
          </filter>
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
        <path className="cn-far-2" d={backdrop.mountains} />
        <g className="cn-clouds" style={drift} aria-hidden>
          {[-WIDTH, 0, WIDTH].map((dx) => (
            <g key={dx} transform={`translate(${dx} 0)`}>
              <Cloud x={130} y={430} s={1} />
              <Cloud x={420} y={470} s={0.75} />
              <Cloud x={640} y={400} s={0.9} />
            </g>
          ))}
        </g>
        <path className="cn-far" d={backdrop.hills} />
        <path className="cn-trees" d={backdrop.trees} />

        <rect className="cn-sea" x={-WIDTH * 3} y={sy(SEA_LEVEL)} width={WIDTH * 7} height={HEIGHT * 3} fill="url(#cn-sea)" />
        <g className="cn-waves" aria-hidden>
          <path d={waves()} />
        </g>

        {traces.map((s) => (
          <g key={`t${s.n}`} className={`cn-trace ${s.by === props.me ? "mine" : ""}`} style={playerStyle(colorOf(s.by))} data-testid="cannons-trace">
            <polyline points={pathPoints(s.path!)} />
            {s.end !== "off" && <circle cx={s.x} cy={sy(s.y)} r={4.5} />}
          </g>
        ))}

        <path className="cn-ground" d={ground.fill} fill="url(#cn-earth)" />
        <g clipPath="url(#cn-ground-clip)">
          <path className="cn-clay" d={layers.clay} />
          <path className="cn-rock" d={layers.rock} />
          <path className="cn-rock-cracks" d={layers.rock} fill="url(#cn-cracks)" />
          {craters.map((s) => (
            <ellipse key={`c${s.n}`} className="cn-scorch" cx={s.x} cy={sy(s.y) + 4} rx={20} ry={11} />
          ))}
        </g>
        <path className="cn-ground-grain" d={ground.fill} fill="url(#cn-grain)" />
        <path className="cn-cliff-edge" d={ground.cliffs} />
        <g className="cn-shore" aria-hidden>
          {ground.boulders.map(([x, r], i) => (
            <ellipse key={i} className="cn-boulder" cx={x} cy={sy(SEA_LEVEL) - r * 0.3} rx={r} ry={r * 0.7} />
          ))}
          {ground.feet.map((x, i) => (
            <ellipse key={i} className="cn-foam" cx={x} cy={sy(SEA_LEVEL)} rx={14} ry={2.2} style={{ animationDelay: `${i * 0.9}s` }} />
          ))}
        </g>
        <path className="cn-grass" d={ground.top} />
        <path className="cn-grass-tip" d={ground.top} transform="translate(0 -1.6)" />
        <path className="cn-tufts" d={grass} />

        {cannons.map((c) => (
          <CannonShape
            key={c.playerId}
            cannon={c}
            terrain={terrain}
            color={colorOf(c.playerId)}
            angle={replay && replay.shot.by === c.playerId ? replay.shot.angle : c.playerId === props.me && aim ? aim.angle : c.angle}
            firing={replay && replay.shot.by === c.playerId ? replay.shot.n : null}
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
            {burst && <Burst shot={burst} />}
          </g>
        )}
      </svg>
      {burst?.hit && <div className="cn-flashbang" aria-hidden />}
      <WindBadge wind={view.wind} max={view.windMax} />
      {burst && burst.end === "off" && <div className="cn-off label">{offText(burst)}</div>}
      {props.children}
    </div>
  );
}

/** The camera that keeps (x, y) in view: the field, widened to take in the ball, at the field's shape. */
function cover(x: number, y: number, pad = 50): Box {
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

/** A little random generator for scenery, the same every time for the same seed. */
function scenery(seed: number) {
  let s = (Math.abs(Math.round(seed)) % 233280) + 1;
  return () => (s = (s * 9301 + 49297) % 233280) / 233280;
}

/**
 * The ground's outline: the field's heights, and at each edge a steep, rough cliff down
 * into the sea, bulging out into a rocky foot at the waterline.
 */
function groundPath(terrain: number[], game: number) {
  const top = terrain.map((h, i) => `${i * STEP},${sy(h)}`);
  const left = cliff(terrain[0]!, -1, game * 31 + 1);
  const right = cliff(terrain.at(-1)!, 1, game * 31 + 2);
  const pt = ([x, y]: [number, number]) => `${x.toFixed(1)},${sy(y).toFixed(1)}`;
  const leftUp = [...left.points].reverse().map(pt);
  return {
    fill: `M${leftUp.join(" L")} L${top.join(" L")} L${right.points.map(pt).join(" L")} Z`,
    top: `M${top.join(" L")}`,
    cliffs: `M${left.points.slice(0, -1).map(pt).join(" L")} M${right.points.slice(0, -1).map(pt).join(" L")}`,
    boulders: [...left.boulders, ...right.boulders],
    feet: [left.foot, right.foot],
  };
}

function cliff(h: number, side: -1 | 1, seed: number) {
  const rnd = scenery(seed);
  const edge = side < 0 ? 0 : WIDTH;
  const points: [number, number][] = [[edge, h]];
  const steps = Math.max(4, Math.round((h - SEA_LEVEL) / 9));
  for (let k = 1; k <= steps; k++) {
    const t = k / steps;
    const out = 0.6 + rnd() * 3.2 + t ** 3 * 7;
    points.push([edge + side * out, h - (h - SEA_LEVEL) * t + (k < steps ? (rnd() - 0.5) * 3 : 0)]);
  }
  const foot = edge + side * (13 + rnd() * 5);
  points.push([foot, SEA_LEVEL - 10], [edge + side * 20, -HEIGHT]);
  const boulders: [number, number][] = [
    [edge + side * (9 + rnd() * 3), 3 + rnd() * 2],
    [edge + side * (15 + rnd() * 6), 2 + rnd() * 2],
  ];
  return { points, boulders, foot: foot + side * 4 };
}

/** A band under the surface (clay, then rock), following the ground, slowly waving; the cliffs show it. */
function layerPath(terrain: number[], depth: number, wave: number, seed: number): string {
  const at = (x: number) => terrain[Math.max(0, Math.min(COLUMNS - 1, Math.round(x / STEP)))]!;
  const pts: string[] = [];
  for (let x = -60; x <= WIDTH + 60; x += 8) {
    // Smoothed a little, so a crater doesn't punch straight through it.
    const h = (at(x - 12) + at(x) * 2 + at(x + 12)) / 4;
    pts.push(`${x},${sy(h - depth - wave * (0.5 + 0.5 * Math.sin(x / 47 + seed * 1.3))).toFixed(1)}`);
  }
  return `M-60,${sy(-HEIGHT)} L${pts.join(" L")} L${WIDTH + 60},${sy(-HEIGHT)} Z`;
}

/** Tufts of grass along the top, where it isn't too steep or freshly blasted. */
function tufts(terrain: number[], game: number, blasts: number[]): string {
  const rnd = scenery(game * 17 + 5);
  const out: string[] = [];
  for (let i = 1; i < COLUMNS - 1; i += 2) {
    const keep = rnd() < 0.55;
    const jitter = (rnd() - 0.5) * STEP;
    const tall = 2.4 + rnd() * 2.6;
    if (!keep) continue;
    if (Math.abs(terrain[i + 1]! - terrain[i - 1]!) / (2 * STEP) > 1.1) continue;
    const x = i * STEP + jitter;
    if (blasts.some((b) => Math.abs(b - x) < 22)) continue;
    const y = sy(terrain[i]!) + 0.6;
    out.push(`M${(x - 1.6).toFixed(1)},${y.toFixed(1)} l-1,${(-tall * 0.75).toFixed(1)} M${x.toFixed(1)},${y.toFixed(1)} l0.3,${(-tall).toFixed(1)} M${(x + 1.6).toFixed(1)},${y.toFixed(1)} l1.1,${(-tall * 0.7).toFixed(1)}`);
  }
  return out.join(" ");
}

/**
 * What's far off, its own shape each game: hazy mountains, nearer wooded hills with pines
 * along the top, both sloping down to the sea past the edges.
 */
function farLand(terrain: number[], game: number) {
  const avg = terrain.reduce((a, b) => a + b, 0) / terrain.length;
  const coast = (x: number) => {
    const t = (u: number) => Math.max(0, Math.min(1, u));
    const s = (u: number) => u * u * (3 - 2 * u);
    return s(t((x + 70) / 170)) * s(t((WIDTH + 70 - x) / 170));
  };
  const range = (lift: number, wave: (x: number) => number) => {
    const pts: string[] = [];
    for (let x = -WIDTH; x <= WIDTH * 2; x += 10) pts.push(`${x},${sy(SEA_LEVEL - 4 + (lift + wave(x)) * coast(x)).toFixed(1)}`);
    return `M${-WIDTH},${sy(-HEIGHT)} L${pts.join(" L")} L${WIDTH * 2},${sy(-HEIGHT)} Z`;
  };
  const hill = (x: number) => 34 * Math.sin(x / 140 + game * 1.7) + 18 * Math.sin(x / 61 + game * 0.9);
  const hills = range(avg + 50, hill);
  const mountains = range(avg + 150, (x) => 60 * Math.sin(x / 210 + game * 0.7) + 28 * Math.abs(Math.sin(x / 83 + game * 2.1)) - 14);
  const rnd = scenery(game * 7 + 3);
  const trees: string[] = [];
  for (let x = -40; x <= WIDTH + 40; x += 7) {
    const c = coast(x);
    const r = rnd();
    if (c < 0.6 || r < 0.45) continue;
    const base = sy(SEA_LEVEL - 4 + (avg + 50 + hill(x)) * c) + 3;
    const h = 9 + rnd() * 9;
    const w = h * 0.32;
    trees.push(`M${(x - w).toFixed(1)},${base.toFixed(1)} L${x.toFixed(1)},${(base - h).toFixed(1)} L${(x + w).toFixed(1)},${base.toFixed(1)} Z`);
  }
  return { hills, mountains, trees: trees.join(" ") };
}

/** The sea's surface: a gentle chop, drawn wide so it can slide along. */
function waves(): string {
  const y = sy(SEA_LEVEL);
  const out: string[] = [];
  for (let x = -WIDTH * 3; x < WIDTH * 4; x += 24) out.push(`M${x},${y + 2} q6,-3 12,0 t12,0`);
  return out.join(" ");
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
      <ellipse className="cn-cloud-shade" cx={2} cy={4} rx={50} ry={9} />
      <ellipse cx={0} cy={0} rx={48} ry={11} />
      <ellipse cx={-22} cy={-6} rx={18} ry={12} />
      <ellipse cx={-4} cy={-13} rx={20} ry={16} />
      <ellipse cx={18} cy={-8} rx={17} ry={12} />
      <ellipse className="cn-cloud-light" cx={-7} cy={-18} rx={11} ry={6} />
    </g>
  );
}

/**
 * A field gun (something like a 1940s howitzer): split trail legs dug in behind and a
 * carriage on a rubber-tyred wheel, painted in its player's color, and a long steel
 * barrel with a recoil cylinder and a muzzle brake. It faces the way it aims. On firing the
 * barrel kicks back with a flash; once hit it's a burning, smoking wreck.
 */
function CannonShape(props: { cannon: CannonView; terrain: number[]; color: number; angle: number; firing: number | null; grow: number; label: number; name: string | null; turn: boolean }) {
  const { cannon: c, grow } = props;
  const y = props.terrain.length ? groundAtView(props.terrain, c.x) : c.y;
  const facing = props.angle <= 90 ? 1 : -1;
  const up = facing > 0 ? props.angle : 180 - props.angle;
  const burning = !c.alive && c.out === "hit";
  const elev = c.alive ? up : burning ? -9 : 4;
  // The trail's spade rests on the ground behind, uphill or down.
  const behind = props.terrain.length ? groundAtView(props.terrain, Math.max(0, Math.min(WIDTH, c.x - facing * 18 * grow))) : y;
  const drop = Math.max(-7, Math.min(7, (y - behind) / grow));
  const style = { ...playerStyle(props.color), "--grow": grow } as CSSProperties;
  return (
    <g
      className={`cn-cannon ${c.alive ? "" : "out"} ${burning ? "burning" : ""} ${props.turn ? "turn" : ""}`}
      style={style}
      transform={`translate(${c.x} ${sy(y)}) scale(${grow})`}
      data-testid={`cannons-cannon-${c.seat}`}
      data-alive={c.alive}
    >
      {/* Whose turn: a pool of light on the ground, and a ring round the gun's feet. */}
      {props.turn && (
        <g className="cn-turn" aria-hidden>
          <ellipse className="cn-turn-pool" cx={-4} cy={0} rx={26} ry={6.5} fill="url(#cn-spot)" />
          <ellipse className="cn-turn-ring" cx={-4} cy={0} rx={19} ry={3.8} />
        </g>
      )}
      <g transform={`scale(${facing} 1)${burning ? " rotate(7)" : ""}`}>
        <path className="cn-leg back" d={`M0,-6.5 L-15,${drop * 0.83 - 0.8} L-16,${drop * 0.83 + 0.8} L-13.2,${drop * 0.83 + 0.8} L0.5,-4.4 Z`} />
        <path className="cn-leg" d={`M1.5,-8.2 L-17.6,${drop - 1.2} L-19.4,${drop + 1} L-15.8,${drop + 1} L-15.9,${drop} L1.5,-5.2 Z`} />
        <path className="cn-carriage" d="M-4.2,-11.6 L4.6,-11.6 L5.4,-7.4 L1,-4.4 L-4.8,-7.4 Z" />
        <circle className="cn-rivet" cx={0} cy={-9} r={0.6} />
        <circle className="cn-tire" cx={0.6} cy={-5.1} r={5.1} />
        <circle className="cn-rim" cx={0.6} cy={-5.1} r={3.1} />
        <circle className="cn-hub" cx={0.6} cy={-5.1} r={1.1} />
        <g transform={`translate(0 ${-PIVOT}) rotate(${-elev})`}>
          <g key={props.firing ?? "idle"} className={props.firing ? "cn-recoil" : undefined}>
            <rect className="cn-cradle" x={-6.5} y={1} width={12} height={2.2} rx={0.8} />
            <path className="cn-barrel" d={`M-7.5,-1.6 L${BARREL - 1.5},-1 L${BARREL - 1.5},1 L-7.5,1.6 Z`} />
            <rect className="cn-breech" x={-9.2} y={-2.1} width={2.4} height={4.2} rx={0.6} />
            <rect className="cn-brake" x={BARREL - 2} y={-1.8} width={3.4} height={3.6} rx={0.6} />
          </g>
          {props.firing && (
            <g key={`f${props.firing}`} className="cn-muzzle" transform={`translate(${BARREL + 1.5} 0)`} aria-hidden>
              <path className="cn-muzzle-fire" d="M0,0 L7,-5 L5,-1 L13,0 L5,1 L7,5 Z" />
              <circle className="cn-muzzle-core" r={3.2} />
              <circle className="cn-muzzle-smoke" cx={6} r={5} />
            </g>
          )}
        </g>
      </g>
      {burning && (
        <g className="cn-fire" aria-hidden>
          <path className="cn-flame" d="M-6,-3 C-8,-9 -4,-11 -3,-17 C0,-12 3,-11 1,-3 Z" />
          <path className="cn-flame f2" d="M0,-4 C-1,-10 3,-13 5,-20 C7,-13 9,-9 6,-4 Z" />
          <path className="cn-flame f3" d="M-3,-3 C-3,-7 -1,-8 0,-11 C2,-8 3,-6 2,-3 Z" />
        </g>
      )}
      {!c.alive && (
        <g className={`cn-wisps ${burning ? "dark" : ""}`} aria-hidden>
          <circle cx={-2} cy={-22} r={4} />
          <circle cx={3} cy={-28} r={5} />
          {burning && <circle cx={-1} cy={-34} r={6} />}
        </g>
      )}
      {props.name && (
        <text className="cn-name" x={0} y={-30} style={{ fontSize: props.label / grow }}>
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

/** Bits thrown out by a blast, the same for the same shot: how far across, how high, where they fall, and their spin. */
function debris(seed: number, count: number, reach: number, lift: number) {
  const rnd = scenery(seed * 101 + 7);
  return Array.from({ length: count }, (_, i) => {
    const side = i % 2 ? 1 : -1;
    return {
      dx: side * reach * (0.25 + rnd() * 0.85),
      up: -lift * (0.45 + rnd() * 0.75),
      down: 8 + rnd() * 18,
      rot: (rnd() - 0.5) * 900,
      size: 1.4 + rnd() * 2.6,
      ms: 700 + rnd() * 380,
      delay: rnd() * 60,
    };
  });
}

function Bits({ seed, count, reach, lift, className, round }: { seed: number; count: number; reach: number; lift: number; className: string; round?: boolean }) {
  return (
    <>
      {debris(seed, count, reach, lift).map((b, i) => (
        <g
          key={i}
          className={`cn-bit ${className}`}
          style={{ "--dx": `${b.dx.toFixed(1)}px`, "--up": `${b.up.toFixed(1)}px`, "--down": `${b.down.toFixed(1)}px`, "--rot": `${Math.round(b.rot)}deg`, "--t": `${Math.round(b.ms)}ms`, animationDelay: `${Math.round(b.delay)}ms` } as CSSProperties}
        >
          {round || i % 3 === 0 ? <circle r={b.size * 0.6} /> : <path d={`M${-b.size},${-b.size * 0.4} L${b.size * 0.7},${-b.size * 0.7} L${b.size},${b.size * 0.5} L${-b.size * 0.4},${b.size * 0.6} Z`} />}
        </g>
      ))}
    </>
  );
}

/** Where the ball came down: a fireball and flying wreckage on a hit, a spray of dirt on the ground, a splash in the sea. */
function Burst({ shot }: { shot: ShotView }) {
  if (shot.end === "off") {
    if (!splashed(shot)) return null;
    return (
      <g className="cn-splash" transform={`translate(${shot.x} ${sy(SEA_LEVEL)})`} aria-hidden>
        <ellipse className="cn-splash-ring" rx={30} ry={4.5} />
        <path className="cn-splash-column" d="M-12,0 C-10,-26 -5,-56 0,-72 C5,-56 10,-26 12,0 Z" />
        <path className="cn-splash-column side" d="M-20,0 C-20,-14 -24,-28 -30,-38 C-17,-28 -12,-14 -8,0 Z M20,0 C20,-14 24,-28 30,-38 C17,-28 12,-14 8,0 Z" />
        <Bits seed={shot.n} count={16} reach={50} lift={80} className="drop" round />
      </g>
    );
  }
  const at = `translate(${shot.x} ${sy(shot.y)})`;
  if (!shot.hit) {
    return (
      <g className="cn-dirt" transform={at} aria-hidden>
        <circle className="cn-dirt-flash" r={13} />
        <path className="cn-dirt-plume" d="M-10,2 C-12,-8 -6,-18 0,-26 C6,-18 12,-8 10,2 Z" />
        {[-1, 0, 1].map((i) => (
          <circle key={i} className="cn-dust" cx={i * 11} cy={-4 - Math.abs(i) * 2} r={9} style={{ animationDelay: `${90 + (i + 1) * 70}ms` }} />
        ))}
        <Bits seed={shot.n} count={11} reach={34} lift={36} className="clod" />
      </g>
    );
  }
  return (
    <g className="cn-blast" transform={at} aria-hidden>
      <circle className="cn-blast-glare" r={130} />
      <g filter="url(#cn-soft)">
        {[-30, -12, 6, 24, -2].map((x, i) => (
          <circle key={i} className="cn-blast-smoke" cx={x} cy={-30 - (i % 2) * 14 - (i === 4 ? 40 : 0)} r={22 + (i % 2) * 7} style={{ animationDelay: `${420 + i * 80}ms` }} />
        ))}
      </g>
      <ellipse className="cn-blast-wave" cy={-2} rx={100} ry={24} />
      <path className="cn-dirt-plume big" d="M-22,4 C-26,-14 -12,-34 0,-50 C12,-34 26,-14 22,4 Z" />
      <circle className="cn-fireball" cy={-18} r={54} fill="url(#cn-fireball)" />
      <circle className="cn-fireball" cx={-28} cy={-8} r={32} fill="url(#cn-fireball)" style={{ animationDelay: "60ms" }} />
      <circle className="cn-fireball" cx={26} cy={-30} r={34} fill="url(#cn-fireball)" style={{ animationDelay: "120ms" }} />
      <circle className="cn-fireball" cx={-6} cy={-58} r={28} fill="url(#cn-fireball)" style={{ animationDelay: "190ms" }} />
      <circle className="cn-fireball" cx={8} cy={-84} r={20} fill="url(#cn-fireball)" style={{ animationDelay: "260ms" }} />
      <Bits seed={shot.n} count={20} reach={100} lift={110} className="shard" />
      <Bits seed={shot.n + 50} count={10} reach={70} lift={80} className="ember" round />
      <Bits seed={shot.n + 90} count={10} reach={60} lift={50} className="clod" />
    </g>
  );
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
  if (splashed(shot)) return shot.x < 0 ? "← Splash! Into the sea" : "Into the sea. Splash! →";
  return shot.x < 0 ? "← Off the edge" : shot.x > WIDTH ? "Off the edge →" : "Gone!";
}

function sceneLabel(view: CannonsView, me: string) {
  const live = view.cannons.filter((c) => c.alive).length;
  return `The field: ${view.cannons.length} cannons, ${live} still standing${view.cannons.some((c) => c.playerId === me && c.alive) ? ", yours among them" : ""}.`;
}
