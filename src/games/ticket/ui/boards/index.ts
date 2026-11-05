/**
 * How each map is drawn: its printed board (land, water, borders, props) and where
 * city names go. The game's data (cities, routes) is in `../../maps`.
 */
import type { Label } from "../geometry";
import { STOCKHOLM_BOARD } from "./stockholm";
import { USA_BOARD } from "./usa";

type Pt = [number, number];

export interface Board {
  /** The drawn area, in the map's coordinates. */
  viewbox: { x: number; y: number; w: number; h: number };
  /** Where names go, for cities that need it; the rest are placed to keep clear of tracks. */
  labels: Record<string, Label>;
  /** Land, drawn over the sea; `abroad` is drawn paler. */
  land: { d: string; abroad?: boolean }[];
  lakes: { d: string }[];
  borders: string[];
  /** Deeper water away from here. */
  sea: { cx: number; cy: number; r: number };
  /** How strong the hills are across the board, left to right: [offset, opacity]. */
  relief: Pt[];
  mountains: Pt[];
  trees: Pt[];
  cacti: Pt[];
  waves: Pt[];
  compass: { cx: number; cy: number };
  /** Printed small in a corner, for data that asks for it. */
  credit?: string;
}

const BOARDS: Record<string, Board> = { usa: USA_BOARD, stockholm: STOCKHOLM_BOARD };

export const boardFor = (mapId: string): Board => BOARDS[mapId] ?? USA_BOARD;
