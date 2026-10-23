import type { ReactNode } from "react";
import { navigate } from "../router";

/** A link to /settings (leaving the room; your bots come back with you). */
export function SettingsLink({ children }: { children: ReactNode }) {
  return (
    <a
      href="/settings"
      onClick={(e) => {
        e.preventDefault();
        navigate("/settings", location.pathname);
      }}
    >
      {children}
    </a>
  );
}
