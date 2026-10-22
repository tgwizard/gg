/**
 * gg's design system, shared by the platform UI and every game. Import it once (main.tsx
 * does) for fonts and global styles; components are imported from here.
 */
import type { CSSProperties } from "react";
import "@fontsource-variable/nunito";
import "@fontsource-variable/fraunces/full.css";
import "./tokens.css";
import "./base.css";
import "./components.css";
import { applyMode } from "./mode";

applyMode();

export { hash2 } from "./hash";
export { Meter } from "./Meter";
export { applyMode, type Mode, toggleMode, useMode } from "./mode";
export { Panel } from "./Panel";
export { Spinner } from "./Spinner";
export { useMedia, useNarrow } from "./useMedia";

/** A stable hue per player id, for `.name` colors (set as --hue). */
export function hueFor(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export const nameStyle = (id: string) => ({ "--hue": hueFor(id) }) as CSSProperties;
