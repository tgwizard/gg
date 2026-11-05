/**
 * Every Coast to Coast map. A game's config names one (`TtrConfig.map`); a game from
 * before there were several has none, and is on North America.
 */
import type { TtrMap } from "../map";
import { STOCKHOLM } from "./stockholm";
import { USA } from "./usa";

export const MAPS: TtrMap[] = [USA, STOCKHOLM];
export const DEFAULT_MAP = USA.id;
export const MAP_IDS = MAPS.map((m) => m.id) as [string, ...string[]];

export const mapById = (id: string | undefined): TtrMap => MAPS.find((m) => m.id === id) ?? USA;

/** The maps to offer: dev ones only when running locally. */
export const offeredMaps = (dev: boolean) => MAPS.filter((m) => m.status !== "dev" || dev);

export { STOCKHOLM, USA };
