import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./kit.css";

/**
 * Things moving across the table: cards dealt, handed over or drawn, chips into the
 * pot and out to the winner. A flight draws its node over the page, from the middle of
 * one element to the middle of another, and is gone when it lands. Games measure both
 * ends when a change arrives (the new view is on screen, so the destination is there),
 * and hide what's arriving until it lands (`arrivalStyle`).
 *
 * Nothing flies with reduced motion.
 */
export interface Flight {
  id: number;
  node: ReactNode;
  from: DOMRect;
  to: DOMRect;
  /** Seconds before it leaves, so several go one after the other. */
  delay: number;
  /** Seconds in the air. */
  duration?: number;
  /** Size at takeoff and landing. */
  scale?: [number, number];
}

export type FlightPlan = Omit<Flight, "id">;

export const FLIGHT_SECONDS = 0.55;
export const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Where something is on screen, if it's there. */
export function rectOf(selector: string, root: ParentNode = document): DOMRect | null {
  return root.querySelector(selector)?.getBoundingClientRect() ?? null;
}

/** A seat at a `CardTable` (or something in it). */
export const seatRect = (seat: number, inner = ".plate") => rectOf(`[data-seat="${seat}"] ${inner}`) ?? rectOf(`[data-seat="${seat}"]`);

/** Hidden until `at` seconds from now, then there: for something a flight is bringing. */
export const arrivalStyle = (at: number | undefined) => (at === undefined ? undefined : { animation: `flight-arrive 1ms linear ${at}s both` });

export function useFlights() {
  const [flights, setFlights] = useState<Flight[]>([]);
  const next = useRef(0);
  return {
    flights,
    /** Sends them off (unless motion is reduced), and says when the last one lands, in seconds. */
    launch(plans: (FlightPlan | null)[]): number {
      const ok = plans.filter((p): p is FlightPlan => !!p);
      if (!ok.length || reducedMotion()) return 0;
      setFlights((f) => [...f, ...ok.map((p) => ({ ...p, id: next.current++ }))]);
      return Math.max(...ok.map((p) => p.delay + (p.duration ?? FLIGHT_SECONDS)));
    },
    land: (id: number) => setFlights((f) => f.filter((x) => x.id !== id)),
  };
}

export function Flights({ flights, onLand }: { flights: Flight[]; onLand(id: number): void }) {
  if (!flights.length) return null;
  return createPortal(
    <div className="flights" aria-hidden>
      {flights.map((f) => (
        <Flying key={f.id} flight={f} onLand={() => onLand(f.id)} />
      ))}
    </div>,
    document.body,
  );
}

function Flying({ flight, onLand }: { flight: Flight; onLand(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const { from, to } = flight;
    const [s0, s1] = flight.scale ?? [1, 1];
    const at = (r: DOMRect, scale: number, turn: number) =>
      `translate(${r.left + r.width / 2}px, ${r.top + r.height / 2}px) translate(-50%, -50%) scale(${scale}) rotate(${turn}deg)`;
    const animation = ref.current!.animate(
      [
        { transform: at(from, s0, 0), opacity: 0 },
        { transform: at(from, s0 * 1.12, -4), opacity: 1, offset: 0.12 },
        { transform: at(to, s1 * 1.04, 5), opacity: 1, offset: 0.88 },
        { transform: at(to, s1, 0), opacity: 0 },
      ],
      { duration: (flight.duration ?? FLIGHT_SECONDS) * 1000, delay: flight.delay * 1000, easing: "cubic-bezier(0.3, 0.7, 0.2, 1)", fill: "both" },
    );
    animation.onfinish = onLand;
    return () => animation.cancel();
    // A flight is set up once; its props never change.
  }, []);
  return (
    <div ref={ref} className="flying">
      {flight.node}
    </div>
  );
}
