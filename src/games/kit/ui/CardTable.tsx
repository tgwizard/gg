import type { ReactNode } from "react";
import { PixelArt } from "../../../ui";
import { drawTable, type Felt, onTable } from "./tableArt";
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
 * The base for card games: a pixel-art table with seats spaced evenly around it, the
 * `rotation` seat at the bottom (that's you), and `center` content on the felt.
 * Seats get a `side-*` class so games can lay them out toward the middle.
 */
export function CardTable({
  seats,
  rotation = 0,
  felt = "emerald",
  center,
  testId,
  className,
}: {
  seats: TableSeat[];
  rotation?: number;
  felt?: Felt;
  center?: ReactNode;
  testId?: string;
  className?: string;
}) {
  const n = seats.length;
  return (
    <div className={`card-table ${className ?? ""}`} data-testid={testId}>
      <div className="table-surface">
        <PixelArt className="table-art" draw={(c, r) => drawTable(c, r, felt)} drawKey={felt} pixel={3} />
        <div className="table-center">{center}</div>
        {seats.map((seat, i) => {
          const theta = Math.PI / 2 + (((i - rotation + n) % n) * 2 * Math.PI) / n;
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
