import { type PointerEvent as ReactPointerEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * A small dialog under `anchor`, right-aligned with it (or left-aligned, kept on
 * screen), moved up if it would run off the bottom of the window, and scrolling inside
 * if it's taller than the window. "The window" is what you can actually see: on a phone
 * that's less than `100vh` (the browser's bars, the on-screen keyboard). It follows its
 * anchor as the page (or anything around it) scrolls, and closes once the anchor is
 * scrolled out of sight, unless you're typing in it (a phone's keyboard scrolls the page).
 * Clicking elsewhere closes it. With `stayBelow` it never moves up over its anchor (a
 * tall one scrolls inside instead), so the anchor stays in sight and closes it again;
 * unless there's barely any room below, when it's placed as usual.
 */
export function Popover({
  anchor,
  label,
  onClose,
  align = "right",
  className = "",
  hover,
  stayBelow,
  children,
}: {
  anchor: HTMLElement;
  label: string;
  onClose(): void;
  align?: "left" | "right";
  className?: string;
  /** Hover handlers, for a popover that opens on hover (see `usePeek`). */
  hover?: PeekHover;
  /** Always under the anchor, scrolling inside (header panels: their button stays tappable). */
  stayBelow?: boolean;
  children: ReactNode;
}) {
  const pop = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState(() => {
    const rect = anchor.getBoundingClientRect();
    return { top: rect.bottom + 10, left: Math.max(12, rect.left), maxHeight: window.innerHeight - 24 };
  });
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useLayoutEffect(() => {
    const el = pop.current;
    if (!el) return;
    const update = () => {
      const rect = anchor.getBoundingClientRect();
      const below = rect.bottom + 10;
      const seen = window.visualViewport;
      const height = seen?.height ?? window.innerHeight;
      const offset = seen?.offsetTop ?? 0;
      const typing = el.contains(document.activeElement) && document.activeElement?.matches("input, textarea, select");
      if (!typing && (rect.bottom < offset || rect.top > offset + height)) return closeRef.current();
      // Lined up with the anchor's left or right edge, but never off either side of the window.
      const want = align === "left" ? rect.left : rect.right - el.offsetWidth;
      const left = Math.max(12, Math.min(want, window.innerWidth - el.offsetWidth - 12));
      const room = offset + height - 12 - below;
      if (stayBelow && room >= 200) return setPlace({ top: below, left, maxHeight: room });
      const maxHeight = height - 24;
      const tall = Math.min(el.scrollHeight, maxHeight);
      setPlace({
        top: Math.max(offset + 12, Math.min(below, offset + height - tall - 12)),
        left,
        maxHeight,
      });
    };
    update();
    // Re-placed whenever its content grows or shrinks (e.g. a field appears), and when
    // what's visible changes (a phone's keyboard comes up, the window is resized).
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    // Any scroller, the page included: the anchor moves, and the popover with it.
    document.addEventListener("scroll", update, { capture: true, passive: true });
    return () => {
      observer.disconnect();
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, { capture: true });
    };
  }, [anchor, align, stayBelow]);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !anchor.contains(t)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [anchor, onClose]);
  return createPortal(
    <div
      ref={pop}
      className={`popover box ${className}`}
      role="dialog"
      aria-label={label}
      style={place}
      {...hover}
    >
      {children}
    </div>,
    document.body,
  );
}

type PeekHover = { onPointerEnter(e: ReactPointerEvent): void; onPointerLeave(e: ReactPointerEvent): void };

/**
 * Details behind an icon: a look while the mouse is over it (or the popover), and
 * kept open by a click. Touch has no hover, so there it's just the click.
 */
export function usePeek() {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const hover: PeekHover = {
    onPointerEnter(e) {
      if (e.pointerType !== "mouse") return;
      clearTimeout(timer.current);
      setHovered(true);
    },
    onPointerLeave(e) {
      if (e.pointerType !== "mouse") return;
      clearTimeout(timer.current);
      // Long enough to cross the gap between the icon and its popover.
      timer.current = setTimeout(() => setHovered(false), 250);
    },
  };
  const close = useCallback(() => {
    clearTimeout(timer.current);
    setPinned(false);
    setHovered(false);
  }, []);
  return {
    open: pinned || hovered,
    pinned,
    hover,
    toggle: () => (pinned ? close() : setPinned(true)),
    close,
  };
}
