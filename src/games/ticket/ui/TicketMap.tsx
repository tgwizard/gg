import { type CSSProperties, memo, type ReactNode, useId } from "react";
import { playerStyle } from "../../../ui";
import type { Claims } from "../graph";
import type { Route, TtrMap } from "../map";
import { type Board, boardFor } from "./boards";
import { labelsFor, tracksFor } from "./geometry";

const CAR_HEIGHT = 10;

export interface MapProps {
  map: TtrMap;
  claims: Claims;
  bothTracks: boolean;
  /** A route's claimer → their player color index. */
  colorOf(playerId: string): number;
  nameOf(playerId: string): string;
  /** Routes the viewer can claim now (highlighted, clickable). */
  claimable?: ReadonlySet<string>;
  selected?: string | null;
  onSelect?(routeId: string): void;
  /** Cities on the viewer's tickets, and ones to point out (a ticket being looked at). */
  marked?: ReadonlySet<string>;
  focus?: readonly string[];
  /** Routes to point out (the latest claim). */
  recent?: string | null;
  /** A route being laid down, car by car from its first city (just claimed). */
  laying?: string | null;
  /** A player whose railway to point out (their nameplate is hovered). */
  owner?: string | null;
  /** A route is being claimed: everything else steps back. */
  picking?: boolean;
  /** On top of the map (the claim bubble), positioned in percentages of it. */
  children?: ReactNode;
}

