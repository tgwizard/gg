import { type ReactNode, useEffect, useState } from "react";
import type { Member } from "../../../shared/protocol";
import { useNarrow } from "../../../ui";
import { CardTable, type TableSeat } from "../../kit/ui/CardTable";
import { CardBack, CardSlot, PlayingCard } from "../../kit/ui/Cards";
import { Bet, Chips, DealerButton, Pot } from "../../kit/ui/Chips";
import { ActionTray, GameLog } from "../../kit/ui/GameParts";
import { PlayerPlate } from "../../kit/ui/PlayerPlate";
import { TurnTimer } from "../../kit/ui/TurnTimer";
import type { GameUIProps } from "../../ui";
import type { HandPlayerView, PokerSeat, PokerView } from "../engine";
import type { PokerOp } from "../index";

type Props = GameUIProps<PokerView, PokerOp>;
type Send = Props["sendOp"];

export function PokerGame({ view, me, members, connected, sendOp, serverNow }: Props) {
  const narrow = useNarrow();
  const hand = view.hand;
  const nameOf = (id: string) => members.get(id)?.name ?? "Player";
  const winningCards = new Set(hand?.result ? Object.values(hand.result.hands).flatMap((h) => h.cards) : []);
  const bestSeats = new Set(hand?.result?.pots.flatMap((p) => p.winners) ?? []);
  const showdownCards = new Set<string>();
  for (const seat of bestSeats) for (const c of hand?.result?.hands[seat]?.cards ?? []) showdownCards.add(c);

  const seats: TableSeat[] = view.seats.map((seat, i) => {
    const hp = seat && hand ? hand.players.find((p) => p.seat === i && p.playerId === seat.playerId) : undefined;
    const isMe = !!seat && seat.playerId === me;
    return {
      key: i,
      testId: `seat-${i}`,
      className: ["seat", isMe && "me", !seat && "empty"].filter(Boolean).join(" "),
      bet: hp && hp.bet > 0 ? <Bet amount={hp.bet} /> : undefined,
      marker: seat && hand?.button === i ? <DealerButton /> : undefined,
      node: (
        <SeatView
          index={i}
          seat={seat}
          hp={hp}
          view={view}
          isMe={isMe}
          member={seat ? members.get(seat.playerId) : undefined}
          connected={connected}
          serverNow={serverNow}
          winningCards={winningCards}
          narrow={narrow}
          onSit={() => sendOp({ type: "sit", seat: i })}
        />
      ),
    };
  });

  return (
    <div className="poker">
      <CardTable
        seats={seats}
        rotation={view.you.seat ?? 0}
        testId="poker-table"
        center={
          <>
            <div className="board" data-testid="board">
              {[0, 1, 2, 3, 4].map((i) => {
                const card = hand?.board[i];
                const size = narrow ? "sm" : "md";
                return card ? <PlayingCard key={i} card={card} size={size} highlight={showdownCards.has(card)} /> : <CardSlot key={i} size={size} />;
              })}
            </div>
            {hand && <Pot amount={hand.pot} />}
            <CenterMessage view={view} nameOf={nameOf} serverNow={serverNow} />
          </>
        }
      />
      <ActionBar view={view} connected={connected} sendOp={sendOp} nameOf={nameOf} />
      {hand && (
        <GameLog title={`Hand #${hand.id} log`}>
          {hand.log.map((e, i) => (
            <li key={i}>
              {(i === 0 || hand.log[i - 1]!.street !== e.street) && <span className="label log-street">{e.street}</span>}
              <strong>{nameOf(e.playerId)}</strong> {e.action}
            </li>
          ))}
        </GameLog>
      )}
    </div>
  );
}

function SeatView(props: {
  index: number;
  seat: PokerSeat | null;
  hp: HandPlayerView | undefined;
  view: PokerView;
  isMe: boolean;
  member: Member | undefined;
  connected: boolean;
  serverNow: number;
  winningCards: Set<string>;
  narrow: boolean;
  onSit(): void;
}) {
  const { index, seat, hp, view, isMe, member, connected, serverNow } = props;
  const hand = view.hand;

  if (!seat) {
    return (
      <div className="seat-open">
        {view.you.seat === null ? (
          <button className="btn small" disabled={!connected} onClick={props.onSit}>
            Sit here
          </button>
        ) : (
          <span className="label">Open seat</span>
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
  if (won) status = `Wins ${won.toLocaleString("en-US")}`;
  const cardSize = isMe && !props.narrow ? "md" : "sm";

  return (
    <div className="seat-body">
      <div className="seat-cards">
        {hp &&
          (hp.cards
            ? hp.cards.map((c) => <PlayingCard key={c} card={c} size={cardSize} dim={hp.folded} highlight={!!won && props.winningCards.has(c)} />)
            : !hp.folded && (
                <>
                  <CardBack size={cardSize} />
                  <CardBack size={cardSize} />
                </>
              ))}
      </div>
      <PlayerPlate
        playerId={seat.playerId}
        name={member?.name ?? "Player"}
        you={isMe}
        online={member?.online !== false}
        active={isTurn}
        dim={hp?.folded || (!hp && !!hand)}
        winner={!!won}
      >
        <div className="plate-line">
          <Chips amount={seat.stack} />
        </div>
        {status && <div className={`plate-line status ${won ? "good" : ""}`}>{status}</div>}
        {made && hand?.status === "complete" && <div className="plate-line status">{made}</div>}
        {isTurn && <TurnTimer deadline={hand.actionDeadline} totalMs={view.config.turnSeconds * 1000} serverNow={serverNow} />}
      </PlayerPlate>
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
    return <div className="center-msg label">Hand #{hand.id}</div>;
  }
  const playerAt = (seat: number) => hand.players.find((p) => p.seat === seat)!.playerId;
  return (
    <div className="center-msg result" data-testid="hand-result">
      {hand.result.pots.map((pot, i) => {
        const names = pot.winners.map((s) => nameOf(playerAt(s))).join(" & ");
        const made = hand.result!.hands[pot.winners[0]!]?.name;
        return (
          <div key={i}>
            <strong className="display">{names}</strong> {pot.winners.length > 1 ? "split" : "wins"} {pot.amount.toLocaleString("en-US")}
            {made ? ` with ${made}` : ""}
          </div>
        );
      })}
      {nextIn !== null && <div className="label">Next hand in {nextIn}s</div>}
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
                <button key={label} className={`btn small dark ${raiseTo === v ? "on" : ""}`} disabled={disabled} onClick={() => setRaiseTo(v)}>
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
    main = <span className="muted">{waitingFor ? `Waiting for ${nameOf(waitingFor)}…` : "…"}</span>;
  } else if (handLive) {
    main = <span className="muted">Dealing…</span>;
  } else if (mySeat === null) {
    main = <span className="muted">Pick an open seat to join the game.</span>;
  }

  return (
    <ActionTray
      aside={
        <>
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
        </>
      }
    >
      {main}
    </ActionTray>
  );
}
