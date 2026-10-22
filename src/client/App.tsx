import { UUID_RE } from "../shared/protocol";
import { HomePage } from "./pages/Home";
import { RoomPage } from "./pages/Room";
import { usePath } from "./router";

export function App() {
  const path = usePath();
  const m = path.match(/^\/r\/([^/]+)\/?$/);
  if (m && UUID_RE.test(m[1]!.toLowerCase())) return <RoomPage key={m[1]} roomId={m[1]!.toLowerCase()} />;
  return <HomePage />;
}
