/**
 * A place in the room's top bar that the running game can put its header in (icon,
 * name, help, settings, End game, whose turn), leaving the page below for the game
 * itself. The bar stays one row: where the header doesn't fit (narrow screens, or a
 * long room name), it stays on the page instead.
 */
import { createContext, type ReactNode, useContext, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMedia } from "../../ui";

const Slot = createContext<HTMLElement | null>(null);

export const TopbarSlotProvider = Slot.Provider;

export function InTopbar({ children }: { children: ReactNode }) {
  const slot = useContext(Slot);
  const narrow = useMedia("(max-width: 860px)");
  // The window width the header last didn't fit at: it stays on the page until the window is wider.
  const [tooTightAt, setTooTightAt] = useState(0);
  const [width, setWidth] = useState(() => window.innerWidth);
  useLayoutEffect(() => {
    const resize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const inBar = !!slot && !narrow && width > tooTightAt;
  useLayoutEffect(() => {
    const bar = slot?.parentElement;
    if (!inBar || !bar) return;
    const check = () => {
      if (bar.scrollWidth > bar.clientWidth + 1) setTooTightAt(window.innerWidth);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(bar);
    observer.observe(slot);
    return () => observer.disconnect();
  }, [inBar, slot]);
  return inBar ? createPortal(children, slot) : children;
}
