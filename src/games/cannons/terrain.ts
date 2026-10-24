/**
 * A new field for each game: where the cannons stand, and the hills around them, made
 * from a seed. Three kinds: gentle (low rolling hills), hilly, and mountains (a ridge
 * between each pair of neighbours, so you have to lob over it). Only the server makes
 * fields; the heights are kept in the game's state.
 */
import { seededRandomInt } from "../kit/testing";
import { COLUMNS, MAX_GROUND, STEP, WIDTH, whole } from "./physics";

export const TERRAIN_STYLES = ["gentle", "hilly", "mountains"] as const;
export type TerrainStyle = (typeof TERRAIN_STYLES)[number];

/** Cannons stand at least this far from the edges. */
const EDGE = 40;
/** Half the width of the flat patch a cannon stands on. */
const PAD = 10;

export function makeField(style: TerrainStyle, seed: number, players: number): { terrain: number[]; xs: number[] } {
  const randInt = seededRandomInt(seed);
  const rand = (lo: number, hi: number) => lo + (randInt(1_000_000) / 1_000_000) * (hi - lo);

  // Spread evenly from one side to the other, each nudged a little.
  const margin = 70;
  const spacing = (WIDTH - 2 * margin) / (players - 1);
  const nudge = Math.min(60, spacing * 0.2);
  const xs = Array.from({ length: players }, (_, i) => whole(Math.max(EDGE, Math.min(WIDTH - EDGE, margin + i * spacing + rand(-nudge, nudge)))));

  const waves: { length: number; height: number; phase: number }[] = [];
  const wave = (length: [number, number], height: [number, number]) => waves.push({ length: rand(...length), height: rand(...height), phase: rand(0, 2 * Math.PI) });
  let base: number;
  const ridges: { x: number; height: number; half: number }[] = [];
  if (style === "gentle") {
    base = rand(95, 135);
    wave([500, 900], [18, 32]);
    wave([220, 320], [8, 14]);
  } else if (style === "hilly") {
    base = rand(90, 130);
    wave([350, 600], [45, 70]);
    wave([160, 260], [20, 35]);
    wave([90, 130], [5, 9]);
  } else {
    base = rand(70, 100);
    wave([260, 400], [18, 30]);
    wave([100, 150], [6, 11]);
    // A ridge between each pair of neighbours, off-centre, sometimes with a shoulder.
    for (let i = 0; i + 1 < xs.length; i++) {
      const gap = xs[i + 1]! - xs[i]!;
      ridges.push({ x: xs[i]! + gap * rand(0.4, 0.6), height: rand(170, 250) * Math.min(1, gap / 500), half: gap * rand(0.2, 0.28) });
      if (rand(0, 1) < 0.5) ridges.push({ x: xs[i]! + gap * rand(0.25, 0.75), height: rand(40, 80), half: gap * rand(0.1, 0.15) });
    }
  }

  const terrain = Array.from({ length: COLUMNS }, (_, i) => {
    const x = i * STEP;
    let h = base;
    for (const w of waves) h += w.height * Math.sin((2 * Math.PI * x) / w.length + w.phase);
    for (const r of ridges) {
      const t = Math.max(0, 1 - Math.abs(x - r.x) / r.half);
      // Rounded at the top, steep on the sides.
      h += r.height * t * t * (3 - 2 * t);
    }
    return whole(Math.max(24, Math.min(MAX_GROUND, h)));
  });

  // A flat patch under each cannon.
  for (const x of xs) {
    const level = terrain[Math.round(x / STEP)]!;
    for (let i = Math.ceil((x - PAD) / STEP); i <= Math.floor((x + PAD) / STEP); i++) if (i >= 0 && i < COLUMNS) terrain[i] = level;
  }
  return { terrain, xs };
}
