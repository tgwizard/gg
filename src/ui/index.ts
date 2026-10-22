/**
 * gg's design system, shared by the platform UI and every game. Import it once (main.tsx
 * does) for fonts and global styles; components are imported from here.
 */
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
export { Avatar, PlayerColorsProvider, PlayerName, playerStyle, usePlayerColors } from "./players";
export { Spinner } from "./Spinner";
export { useMedia, useNarrow } from "./useMedia";