/** The board: water, cities, and every route's track, with trains on the claimed ones. */
export const TicketMap = memo(function TicketMap(props: MapProps) {
  const { map } = props;
  const board = boardFor(map.id);
  const { x, y, w, h } = board.viewbox;
  const labels = labelsFor(map, board.labels, board.viewbox);
  const loco = `${useId().replace(/:/g, "")}-loco`;
  // Two layers: the printed board (drawn once, with costly shading) under the live tracks and cities.
  return (
    <div className={`ttr-map${props.picking ? " picking" : ""}`} data-testid="ttr-map">
      <Scenery board={board} />
      <svg
        role="img"
        aria-label="The map of North America"
        className={`ttr-play${props.focus?.length ? " focusing" : ""}${props.owner ? " owner-focus" : ""}`}
        viewBox={`${x} ${y} ${w} ${h}`}
      >
        <defs>
          {/* A ferry's locomotive spaces: the locomotive card's rainbow. */}
          <linearGradient id={loco} x1="0" x2="1" y1="0" y2="0">
            {["red", "orange", "yellow", "green", "blue", "pink"].map((c, i) => (
              <stop key={c} offset={i / 5} className={`ttr-loco-stop c-${c}`} />
            ))}
          </linearGradient>
        </defs>
        <g className="ttr-tracks">
          {map.routes.map((r) => (
            <Track key={r.id} route={r} loco={loco} {...props} />
          ))}
        </g>
        {props.focus?.length === 2 && <TicketLine map={map} board={board} a={props.focus[0]!} b={props.focus[1]!} />}
        <g className="ttr-cities">
          {map.cities.map((c) => {
            const [dx, dy, anchor] = labels[c.id]!;
            const focused = props.focus?.includes(c.id);
            return (
              <g key={c.id} className={`ttr-city${props.marked?.has(c.id) ? " marked" : ""}${focused ? " focus" : ""}`}>
                {focused && <circle className="ttr-city-halo" cx={c.x} cy={c.y} r={17} />}
                <circle className="ttr-city-dot" cx={c.x} cy={c.y} r={7} />
                <circle className="ttr-city-core" cx={c.x} cy={c.y} r={2.6} />
                <text x={c.x + dx} y={c.y + dy} textAnchor={anchor}>
                  {c.name}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      {props.children}
    </div>
  );
});

/** A ticket being looked at: a dotted line arcing from one of its cities to the other. */
function TicketLine({ map, board, a, b }: { map: TtrMap; board: Board; a: string; b: string }) {
  const p = map.cityById.get(a)!;
  const q = map.cityById.get(b)!;
  const len = Math.hypot(q.x - p.x, q.y - p.y);
  const bow = 0.18 * len;
  // Bow it toward the middle of the board, so it never leaves the map.
  const [mx, my] = [(p.x + q.x) / 2, (p.y + q.y) / 2];
  const [nx, ny] = [(q.y - p.y) / len, -(q.x - p.x) / len];
  const { viewbox } = board;
  const middle = { x: viewbox.x + viewbox.w / 2, y: viewbox.y + viewbox.h / 2 };
  const sign = nx * (middle.x - mx) + ny * (middle.y - my) >= 0 ? 1 : -1;
  const [cx, cy] = [mx + sign * nx * bow, my + sign * ny * bow];
  const d = `M${p.x},${p.y} Q${cx},${cy} ${q.x},${q.y}`;
  return (
    <g className="ttr-ticket-line" aria-hidden>
      <path className="under" d={d} />
      <path className="over" d={d} />
    </g>
  );
}

function Track({ map, route, loco, claims, bothTracks, colorOf, nameOf, claimable, selected, onSelect, recent, laying, owner: shown }: MapProps & { route: Route; loco: string }) {
  const shape = tracksFor(map).get(route.id)!;
  const owner = claims[route.id];
  const canClaim = !!claimable?.has(route.id);
  // With 2–3 players, the other track of a claimed double route is out of the game.
  const closed = !owner && !!route.twin && !bothTracks && !!claims[route.twin];
  const classes = [
    "ttr-track",
    owner ? "claimed" : `free c-${route.color}`,
    route.ferry > 0 && "ferry",
    closed && "closed",
    canClaim && "claimable",
    selected === route.id && "selected",
    recent === route.id && "recent",
    owner && laying === route.id && "laying",
    !!shown && owner === shown && "shown",
  ];
  const title = `${map.routeName(route)}: ${route.length} ${route.ferry ? `ferry (${route.ferry} ${route.ferry === 1 ? "locomotive" : "locomotives"})` : route.color}${owner ? `, ${nameOf(owner)}'s` : closed ? " (closed)" : ""}`;
  return (
    <g
      className={classes.filter(Boolean).join(" ")}
      style={owner ? ({ ...playerStyle(colorOf(owner)), "--n": route.length } as CSSProperties) : undefined}
      onClick={canClaim ? () => onSelect?.(route.id) : undefined}
      data-route={route.id}
      data-testid={canClaim ? "ttr-claimable" : undefined}
    >
      <title>{title}</title>
      {canClaim && <path className="ttr-track-hit" d={shape.path} />}
      {owner && <path className="ttr-track-glow" d={shape.path} />}
      {shape.cars.map((car, i) => {
        // A claimed car is a train piece: a little taller than the printed space, with windows.
        const h = owner ? CAR_HEIGHT + 2 : CAR_HEIGHT;
        // A ferry's locomotive spaces are the middle ones.
        const first = Math.floor((route.length - route.ferry) / 2);
        const locoSpace = !owner && i >= first && i < first + route.ferry;
        return (
          <g key={i} transform={`translate(${car.x} ${car.y}) rotate(${car.angle})`}>
            {owner && <ellipse className="ttr-thud" style={{ "--i": i } as CSSProperties} rx={car.length * 0.6} ry={h} />}
            {/* Cars run from the route's first city (route.a), so --i is how far down the chain this one is. */}
            <g className="ttr-link" style={owner ? ({ "--i": i } as CSSProperties) : undefined}>
              <rect className="ttr-car" x={-car.length / 2} y={-h / 2} width={car.length} height={h} rx={2} style={locoSpace ? { fill: `url(#${loco})` } : undefined} />
              {locoSpace && <LocoMark />}
              {owner && <rect className="ttr-car-windows" x={-car.length / 2 + 3} y={-1.75} width={car.length - 6} height={3.5} rx={1} />}
            </g>
          </g>
        );
      })}
    </g>
  );
}

/** A little locomotive on a ferry's locomotive space. */
function LocoMark() {
  return <path className="ttr-loco-mark" d="M-6,2.5 h11 v-3 h-3 v-2.5 h-4 v2.5 h-4 Z M4,-3.5 v-1.5" />;
}

/** The printed board under the tracks: paper, land, water, borders, a compass. Drawn once. */
const Scenery = memo(function Scenery({ board }: { board: Board }) {
  const id = useId().replace(/:/g, "");
  const { x, y, w, h } = board.viewbox;
  return (
    <svg className="ttr-scenery" viewBox={`${x} ${y} ${w} ${h}`} aria-hidden>
      <defs>
        {/* Hills: lit noise, stronger in places (the board's relief). */}
        <filter id={`${id}-relief`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.009" numOctaves="5" seed="3" />
          <feDiffuseLighting surfaceScale="12" lightingColor="#ffffff">
            <feDistantLight azimuth="235" elevation="35" />
          </feDiffuseLighting>
        </filter>
        <linearGradient id={`${id}-ranges`} x1="0" x2="1" y1="0" y2="0">
          {board.relief.map(([offset, opacity]) => (
            <stop key={offset} offset={offset} stopColor="#fff" stopOpacity={opacity} />
          ))}
        </linearGradient>
        <mask id={`${id}-ranges-mask`}>
          <rect x={x} y={y} width={w} height={h} fill={`url(#${id}-ranges)`} />
        </mask>
        {/* Deeper water away from the coasts, and a darker edge around the whole board. */}
        <radialGradient id={`${id}-sea`} gradientUnits="userSpaceOnUse" cx={board.sea.cx} cy={board.sea.cy} r={board.sea.r}>
          <stop offset="0.45" className="ttr-sea-near" />
          <stop offset="0.75" className="ttr-sea-mid" />
          <stop offset="1" className="ttr-sea-far" />
        </radialGradient>
        <radialGradient id={`${id}-vignette`} cx="0.5" cy="0.5" r="0.75">
          <stop offset="0.6" className="ttr-vignette-in" />
          <stop offset="1" className="ttr-vignette-out" />
        </radialGradient>
        <clipPath id={`${id}-board`}>
          <rect x={x} y={y} width={w} height={h} rx={10} />
        </clipPath>
        {/* The land, to keep the hills and the props off the water. */}
        <clipPath id={`${id}-land`}>
          {board.land.map((l, i) => (
            <path key={i} d={l.d} />
          ))}
        </clipPath>
        <filter id={`${id}-paper`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" />
          <feColorMatrix values="0 0 0 0 0.35  0 0 0 0 0.26  0 0 0 0 0.16  0 0 0 0.55 -0.2" />
        </filter>
      </defs>
      <g clipPath={`url(#${id}-board)`}>
        {/* Water everywhere, with lighter bands along the coasts (land drawn over their inner half), as on old maps. */}
        <rect x={x} y={y} width={w} height={h} fill={`url(#${id}-sea)`} />
        {board.land.map((l, i) => (
          <path key={i} className="ttr-shore far" d={l.d} />
        ))}
        {board.land.map((l, i) => (
          <path key={i} className="ttr-shore" d={l.d} />
        ))}
        {board.land.map((l, i) => (
          <path key={i} className={l.abroad ? "ttr-land abroad" : "ttr-land"} d={l.d} />
        ))}
        <g clipPath={`url(#${id}-land)`}>
          <rect x={x} y={y} width={w} height={h} filter={`url(#${id}-relief)`} mask={`url(#${id}-ranges-mask)`} className="ttr-relief" />
          {board.mountains.map(([mx, my], i) => (
            <path
              key={i}
              className="ttr-mountain"
              d={`M${mx - 8},${my + 5} L${mx - 1},${my - 6} L${mx + 3},${my - 1} L${mx + 5},${my - 3} L${mx + 10},${my + 5}`}
            />
          ))}
          {board.trees.map(([tx, ty], i) => (
            <g key={i} className="ttr-tree" transform={`translate(${tx} ${ty})`}>
              <path d="M0,-9 L5,0 L2,0 L6,5 L-6,5 L-2,0 L-5,0 Z" />
              <path className="trunk" d="M0,5 V8" />
            </g>
          ))}
          {board.cacti.map(([cx, cy], i) => (
            <path key={i} className="ttr-cactus" d={`M${cx},${cy + 7} V${cy - 7} M${cx},${cy + 1} h-4 v-5 M${cx},${cy - 1} h4 v-4`} />
          ))}
        </g>
        {board.borders.map((d, i) => (
          <path key={i} className="ttr-border" d={d} />
        ))}
        {board.lakes.map((l, i) => (
          <path key={i} className="ttr-lake" d={l.d} fill={`url(#${id}-sea)`} fillRule="evenodd" />
        ))}
        {board.land.map((l, i) => (
          <path key={i} className="ttr-coast" d={l.d} />
        ))}
        {board.lakes.map((l, i) => (
          <path key={i} className="ttr-coast" d={l.d} />
        ))}
        {board.waves.map(([wx, wy], i) => (
          <path key={i} className="ttr-wave" d={`M${wx - 9},${wy} q4.5,-4 9,0 t9,0`} />
        ))}
        <Compass cx={board.compass.cx} cy={board.compass.cy} />
        <rect x={x} y={y} width={w} height={h} fill={`url(#${id}-vignette)`} className="ttr-vignette" />
        <rect x={x} y={y} width={w} height={h} filter={`url(#${id}-paper)`} className="ttr-paper" />
        <rect className="ttr-rule" x={x + 5} y={y + 5} width={w - 10} height={h - 10} rx={6} />
        {board.credit && (
          <text className="ttr-credit" x={x + w - 12} y={y + h - 11} textAnchor="end">
            {board.credit}
          </text>
        )}
      </g>
    </svg>
  );
});

function Compass({ cx, cy }: { cx: number; cy: number }) {
  const star = (r: number, k: number) =>
    Array.from({ length: 8 }, (_, i) => {
      const a = (i * Math.PI) / 4 - Math.PI / 2;
      const len = i % 2 === 0 ? r : k;
      return `${cx + Math.cos(a) * len},${cy + Math.sin(a) * len}`;
    }).join(" ");
  return (
    <g className="ttr-compass">
      <circle cx={cx} cy={cy} r={21} />
      <circle cx={cx} cy={cy} r={17} />
      <polygon points={star(26, 5)} />
      <text x={cx} y={cy - 29}>
        N
      </text>
    </g>
  );
}
