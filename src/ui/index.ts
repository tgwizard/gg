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
import "./themes.css";
import "@fontsource-variable/fredoka";
import "@fontsource-variable/nunito";
import "@fontsource-variable/inter";
import "@fontsource-variable/cinzel";
import "@fontsource-variable/eb-garamond";
import "@fontsource-variable/orbitron";
import "@fontsource/share-tech-mono";
import { applyTheme } from "./theme";

applyTheme();

export { Meter } from "./Meter";
export { Panel } from "./Panel";
export { PixelArt } from "./PixelArt";
export { PixelIcon } from "./PixelIcon";
export { Spinner } from "./Spinner";
export { useMedia, useNarrow } from "./useMedia";
export { applyTheme, setTheme, THEMES, type ThemeId, useTheme } from "./theme";
export { type IconName, ICONS } from "./icons";
export * from "./pixels";

/** A stable hue per player id, for `.name` colors (set as --hue). */
export function hueFor(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export const nameStyle = (id: string) => ({ "--hue": hueFor(id) }) as CSSProperties;
