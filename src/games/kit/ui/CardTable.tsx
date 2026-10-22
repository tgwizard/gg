import type { ReactNode } from "react";
import { onTable } from "./layout";
import "./table.css";

export interface TableSeat {
  key: string | number;
  /** The seat itself (usually a PlayerPlate, maybe with cards). */
  node: ReactNode;
  className?: string;
  testId?: string;
  /** On the felt in front of the seat (a bet). */
  bet?: ReactNode;
  /** Between the seat and its bet (a dealer button). */
  marker?: ReactNode;
}

export type SeatSide = "top" | "bottom" | "left" | "right";

/**
 * The base for card games: a table with seats spaced evenly around it, the
 * seat 0 at the bottom and the rest clockwise from there (the same for everyone, so
 * "top right" means the same seat on every screen), and `center` content on the felt.
 * Seats get a `side-*` class so games can lay them out toward the middle.
 */
export function CardTable({
  seats,
  center,
  testId,
  className,
}: {
  seats: TableSeat[];
  center?: ReactNode;
  testId?: string;
  className?: string;
}) {
  const n = seats.length;
  return (
    <div className={`card-table ${className ?? ""}`} data-testid={testId}>
      <div className="table-surface">
        <TableSurface />
        <div className="table-center">{center}</div>
        {seats.map((seat, i) => {
          const theta = Math.PI / 2 + (i * 2 * Math.PI) / n;
          const at = (k: number) => {
            const p = onTable(theta, k);
            return { left: `${p.x}%`, top: `${p.y}%` };
          };
          const side = sideOf(theta);
          return (
            <div key={seat.key} className="table-spot">
              {seat.bet && (
                <div className="table-bet" style={at(0.66)}>
                  {seat.bet}
                </div>
              )}
              {seat.marker && (
                <div className={`table-marker side-${side}`} style={at(0.8)}>
                  {seat.marker}
                </div>
              )}
              <div className={`table-seat side-${side} ${seat.className ?? ""}`} style={at(1)} data-testid={seat.testId}>
                {seat.node}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function sideOf(theta: number): SeatSide {
  const s = Math.sin(theta);
  if (s > 0.4) return "bottom";
  if (s < -0.4) return "top";
  return Math.cos(theta) < 0 ? "left" : "right";
}

/** The table itself: a wooden rail around the felt. */
export function TableSurface() {
  return (
    <div className="table-wood" aria-hidden>
      <div className="table-felt" />
    </div>
  );
}

/** A pond (Finns i sjön's lake). */
export function PondSurface() {
  return <div className="pond" aria-hidden />;
}
