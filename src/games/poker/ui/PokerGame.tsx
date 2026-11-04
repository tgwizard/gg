import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Member } from "../../../shared/protocol";
import { Button, busyWhy, play, useMedia, useNarrow } from "../../../ui";
import { CardTable, type TableSeat } from "../../kit/ui/CardTable";
import { CardBack, CardSlot, PlayingCard } from "../../kit/ui/Cards";
import { Bet, Chips, DealerButton, Pot } from "../../kit/ui/Chips";
import { betStops } from "./amounts";
import { arrivalStyle, Flights, rectOf, reducedMotion, seatRect, useFlights } from "../../kit/ui/Flights";
import { ActionTray, GameLog, TableFooter } from "../../kit/ui/GameParts";
import { PlayerPlate } from "../../kit/ui/PlayerPlate";
import { TurnTimer } from "../../kit/ui/TurnTimer";
import type { GameUIProps } from "../../ui";
import type { HandPlayerView, HandView, PokerSeat, PokerView } from "../engine";
import { describeHolding } from "../evaluator";
import type { PokerOp } from "../index";

type Props = GameUIProps<PokerView, PokerOp>;
type Send = Props["sendOp"];

export function PokerGame({ view, me, members, connected, sendOp, serverNow }: Props) {
  const narrow = useNarrow();
  // Your cards are bigger than everyone else's, unless the table's too short for them (they'd cover the pot).
  const roomy = useMedia("(min-width: 1100px) and (min-height: 860px)");
  const hand = view.hand;
  const nameOf = (id: string) => members.get(id)?.name ?? "Player";
  const winningCards = new Set(hand?.result ? Object.values(hand.result.hands).flatMap((h) => h.cards) : []);
  const bestSeats = new Set(hand?.result?.pots.flatMap((p) => p.winners) ?? []);
  const showdownCards = new Set<string>();
  for (const seat of bestSeats) for (const c of hand?.result?.hands[seat]?.cards ?? []) showdownCards.add(c);
  const motion = usePokerMotion(hand, view.seats.length, view.you.seat);

  const seats: TableSeat[] = view.seats.map((seat, i) => {
    const hp = seat && hand ? hand.players.find((p) => p.seat === i && p.playerId === seat.playerId) : undefined;
    const isMe = !!seat && seat.playerId === me;
    return {
      key: i,
      testId: `seat-${i}`,
      className: ["seat", isMe && "me", !seat && "empty"].filter(Boolean).join(" "),
      bet: hp && hp.bet > 0 ? <Bet amount={hp.bet} /> : undefined,
      // Once the game's going, open seats only matter to someone who could take one.
      node: !seat && view.started && view.you.seat !== null ? null : (
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
          bigCards={!narrow && roomy}
          motion={motion.state}
          onSit={() => sendOp({ type: "sit", seat: i })}
        />
      ),
    };
  });

  return (
    <div className="poker">
      <CardTable
        seats={seats}
        betAt="seat"
        testId="poker-table"
        center={
          <>
            <div className="board" data-testid="board">
              {[0, 1, 2, 3, 4].map((i) => {
                const card = hand?.board[i];
                const size = narrow ? "sm" : "md";
                if (!card) return <CardSlot key={i} size={size} />;
                const m = motion.state;
                const flip = m?.hand === hand!.id && m.boardFrom !== undefined && i >= m.boardFrom;
                return (
                  <span key={i} className={flip ? "flip-in" : undefined} style={flip ? { animationDelay: `${m.boardDelay + (i - m.boardFrom!) * 0.14}s` } : undefined}>
                    <PlayingCard card={card} size={size} highlight={showdownCards.has(card)} />
                  </span>
                );
              })}
            </div>
            <div className="center-row">
              {hand && <Pot amount={hand.pot} />}
              <CenterMessage view={view} nameOf={nameOf} serverNow={serverNow} />
            </div>
          </>
        }
      />
      <ActionBar view={view} connected={connected} sendOp={sendOp} nameOf={nameOf} narrow={narrow} />
      <TableFooter
        log={
          <>
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
            <Ledger view={view} nameOf={nameOf} />
          </>
        }
        actions={<SeatActions view={view} connected={connected} sendOp={sendOp} />}
      />
      <Flights flights={motion.flights} onLand={motion.land} />
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
  /** Your own cards at the bigger size. */
  bigCards: boolean;
  motion: Motion | null;
  onSit(): void;
}) {
  const { index, seat, hp, view, isMe, member, connected, serverNow } = props;
  const hand = view.hand;

  if (!seat) {
    return (
      <div className="seat-open">
        {view.you.seat === null ? (
          <Button className="btn small" why={busyWhy({ connected })} onClick={props.onSit}>
            Sit here
          </Button>
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
  const cardSize = isMe && props.bigCards ? "md" : "sm";
  const m = props.motion?.hand === hand?.id ? props.motion : null;
  const arriving = m?.deal?.get(index);
  const flip = m?.reveal?.has(index) ? { animationDelay: `${m.revealDelay}s` } : null;

  return (
    <div className="seat-body">
      <div className="seat-cards">
        {hp &&
          (hp.cards
            ? hp.cards.map((c, i) => (
                <span key={c} className={flip ? "flip-in" : undefined} style={flip ?? arrivalStyle(arriving?.[i])}>
                  <PlayingCard card={c} size={cardSize} dim={hp.folded} highlight={!!won && props.winningCards.has(c)} />
                </span>
              ))
            : !hp.folded &&
              [0, 1].map((i) => (
                <span key={i} style={arrivalStyle(arriving?.[i])}>
                  <CardBack size={cardSize} />
                </span>
              )))}
      </div>
      <PlayerPlate
        playerId={seat.playerId}
        name={member?.name ?? "Player"}
        you={isMe}
        online={member?.online !== false}
        active={isTurn}
        dim={hp?.folded || (!hp && !!hand)}
        winner={!!won}
        badge={hand?.button === index ? <DealerButton /> : undefined}
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

  // A freezeout that's down to one player with chips is over.
  const withChips = view.seats.filter((s) => s && s.stack > 0);
  const champion = view.started && !view.config.rebuys && seated >= 2 && withChips.length === 1 && hand?.status !== "betting" && hand?.status !== "runout" ? withChips[0]! : null;
  if (champion && view.nextHandAt === null) {
    return (
      <div className="center-msg result" data-testid="table-winner">
        <div>
          <strong className="display">{nameOf(champion.playerId)}</strong> has all the chips!
        </div>
      </div>
    );
  }
  if (!hand) {
    return <div className="center-msg">{seated < 2 ? "Waiting for players to sit down…" : "Ready when you are. Deal when everyone's seated."}</div>;
  }
  if (hand.status !== "complete" || !hand.result) {
    const next = view.nextBlinds;
    return (
      <div className="center-msg label" data-testid="hand-label">
        <div>Hand #{hand.id}</div>
        <div className="center-sub">
          Blinds {hand.blinds.small}/{hand.blinds.big}
          {next && (
            <>
              <br />
              {next.small}/{next.big} from hand #{next.atHand}
            </>
          )}
        </div>
      </div>
    );
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

function ActionBar({ view, connected, sendOp, nameOf, narrow }: { view: PokerView; connected: boolean; sendOp: Send; nameOf(id: string): string; narrow: boolean }) {
  const { hand, you } = view;
  const actions = you.actions;
  const mySeat = you.seat;
  const me = mySeat !== null ? view.seats[mySeat] : null;
  const inHand = !!hand && hand.status !== "complete" && hand.players.some((p) => p.seat === mySeat && p.playerId === me?.playerId);
  const handLive = !!hand && hand.status !== "complete";
  const eligible = view.seats.filter((s) => s && s.stack > 0 && !s.sittingOut).length;
  const canDeal = mySeat !== null && !handLive && eligible >= 2 && (!view.started || view.nextHandAt === null);

  const [busy, setBusy] = useState(false);
  const [raiseTo, setRaiseTo] = useState(actions?.minRaiseTo ?? 0);
  // On a phone, sizing a bet is a step of its own (Raise…), so the tray stays small until then.
  const [sizing, setSizing] = useState(false);
  const resetKey = `${hand?.id}:${hand?.street}:${hand?.currentBet}:${actions?.minRaiseTo}`;
  useEffect(() => {
    if (actions) setRaiseTo(actions.minRaiseTo);
    setSizing(false);
  }, [resetKey]);

  const run = async (op: PokerOp) => {
    setBusy(true);
    await sendOp(op);
    setBusy(false);
  };
  const why = busyWhy({ busy, connected });

  // Your cards so far, named: "Pair of Nines".
  const mine = hand?.players.find((p) => p.seat === mySeat && p.playerId === me?.playerId);
  const holding = handLive && mine?.cards && !mine.folded ? describeHolding([...mine.cards, ...hand.board]) : null;

  let main: ReactNode;
  if (actions && hand) {
    const { minRaiseTo: min, maxRaiseTo: max } = actions;
    const potAfterCall = hand.pot + actions.toCall;
    const clamp = (v: number) => Math.round(Math.min(max, Math.max(min, v)));
    // Amounts go up in small blinds (the minimum and all-in excepted), so they come out round.
    const stops = betStops(min, max, hand.blinds.small);
    const presets: [string, number][] = [
      ["Min", min],
      ["½ pot", clamp(hand.currentBet + potAfterCall / 2)],
      ["Pot", clamp(hand.currentBet + potAfterCall)],
      ["All-in", max],
    ];
    const isBet = hand.currentBet === 0;
    const amount = clamp(raiseTo);
    const allIn = amount >= max;
    const fold = (
      <Button className="btn danger" why={why} onClick={() => run({ type: "fold" })}>
        Fold
      </Button>
    );
    const callOrCheck = actions.canCheck ? (
      <Button className="btn" why={why} onClick={() => run({ type: "check" })}>
        Check
      </Button>
    ) : (
      <Button className="btn" why={why} onClick={() => run({ type: "call" })}>
        Call {actions.toCall.toLocaleString("en-US")}
      </Button>
    );
    const confirm = (
      <Button className="btn primary raise-go" why={why} onClick={() => run({ type: "raise", to: amount })}>
        {allIn ? `All-in ${max.toLocaleString("en-US")}` : `${isBet ? "Bet" : "Raise to"} ${amount.toLocaleString("en-US")}`}
      </Button>
    );
    const sizer = (
      <div className="raise" data-testid="raise">
        <div className="presets">
          {presets.map(([label, v]) => (
            <Button key={label} className={`btn small subtle ${amount === v ? "on" : ""}`} why={why} onClick={() => setRaiseTo(v)}>
              {label}
            </Button>
          ))}
        </div>
        <div className="raise-row">
          {!narrow && (
            <input
              type="range"
              min={0}
              max={stops.count - 1}
              step={1}
              value={stops.indexOf(amount)}
              onChange={(e) => setRaiseTo(stops.at(Number(e.target.value)))}
              aria-label="Raise amount"
              aria-valuetext={String(amount)}
            />
          )}
          <div className="stepper">
            <Button className="btn subtle step" why={amount <= min ? "That's the smallest raise you can make." : null} onClick={() => setRaiseTo(stops.down(amount))} aria-label={`Less (by ${hand.blinds.small})`}>
              −
            </Button>
            <input
              type="number"
              inputMode="numeric"
              className="raise-input"
              min={min}
              max={max}
              value={raiseTo}
              onChange={(e) => setRaiseTo(Number(e.target.value))}
              onBlur={() => setRaiseTo(amount)}
              aria-label={isBet ? "Bet" : "Raise to"}
            />
            <Button className="btn subtle step" why={amount >= max ? "That's all your chips." : null} onClick={() => setRaiseTo(stops.up(amount))} aria-label={`More (by ${hand.blinds.small})`}>
              +
            </Button>
          </div>
          {!narrow && confirm}
        </div>
      </div>
    );
    if (!narrow) {
      main = (
        <div className="actions" data-testid="actions">
          {fold}
          {callOrCheck}
          {actions.canRaise && sizer}
        </div>
      );
    } else if (sizing && actions.canRaise) {
      main = (
        <div className="actions sizing" data-testid="actions">
          {sizer}
          <div className="actions-row">
            <button type="button" className="btn subtle" onClick={() => setSizing(false)}>
              Back
            </button>
            {confirm}
          </div>
        </div>
      );
    } else {
      main = (
        <div className="actions actions-row" data-testid="actions">
          {fold}
          {callOrCheck}
          {actions.canRaise && (
            <Button className="btn primary" why={why} onClick={() => setSizing(true)}>
              {isBet ? "Bet…" : "Raise…"}
            </Button>
          )}
        </div>
      );
    }
  } else if (handLive && hand.toAct !== null) {
    const waitingFor = view.seats[hand.toAct]?.playerId;
    main = <span className="muted">{waitingFor ? `Waiting for ${nameOf(waitingFor)}…` : "…"}</span>;
  } else if (handLive) {
    main = <span className="muted">Dealing…</span>;
  } else if (mySeat === null) {
    main = <span className="muted">Pick an open seat to join the game.</span>;
  } else if (me && me.stack === 0 && !view.config.rebuys) {
    main = <span className="muted">You're out of chips, and there are no rebuys at this table.</span>;
  } else if (hand && view.nextHandAt !== null) {
    main = <span className="muted">Hand over. The next one is dealt in a moment.</span>;
  }

  return (
    <ActionTray
      pinned={!!actions}
      aside={
        <>
          {canDeal && (
            <Button className="btn primary" why={why} onClick={() => run({ type: "start" })}>
              Deal
            </Button>
          )}
          {me && me.stack === 0 && !inHand && view.config.rebuys && (
            <Button className="btn" why={why} onClick={() => run({ type: "rebuy" })}>
              Rebuy {view.config.startingStack.toLocaleString("en-US")}
            </Button>
          )}
          {me?.sittingOut && (
            <Button className="btn" why={why} onClick={() => run({ type: "sitIn" })}>
              I'm back
            </Button>
          )}
        </>
      }
    >
      {holding && (
        <div className="poker-holding" data-testid="poker-holding">
          {/* On a phone the tray may be over your seat: your cards are here too. */}
          {narrow && mine?.cards && (
            <span className="poker-holding-cards">
              {mine.cards.map((c) => (
                <PlayingCard key={c} card={c} size="sm" />
              ))}
            </span>
          )}
          <span className="label">Your hand</span> <strong>{holding}</strong>
        </div>
      )}
      {main}
    </ActionTray>
  );
}

/** Who's bought in for how much, and how they're doing: for settling up after a home game. */
function Ledger({ view, nameOf }: { view: PokerView; nameOf(id: string): string }) {
  if (!view.ledger.length) return null;
  const fmt = (n: number) => n.toLocaleString("en-US");
  return (
    <details className="log game-log poker-ledger" data-testid="ledger">
      <summary>Buy-ins</summary>
      <table>
        <thead>
          <tr>
            <th>Player</th>
            <th>Bought in</th>
            <th>Has</th>
            <th>Up/down</th>
          </tr>
        </thead>
        <tbody>
          {view.ledger.map((l) => {
            const net = l.chips - l.boughtIn;
            return (
              <tr key={l.playerId}>
                <td>{nameOf(l.playerId)}</td>
                <td className="num">
                  {fmt(l.boughtIn)}
                  {l.rebuys > 0 && <span className="ledger-rebuys">{l.rebuys === 1 ? "1 rebuy" : `${l.rebuys} rebuys`}</span>}
                </td>
                <td className="num">{fmt(l.chips)}</td>
                <td className={`num ${net > 0 ? "up" : net < 0 ? "down" : ""}`}>{net > 0 ? `+${fmt(net)}` : fmt(net)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">{view.config.rebuys ? `A rebuy is ${fmt(view.config.startingStack)} chips, once you're out.` : "No rebuys at this table: once you're out, you're out."}</p>
    </details>
  );
}

/** Quiet housekeeping under the table: sit out, leave. */
function SeatActions({ view, connected, sendOp }: { view: PokerView; connected: boolean; sendOp: Send }) {
  const [busy, setBusy] = useState(false);
  const mySeat = view.you.seat;
  const me = mySeat !== null ? view.seats[mySeat] : null;
  if (!me) return null;
  const hand = view.hand;
  const inHand = !!hand && hand.status !== "complete" && hand.players.some((p) => p.seat === mySeat && p.playerId === me.playerId);
  const run = async (op: PokerOp) => {
    setBusy(true);
    await sendOp(op);
    setBusy(false);
  };
  const why = busyWhy({ busy, connected });
  return (
    <>
      {!me.sittingOut && (
        <Button className="btn ghost small" why={why} onClick={() => run({ type: "sitOut" })}>
          Sit out next hand
        </Button>
      )}
      <Button className="btn ghost small" why={why} onClick={() => run({ type: "leave" })}>
        {inHand ? "Fold & leave seat" : "Leave seat"}
      </Button>
    </>
  );
}

// --- motion ------------------------------------------------------------------

/** What's moving in the hand on screen: dealt cards on their way, cards turning over. */
interface Motion {
  hand: number;
  /** When each seat's two cards land, in seconds from now. */
  deal?: Map<number, number[]>;
  /** Board cards from this index on turn over, the first after `boardDelay` seconds. */
  boardFrom?: number;
  boardDelay: number;
  /** Seats whose cards are turned over at the showdown, after `revealDelay`. */
  reveal?: Set<number>;
  revealDelay: number;
}

const DEAL_SECONDS = 0.42;

/**
 * Animates what changed since the last view, live only (a refresh or reconnect shows
 * the table as it is): dealing, bets swept into the pot when a betting round ends,
 * board cards and showdown hands turning over, and the pot going to the winners.
 */
function usePokerMotion(hand: HandView | null, seatCount: number, mySeat: number | null) {
  const { flights, launch, land } = useFlights();
  const [state, setState] = useState<Motion | null>(null);
  /** The hand in the last view: undefined before the first view (nothing to animate from), null between games. */
  const before = useRef<HandView | null | undefined>(undefined);

  useLayoutEffect(() => {
    const prev = before.current;
    before.current = hand;
    if (!hand || prev === undefined || reducedMotion()) return;
    const board = rectOf('[data-testid="board"]');
    if (prev?.id !== hand.id) {
      // Two rounds, one card at a time, starting left of the button.
      const order = [...hand.players].sort((a, b) => ((a.seat - hand.button + seatCount - 1) % seatCount) - ((b.seat - hand.button + seatCount - 1) % seatCount));
      const deal = new Map<number, number[]>();
      const plans = order.flatMap((p, k) =>
        [0, 1].map((round) => {
          const delay = (round * order.length + k) * 0.08;
          deal.set(p.seat, [...(deal.get(p.seat) ?? []), delay + DEAL_SECONDS]);
          const to = seatRect(p.seat, ".seat-cards");
          return board && to ? { node: <CardBack size="sm" />, from: board, to, delay, duration: DEAL_SECONDS, scale: [0.8, 1] as [number, number], sound: "card" as const } : null;
        }),
      );
      launch(plans);
      setState({ hand: hand.id, deal, boardDelay: 0, revealDelay: 0 });
      return;
    }

    if (!prev) return;
    const pot = rectOf('[data-testid="pot"]');
    let t = 0;
    // A betting round ended: what was bet goes into the pot.
    if (pot && (prev.street !== hand.street || (prev.status !== "complete" && hand.status === "complete"))) {
      t = launch(
        prev.players
          .filter((p) => p.bet > 0)
          .map((p, i) => {
            const from = rectOf(`[data-bet-spot="${p.seat}"]`);
            return from ? { node: <Bet amount={p.bet} />, from, to: pot, delay: i * 0.05, duration: 0.42, sound: "chip" as const } : null;
          }),
      );
    }
    const boardFrom = hand.board.length > prev.board.length ? prev.board.length : undefined;
    const boardDone = t + (boardFrom === undefined ? 0 : (hand.board.length - boardFrom) * 0.14 + 0.38);
    const reveal = new Set(hand.players.filter((p) => p.cards && !prev.players.find((q) => q.seat === p.seat)?.cards).map((p) => p.seat));
    if (boardFrom !== undefined) play("flip", t);
    if (reveal.size) play("flip", boardDone);
    if (boardFrom !== undefined || reveal.size) setState({ hand: hand.id, boardFrom, boardDelay: t, reveal, revealDelay: boardDone });
    // The hand is over: the pot goes to whoever won it, once the cards are seen.
    if (pot && hand.result && prev.status !== "complete" && hand.status === "complete") {
      const delay = boardDone + (reveal.size ? 0.5 : 0.1);
      if (mySeat !== null && hand.result.payouts[mySeat]) play("good", delay + 0.6);
      launch(
        Object.entries(hand.result.payouts).map(([seat, amount]) => {
          const to = seatRect(Number(seat));
          return to && amount ? { node: <Chips amount={amount} className="bet" />, from: pot, to, delay, duration: 0.6, sound: "chip" as const } : null;
        }),
      );
    }
    // A hand's views are set up once each; seatCount only changes between games.
  }, [hand]);

  return { flights, land, state };
}
