import { PixelIcon } from "../../../ui";
import "./kit.css";

/** A chip amount: a coin and a number. */
export function Chips({ amount, className }: { amount: number; className?: string }) {
  return (
    <span className={`chips ${className ?? ""}`}>
      <PixelIcon name="coin" />
      <span className="num">{amount.toLocaleString("en-US")}</span>
    </span>
  );
}

/** A bet sitting on the felt in front of a player. */
export function Bet({ amount }: { amount: number }) {
  return <Chips amount={amount} className="bet" />;
}

/** The pot in the middle of the table. */
export function Pot({ amount, label = "Pot" }: { amount: number; label?: string }) {
  return (
    <div className="pot" data-testid="pot">
      <PixelIcon name="chips" scale={3} />
      <span className="pot-text">
        <span className="label">{label}</span>
        <span className="num">{amount.toLocaleString("en-US")}</span>
      </span>
    </div>
  );
}

export function DealerButton() {
  return (
    <span className="dealer-btn" title="Dealer">
      D
    </span>
  );
}
