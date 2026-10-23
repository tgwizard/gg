import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { CardColor } from "../map";
import { TrainCard } from "./TrainCards";

/** A card on its way from where it was taken (face up, or the deck) to your hand. */
export interface Flight {
  id: number;
  color: CardColor;
  from: DOMRect;
  to: DOMRect;
  /** Seconds to wait, so two cards drawn at once leave one after the other. */
  delay: number;
}

export function Flights({ flights, onDone }: { flights: Flight[]; onDone(id: number): void }) {
  if (!flights.length) return null;
  return createPortal(
    <div className="ttr-flights" aria-hidden>
      {flights.map((f) => (
        <FlyingCard key={f.id} flight={f} onDone={() => onDone(f.id)} />
      ))}
    </div>,
    document.body,
  );
}

function FlyingCard({ flight, onDone }: { flight: Flight; onDone(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const { from, to } = flight;
    const at = (r: DOMRect, scale: number, turn: number) =>
      `translate(${r.left + r.width / 2}px, ${r.top + r.height / 2}px) translate(-50%, -50%) scale(${scale}) rotate(${turn}deg)`;
    const animation = ref.current!.animate(
      [
        { transform: at(from, 1, 0), opacity: 0 },
        { transform: at(from, 1.15, -4), opacity: 1, offset: 0.12 },
        { transform: at(to, 0.95, 6), opacity: 1, offset: 0.88 },
        { transform: at(to, 0.9, 0), opacity: 0 },
      ],
      { duration: 620, delay: flight.delay * 1000, easing: "cubic-bezier(0.3, 0.7, 0.2, 1)", fill: "both" },
    );
    animation.onfinish = onDone;
    return () => animation.cancel();
    // A flight is set up once; its props never change.
  }, []);
  return (
    <div ref={ref} className="ttr-flying">
      <TrainCard color={flight.color} />
    </div>
  );
}
