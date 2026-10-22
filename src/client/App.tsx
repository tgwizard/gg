import { useEffect } from "react";
import { normalizeRoomCode } from "../shared/roomCode";
import { HomePage } from "./pages/Home";
import { RoomPage } from "./pages/Room";
import { usePath } from "./router";

export function App() {
  const path = usePath();
  const raw = path.match(/^\/r\/([^/]+)\/?$/)?.[1];
  const code = raw ? normalizeRoomCode(decodeURIComponent(raw)) : null;
  useEffect(() => {
    // Show the canonical code in the address bar (e.g. after a lower-cased link).
    if (code && raw !== code) history.replaceState(null, "", `/r/${code}`);
  }, [code, raw]);
  if (code) return <RoomPage key={code} roomId={code} />;
  return <HomePage />;
}
