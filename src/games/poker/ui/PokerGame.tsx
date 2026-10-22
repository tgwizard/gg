import { type ReactNode, useEffect, useState } from "react";
import type { Member } from "../../../shared/protocol";
import type { GameUIProps } from "../../ui";
import type { HandPlayerView, HandView, PokerSeat, PokerView } from "../engine";
import type { PokerOp } from "../index";
import { TurnTimer } from "../../kit/ui/TurnTimer";
import { CardBack, CardSlot, PlayingCard } from "./Cards";

type Props = GameUIProps<PokerView, PokerOp>;
type Send = Props["sendOp"];

export function PokerGame({ view, me, members, connected, sendOp, serverNow }: Props) {
  const hand = view.hand;
  const mySeat = view.you.seat;
  const n = view.seats.length;
  const nameOf = (id: string) => members.get(id)?.name ?? "Player";
  const winningCards = new Set(hand?.result ? Object.values(hand.result.hands).flatMap((h) => h.cards) : []);
  const bestSeats = new Set(hand?.result?.pots.flatMap((p) => p.winners) ?? []);
  const showdownCards = new Set<string>();
  for (const seat of bestSeats) for (const c of hand?.result?.hands[seat]?.cards ?? []) showdownCards.add(c);

  return (
    <div className="poker">
      <div className="poker-table" data-testid="poker-table">
        <div className="felt">
          <div className="board" data-testid="board">
            {[0, 1, 2, 3, 4].map((i) => {
              const card = hand?.board[i];
              return card ? <PlayingCard key={i} card={card} highlight={showdownCards.has(card)} /> : <CardSlot key={i} />;
            })}
          </div>
          {hand && (
            <div className="pot" data-testid="pot">
              Pot <strong>{hand.pot}</strong>
            </div>
          )}
          <CenterMessage view={view} nameOf={nameOf} serverNow={serverNow} />
        </div>

        {view.seats.map((seat, i) => {
          const pos = seatPosition(i, mySeat ?? 0, n);
          const hp = seat && hand ? hand.players.find((p) => p.seat === i && p.playerId === seat.playerId) : undefined;
          return (
            <div key={i}>
              <SeatSpot
                index={i}
                seat={seat}
                hp={hp}
                view={view}
                isMe={!!seat && seat.playerId === me}
                member={seat ? members.get(seat.playerId) : undefined}
                pos={pos}
                connected={connected}
                serverNow={serverNow}
                winningCards={winningCards}
                onSit={() => sendOp({ type: "sit", seat: i })}
              />
              {hp && hp.bet > 0 && (
                <div className="bet-chip" style={{ left: `${pos.bx}%`, top: `${pos.by}%` }}>
                  {hp.bet}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <ActionBar view={view} connected={connected} sendOp={sendOp} nameOf={nameOf} />
      {hand && <HandLog hand={hand} nameOf={nameOf} />}
    </div>
  );
}

/** Seats around an ellipse, rotated so you sit at the bottom. */
function seatPosition(i: number, rotation: number, n: number) {
  const rel = (i - rotation + n) % n;
  const a = Math.PI / 2 + (rel * 2 * Math.PI) / n;
  return {
    x: 50 + 44 * Math.cos(a),
    y: 50 + 41 * Math.sin(a),
    bx: 50 + 27 * Math.cos(a),
    by: 50 + 23 * Math.sin(a),
  };
}

function SeatSpot(props: {
  index: number;
  seat: PokerSeat | null;
  hp: HandPlayerView | undefined;
  view: PokerView;
  isMe: boolean;
  member: Member | undefined;
  pos: { x: number; y: number };
  connected: boolean;
  serverNow: number;
  winningCards: Set<string>;
  onSit(): void;
}) {
  const { index, seat, hp, view, isMe, member, pos, connected, serverNow } = props;
  const hand = view.hand;
  const style = { left: `${pos.x}%`, top: `${pos.y}%` };

  if (!seat) {
    return (
      <div className="seat empty" style={style} data-testid={`seat-${index}`}>
        {view.you.seat === null ? (
          <button className="btn small" disabled={!connected} onClick={props.onSit}>
            Sit here
          </button>
        ) : (
          <span className="muted small">Empty</span>
        )}
      </div>
    );
  }

  const isTurn = hand?.status === "betting" && hand.toAct === index;
  const won = hand?.status === "complete" ? hand.result?.payouts[index] : undefined;
  const made = hand?.result?.hands[index]?.name;
  let status: string | null = hp?.lastAction ?? null;
  if (hp?.allIn) status = "All-in";
  else if (hp?.folded) status = "Folded";
  else if (!hp && seat.stack === 0) status = "Out of chips";
  else if (!hp && seat.sittingOut) status = "Sitting out";
  if (won) status = `Wins ${won}`;

  const classes = ["seat", isMe && "me", isTurn && "turn", hp?.folded && "folded", won && "winner", !hp && hand && "idle"]
    .filter(Boolean)
    .join(" ");


  return (
    <div className={classes} style={style} data-testid={`seat-${index}`}>
      <div className="seat-cards">
        {hp &&
          (hp.cards
            ? hp.cards.map((c) => <PlayingCard key={c} card={c} dim={hp.folded} highlight={!!won && props.winningCards.has(c)} />)
            : !hp.folded && (
                <>
                  <CardBack />
                  <CardBack />
                </>
              ))}
      </div>
      <div className="seat-plate">
        <div className="seat-name">
          {member?.online === false && <span className="offline-dot" title="Disconnected" />}
          {member?.name ?? "Player"}
          {isMe && <span className="tag">you</span>}
        </div>
        <div className="seat-stack">{seat.stack.toLocaleString()}</div>
        {status && <div className={`seat-status ${won ? "won" : ""}`}>{status}</div>}
        {made && hand?.status === "complete" && <div className="seat-made">{made}</div>}
        {isTurn && <TurnTimer deadline={hand.actionDeadline} totalMs={view.config.turnSeconds * 1000} serverNow={serverNow} />}
      </div>
      {hand?.button === index && <div className="dealer-btn">D</div>}
    </div>
  );
}

function CenterMessage({ view, nameOf, serverNow }: { view: PokerView; nameOf(id: string): string; serverNow: number }) {
  const hand = view.hand;
  const nextIn = view.nextHandAt ? Math.max(0, Math.ceil((view.nextHandAt - serverNow) / 1000)) : null;
  const seated = view.seats.filter(Boolean).length;

  if (!hand) {
    return <div className="center-msg">{seated < 2 ? "Waiting for players to sit down…" : "Ready when you are. Deal when everyone's seated."}</div>;
  }
  if (hand.status !== "complete" || !hand.result) {
    return <div className="center-msg muted">Hand #{hand.id}</div>;
  }
  const playerAt = (seat: number) => hand.players.find((p) => p.seat === seat)!.playerId;
  return (
    <div className="center-msg result" data-testid="hand-result">
      {hand.result.pots.map((pot, i) => {
        const names = pot.winners.map((s) => nameOf(playerAt(s))).join(" & ");
        const made = hand.result!.hands[pot.winners[0]!]?.name;
        return (
          <div key={i}>
            <strong>{names}</strong> {pot.winners.length > 1 ? "split" : "wins"} {pot.amount}
            {made ? ` with ${made}` : ""}
          </div>
        );
      })}
      {nextIn !== null && <div className="muted small">Next hand in {nextIn}s</div>}
    </div>
  );
}

function ActionBar({ view, connected, sendOp, nameOf }: { view: PokerView; connected: boolean; sendOp: Send; nameOf(id: string): string }) {
  const { hand, you } = view;
  const actions = you.actions;
  const mySeat = you.seat;
  const me = mySeat !== null ? view.seats[mySeat] : null;
  const inHand = !!hand && hand.status !== "complete" && hand.players.some((p) => p.seat === mySeat && p.playerId === me?.playerId);
  const handLive = !!hand && hand.status !== "complete";
  const eligible = view.seats.filter((s) => s && s.stack > 0 && !s.sittingOut).length;
  const canDeal = !handLive && eligible >= 2 && (!view.started || view.nextHandAt === null);

  const [busy, setBusy] = useState(false);
  const [raiseTo, setRaiseTo] = useState(actions?.minRaiseTo ?? 0);
  const resetKey = `${hand?.id}:${hand?.street}:${hand?.currentBet}:${actions?.minRaiseTo}`;
  useEffect(() => {
    if (actions) setRaiseTo(actions.minRaiseTo);
  }, [resetKey]);

  const run = async (op: PokerOp) => {
    setBusy(true);
    await sendOp(op);
    setBusy(false);
  };
  const disabled = busy || !connected;

  let main: ReactNode;
  if (actions && hand) {
    const potAfterCall = hand.pot + actions.toCall;
    const clamp = (v: number) => Math.round(Math.min(actions.maxRaiseTo, Math.max(actions.minRaiseTo, v)));
    const presets: [string, number][] = [
      ["Min", actions.minRaiseTo],
      ["½ pot", clamp(hand.currentBet + potAfterCall / 2)],
      ["Pot", clamp(hand.currentBet + potAfterCall)],
      ["All-in", actions.maxRaiseTo],
    ];
    const isBet = hand.currentBet === 0;
    const allIn = raiseTo >= actions.maxRaiseTo;
    main = (
      <div className="actions" data-testid="actions">
        <button className="btn danger" disabled={disabled} onClick={() => run({ type: "fold" })}>
          Fold
        </button>
        {actions.canCheck ? (
          <button className="btn" disabled={disabled} onClick={() => run({ type: "check" })}>
            Check
          </button>
        ) : (
          <button className="btn" disabled={disabled} onClick={() => run({ type: "call" })}>
            Call {actions.toCall}
          </button>
        )}
        {actions.canRaise && (
          <div className="raise">
            <div className="presets">
              {presets.map(([label, v]) => (
                <button key={label} className="btn ghost small" disabled={disabled} onClick={() => setRaiseTo(v)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="row">
              <input
                type="range"
                min={actions.minRaiseTo}
                max={actions.maxRaiseTo}
                value={raiseTo}
                onChange={(e) => setRaiseTo(Number(e.target.value))}
                aria-label="Raise amount"
              />
              <input
                type="number"
                className="raise-input"
                min={actions.minRaiseTo}
                max={actions.maxRaiseTo}
                value={raiseTo}
                onChange={(e) => setRaiseTo(Number(e.target.value))}
                onBlur={() => setRaiseTo(clamp(raiseTo))}
                aria-label="Raise to"
              />
              <button className="btn primary" disabled={disabled} onClick={() => run({ type: "raise", to: clamp(raiseTo) })}>
                {allIn ? `All-in ${actions.maxRaiseTo}` : isBet ? `Bet ${clamp(raiseTo)}` : `Raise to ${clamp(raiseTo)}`}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  } else if (handLive && hand.toAct !== null) {
    const waitingFor = view.seats[hand.toAct]?.playerId;
    main = <div className="muted">{waitingFor ? `Waiting for ${nameOf(waitingFor)}…` : "…"}</div>;
  } else if (handLive) {
    main = <div className="muted">Dealing…</div>;
  } else if (mySeat === null) {
    main = <div className="muted">Pick an empty seat to join the game.</div>;
  }

  return (
    <div className="action-bar">
      <div className="action-main">{main}</div>
      <div className="seat-controls">
        {canDeal && (
          <button className="btn primary" disabled={disabled} onClick={() => run({ type: "start" })}>
            Deal
          </button>
        )}
        {me && me.stack === 0 && !inHand && (
          <button className="btn" disabled={disabled} onClick={() => run({ type: "rebuy" })}>
            Rebuy {view.config.startingStack}
          </button>
        )}
        {me &&
          (me.sittingOut ? (
            <button className="btn" disabled={disabled} onClick={() => run({ type: "sitIn" })}>
              I'm back
            </button>
          ) : (
            <button className="btn ghost small" disabled={disabled} onClick={() => run({ type: "sitOut" })}>
              Sit out next hand
            </button>
          ))}
        {me && (
          <button className="btn ghost small" disabled={disabled} onClick={() => run({ type: "leave" })}>
            {inHand ? "Fold & leave seat" : "Leave seat"}
          </button>
        )}
      </div>
    </div>
  );
}

function HandLog({ hand, nameOf }: { hand: HandView; nameOf(id: string): string }) {
  let street = "";
  return (
    <details className="hand-log">
      <summary>Hand #{hand.id} log</summary>
      <ol>
        {hand.log.map((e, i) => {
          const header = e.street !== street ? e.street : null;
          street = e.street;
          return (
            <li key={i}>
              {header && <span className="log-street">{header}</span>}
              <span className="log-name">{nameOf(e.playerId)}</span> {e.action}
            </li>
          );
        })}
      </ol>
    </details>
  );
}
