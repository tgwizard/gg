/**
 * gg's design system, shared by the platform UI and every game. Import it once (main.tsx
 * does) for fonts and global styles; components are imported from here.
 */
import type { CSSProperties } from "react";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource/jacquard-24";
import "@fontsource/jersey-10";
import "@fontsource/silkscreen";
import "./tokens.css";
import "./base.css";
import "./components.css";

export { Meter } from "./Meter";
export { Panel } from "./Panel";
export { PixelArt } from "./PixelArt";
export { PixelIcon } from "./PixelIcon";
export { Spinner } from "./Spinner";
export { useMedia, useNarrow } from "./useMedia";
export { type IconName, ICONS } from "./icons";
export * from "./pixels";

/** A stable hue per player id, for `.name` colors (set as --hue). */
export function hueFor(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export const nameStyle = (id: string) => ({ "--hue": hueFor(id) }) as CSSProperties;
