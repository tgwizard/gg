import type { ReactNode } from "react";
import { navigate } from "../router";

/** A link to /settings, or one of its tabs (leaving the room; your bots come back with you). */
export function SettingsLink({ children, tab }: { children: ReactNode; tab?: "bots" }) {
  const href = tab ? `/settings#${tab}` : "/settings";
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        navigate(href, location.pathname);
      }}
    >
      {children}
    </a>
  );
}
