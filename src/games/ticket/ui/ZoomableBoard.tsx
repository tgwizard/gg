import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "../../../ui";

const MIN = 1;
/** As close as it goes: much more and a phone draws a huge, heavy map. */
const MAX = 3;
/** Each press of + or −. */
const STEP = 1.5;

const clamp = (z: number) => Math.min(MAX, Math.max(MIN, z));

/**
 * The map, zoomable: pinch with two fingers (one still scrolls), + and −, or a trackpad
 * pinch (ctrl + wheel). Zoom 1 is the whole map; the board keeps the map's shape and size at
 * any zoom, and a zoomed map moves inside it. The map is drawn
 * at its zoomed size (SVG, so it stays sharp); during a pinch it's only scaled, and drawn
 * again when the fingers lift, as redrawing its shading every frame would stutter. A point
 * under your fingers (or the pointer) stays there as it zooms.
 */
export function ZoomableBoard({ aspect, children }: { /** The map's width / height. */ aspect: number; children: ReactNode }) {
  const view = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const zoomNow = useRef(1);
  zoomNow.current = zoom;
  /** Where the point being zoomed about is (as a fraction of the map) and where on screen it should end up. */
  const anchor = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);

  const zoomTo = (z: number, cx: number, cy: number) => {
    const r = inner.current!.getBoundingClientRect();
    anchor.current = { x: (cx - r.left) / r.width, y: (cy - r.top) / r.height, cx, cy };
    setZoom(clamp(z));
  };
  const zoomRef = useRef(zoomTo);
  zoomRef.current = zoomTo;

  // After a zoom: scroll the board so the anchor point is back where it was on screen (as near as its edges allow).
  useLayoutEffect(() => {
    const a = anchor.current;
    anchor.current = null;
    if (!a) return;
    const v = view.current!;
    const r = inner.current!.getBoundingClientRect();
    v.scrollLeft += r.left + a.x * r.width - a.cx;
    v.scrollTop += r.top + a.y * r.height - a.cy;
  }, [zoom]);

  // Pinching (two fingers) and trackpad pinches; listeners of our own, as they have to be able to stop the browser's.
  useEffect(() => {
    const v = view.current!;
    const el = inner.current!;
    let pinch: { d0: number; z0: number; mx: number; my: number; x: number; y: number; z: number; cx: number; cy: number } | null = null;
    const two = (e: TouchEvent) => {
      const [a, b] = [e.touches[0]!, e.touches[1]!];
      return { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), mx: (a.clientX + b.clientX) / 2, my: (a.clientY + b.clientY) / 2 };
    };
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      const { d, mx, my } = two(e);
      const r = el.getBoundingClientRect();
      const x = (mx - r.left) / r.width;
      const y = (my - r.top) / r.height;
      pinch = { d0: d, z0: zoomNow.current, mx, my, x, y, z: zoomNow.current, cx: mx, cy: my };
      el.style.transformOrigin = `${x * 100}% ${y * 100}%`;
      el.style.willChange = "transform";
    };
    const move = (e: TouchEvent) => {
      if (!pinch || e.touches.length < 2) return;
      e.preventDefault();
      const { d, mx, my } = two(e);
      pinch.z = clamp(pinch.z0 * (d / pinch.d0));
      pinch.cx = mx;
      pinch.cy = my;
      el.style.transform = `translate(${mx - pinch.mx}px, ${my - pinch.my}px) scale(${pinch.z / pinch.z0})`;
    };
    const end = (e: TouchEvent) => {
      if (!pinch || e.touches.length >= 2) return;
      const p = pinch;
      pinch = null;
      el.style.transform = "";
      el.style.transformOrigin = "";
      el.style.willChange = "";
      if (Math.abs(p.z - p.z0) < 0.01) return;
      // Where the pinch left the point it started on, drawn at the new size.
      anchor.current = { x: p.x, y: p.y, cx: p.cx, cy: p.cy };
      setZoom(p.z);
    };
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      // A trackpad pinch sends many small steps; a mouse wheel few big ones, kept to about a step of + or −.
      const dy = Math.max(-40, Math.min(40, e.deltaY));
      zoomRef.current(zoomNow.current * Math.exp(-dy * 0.01), e.clientX, e.clientY);
    };
    v.addEventListener("touchstart", start, { passive: true });
    v.addEventListener("touchmove", move, { passive: false });
    v.addEventListener("touchend", end);
    v.addEventListener("touchcancel", end);
    v.addEventListener("wheel", wheel, { passive: false });
    return () => {
      v.removeEventListener("touchstart", start);
      v.removeEventListener("touchmove", move);
      v.removeEventListener("touchend", end);
      v.removeEventListener("touchcancel", end);
      v.removeEventListener("wheel", wheel);
    };
  }, []);

  /** + and − zoom about the middle of what's showing. */
  const step = (by: number) => {
    const r = view.current!.getBoundingClientRect();
    const seen = window.visualViewport;
    const top = Math.max(r.top, 0);
    const bottom = Math.min(r.bottom, seen?.height ?? window.innerHeight);
    zoomTo(zoom * by, r.left + r.width / 2, (top + bottom) / 2);
  };

  return (
    <div className="ttr-zoom-frame" style={{ "--map-aspect": aspect } as CSSProperties}>
      <div ref={view} className={`ttr-zoom${zoom > MIN + 0.01 ? " zoomed" : ""}`} data-testid="ttr-zoom">
        <div ref={inner} className="ttr-zoom-inner" style={{ width: `${zoom * 100}%` }}>
          {children}
        </div>
      </div>
      <div className="ttr-zoom-buttons">
        <Button className="ttr-zoom-btn" why={zoom >= MAX - 0.01 ? "That's as close as it goes." : null} onClick={() => step(STEP)} aria-label="Zoom in" data-testid="ttr-zoom-in">
          +
        </Button>
        <Button className="ttr-zoom-btn" why={zoom <= MIN + 0.01 ? "That's the whole map." : null} onClick={() => step(1 / STEP)} aria-label="Zoom out" data-testid="ttr-zoom-out">
          −
        </Button>
      </div>
    </div>
  );
}
