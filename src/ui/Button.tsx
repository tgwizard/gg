import { type ComponentProps, type MouseEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * A button that's never disabled. When it can't be used right now, `why` says why: it
 * looks unavailable (greyed, `aria-disabled`), and pressing it pops up the reason in a
 * small bubble over it instead of doing nothing. A greyed button that can't even be
 * pressed leaves people (kids especially) guessing.
 */
export function Button({ why, onClick, className, ref: outer, ...rest }: ComponentProps<"button"> & { why?: string | null }) {
  const ref = useRef<HTMLButtonElement>(null);
  // Ours (for where to show why) and the caller's, if any.
  const refs = (el: HTMLButtonElement | null) => {
    ref.current = el;
    if (typeof outer === "function") outer(el);
    else if (outer) outer.current = el;
  };
  const [said, setSaid] = useState<{ text: string; at: DOMRect } | null>(null);
  const bubble = useRef<HTMLDivElement>(null);
  // Over a button at the edge of the window: slid in to fit, the tail still pointing at it.
  useLayoutEffect(() => {
    const el = bubble.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const shift = Math.max(0, 8 - r.left) - Math.max(0, r.right - (window.innerWidth - 8));
    el.style.setProperty("--shift", `${shift}px`);
  }, [said]);
  useEffect(() => {
    if (!said) return;
    const t = setTimeout(() => setSaid(null), 2800);
    const away = () => setSaid(null);
    window.addEventListener("scroll", away, true);
    window.addEventListener("resize", away);
    return () => {
      clearTimeout(t);
      window.removeEventListener("scroll", away, true);
      window.removeEventListener("resize", away);
    };
  }, [said]);
  // Usable again: no stale reason left hanging over it.
  useEffect(() => {
    if (!why) setSaid(null);
  }, [why]);
  const click = (e: MouseEvent<HTMLButtonElement>) => {
    if (why) {
      e.preventDefault();
      setSaid({ text: why, at: ref.current!.getBoundingClientRect() });
      return;
    }
    onClick?.(e);
  };
  return (
    <>
      <button ref={refs} {...rest} className={`${className ?? ""} ${why ? "unavailable" : ""}`} aria-disabled={why ? true : undefined} onClick={click} />
      {said &&
        createPortal(
          <div ref={bubble} className="why" role="status" style={{ left: said.at.left + said.at.width / 2, top: said.at.top }}>
            {said.text}
          </div>,
          document.body,
        )}
    </>
  );
}

/** The usual reasons a move can't be made this moment, or null. */
export function busyWhy({ busy, connected }: { busy?: boolean; connected?: boolean }): string | null {
  if (connected === false) return "Reconnecting… try again in a moment.";
  if (busy) return "Hang on, your last move is on its way.";
  return null;
}
