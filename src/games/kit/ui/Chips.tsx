import "./kit.css";

/** A poker chip, drawn in CSS. */
function Chip() {
  return <span className="chip" aria-hidden />;
}

/** A chip amount: a chip and a number. */
export function Chips({ amount, className }: { amount: number; className?: string }) {
  return (
    <span className={`chips ${className ?? ""}`}>
      <Chip />
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
      <span className="chip-stack" aria-hidden>
        <Chip />
        <Chip />
        <Chip />
      </span>
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
