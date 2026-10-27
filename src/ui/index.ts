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

export { busyWhy, Button } from "./Button";
export { hash2 } from "./hash";
export { Meter } from "./Meter";
export { applyMode, type Mode, MODE_SHORTCUT, toggleMode, useMode } from "./mode";
export { Panel } from "./Panel";
export { ActivityBubble, Avatar, BotIcon, PlayerName, PlayersProvider, playerStyle, useActivity, useIsBot, usePlayerColors } from "./players";
export { play, setSoundOn, SFX, type Sfx, soundOn, useSoundOn } from "./sound";
export { Spinner } from "./Spinner";
export { RACING_MS, URGENT_MS, urgency } from "./urgency";
export { useMedia, useNarrow } from "./useMedia";
