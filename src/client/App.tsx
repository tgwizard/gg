import { lazy, Suspense, useEffect } from "react";
import { normalizeRoomCode } from "../shared/roomCode";
import { AboutPage } from "./pages/About";
import { HomePage } from "./pages/Home";
import { RoomPage } from "./pages/Room";
import { SettingsPage } from "./pages/Settings";
import { StyleGuidePage } from "./pages/StyleGuide";
import { usePath } from "./router";

// Brings every game's rules, so it loads on demand.
// Dev builds only: production builds leave the page out entirely.
const TryPage = import.meta.env.DEV ? lazy(() => import("./pages/Try").then((m) => ({ default: m.TryPage }))) : null;

export function App() {
  const path = usePath();
  const raw = path.match(/^\/r\/([^/]+)\/?$/)?.[1];
  const code = raw ? normalizeRoomCode(decodeURIComponent(raw)) : null;
  useEffect(() => {
    // Show the canonical code in the address bar (e.g. after a lower-cased link).
    if (code && raw !== code) history.replaceState(null, "", `/r/${code}`);
  }, [code, raw]);
  if (code) return <RoomPage key={code} roomId={code} />;
  if (path === "/ui") return <StyleGuidePage />;
  if (path === "/settings") return <SettingsPage />;
  if (path === "/about") return <AboutPage />;
  // Practice rooms are for local development only (the server refuses them elsewhere).
  if (TryPage && /^\/try(\/|$)/.test(path)) return <Suspense fallback={null}><TryPage path={path} /></Suspense>;
  return <HomePage />;
}
