import { type MouseEvent, type ReactNode, type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, busyWhy, play, PlayerName, playerStyle, Popover, urgency, usePeek, usePlayerColors } from "../../../ui";
import { Flights, rectOf, reducedMotion, useFlights, useOnChange } from "../../kit/ui/Flights";
import { GameOver } from "../../kit/ui/GameOver";
import { ActionTray, GameLog, Herald, TableFooter } from "../../kit/ui/GameParts";
import { PlayerPlate } from "../../kit/ui/PlayerPlate";
import { TurnTimer } from "../../kit/ui/TurnTimer";
import type { GameUIProps } from "../../ui";
import { AUTO_PLAY_DELAY_MS, type Hand, LONGEST_BONUS, type TicketView, type TtrEvent, type TtrPlayerView, type TtrView } from "../engine";
import { routeOpen } from "../graph";
import { CARD_COLORS, type CardColor, cityName, ROUTE_POINTS, ROUTES, type Route, routeById, routeName, type Ticket, ticketById, TRAIN_COLORS } from "../map";
import type { TtrOp } from "../index";
import { VIEWBOX } from "./geometry";
import { TicketMap } from "./TicketMap";
import { ZoomableBoard } from "./ZoomableBoard";
import { CardBack, cardName, DeckPile, TrainCard } from "./TrainCards";
import "./ticket.css";

type Props = GameUIProps<TtrView, TtrOp>;

/** How much history shows at first, and how much more each "Load more" brings. */
const LOG_PAGE = 10;

interface Payment {
  color: CardColor;
  locos: number;
}

/** Every way to pay for a route from a hand: each usable color with any number of locomotives, or locomotives only. */
export function payments(hand: Hand, route: Route): Payment[] {
  const n = route.length;
  const colors = route.color === "gray" ? TRAIN_COLORS : [route.color];
  const out: Payment[] = [];
  for (const color of colors) {
    for (let locos = Math.max(0, n - hand[color]); locos < n && locos <= hand.loco; locos++) out.push({ color, locos });
  }
  if (hand.loco >= n) out.push({ color: "loco", locos: n });
  return out;
}

export function TicketGame({ view, me, members, connected, sendOp, serverNow }: Props) {
  const colorOf = usePlayerColors();
  const nameOf = (id: string) => (id === me ? "You" : (members.get(id)?.name ?? "Player"));
  const plainName = (id: string) => members.get(id)?.name ?? "Player";
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [keepSel, setKeepSel] = useState<number[]>([]);
  const [hovered, setHovered] = useState<Ticket | null>(null);
  const [hoveredPlayer, setHoveredPlayer] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [logShown, setLogShown] = useState(LOG_PAGE);
  const logRef = useRef<HTMLDivElement>(null);
  const flights = useCardFlights(view, me);
  const root = useRef<HTMLDivElement>(null);
  const layout = useLayout(root);

  const mine = view.players.find((p) => p.playerId === me && !p.left);
  const current = view.players.find((p) => p.seat === view.turn && !p.left);
  const myTurn = !!mine && current === mine && view.phase === "playing";
  const hand = view.you.hand;
  // No disabled buttons: one that can't be used this moment says why when pressed.
  const why = busyWhy({ busy, connected });
  const turnWhy = myTurn ? null : current ? `It's ${plainName(current.playerId)}'s turn.` : "It's not your turn.";

  const claimable = useMemo(() => {
    const out = new Set<string>();
    if (!myTurn || view.stage !== "start" || !hand || !mine) return out;
    for (const r of ROUTES) {
      if (mine.trains >= r.length && routeOpen(view.claims, r, me, view.bothTracks) && payments(hand, r).length) out.add(r.id);
    }
    return out;
  }, [myTurn, view.stage, view.claims, view.bothTracks, hand, mine, me]);
  const route = picked && claimable.has(picked) ? routeById.get(picked)! : null;

  const offered = view.you.offered;
  const keeping = offered ? keepSel.filter((id) => offered.some((t) => t.id === id)) : [];
  const mySeat = view.you.seat === null ? null : view.seats[view.you.seat];
  const away = !!mySeat?.sittingOut && view.you.inGame && (view.phase === "playing" || view.phase === "choosing");
  // Your move (your turn, or your first tickets): the news and the tray light up, and flash as the clock runs out.
  const myMove = myTurn || (view.phase === "choosing" && !!offered);
  const deadline = view.phase === "choosing" ? view.setupDeadline : view.turnDeadline;
  // Not while you're away: the game moves for you then.
  const hurry = myMove && !away && deadline !== null ? urgency(deadline - serverNow) : null;
  const turnClass = myMove ? `ttr-turn${hurry ? ` hurry-${hurry}` : ""}` : "";

  const send = async (op: TtrOp) => {
    setBusy(true);
    const ok = await sendOp(op);
    setBusy(false);
    if (ok) {
      setPicked(null);
      if (op.type === "keep") setKeepSel([]);
    }
    return ok;
  };

  const marked = useMemo(() => new Set(view.you.tickets.filter((t) => !t.done).flatMap((t) => [t.a, t.b])), [view.you.tickets]);
  const lastClaim = [...view.log].reverse().find((e) => e.type === "claim");
  // A new claim is laid down car by car (`TicketMap`'s `laying`), and clanks as the first cars land.
  const [laying, setLaying] = useState<string | null>(null);
  const layDone = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(layDone.current), []);
  useOnChange(lastClaim?.type === "claim" ? `${view.game}:${lastClaim.route}` : null, () => {
    if (lastClaim?.type !== "claim") return;
    play("claim", reducedMotion() ? 0 : 0.2);
    if (reducedMotion()) return;
    setLaying(lastClaim.route);
    clearTimeout(layDone.current);
    // Long enough for the cars, and the gold glow that follows them.
    layDone.current = setTimeout(() => setLaying(null), 4000);
  });
  const inGame = view.phase !== "lobby";
  const lines = summarize(view.log);
  /** The news box opens the history and goes there. */
  const openLog = () => {
    setLogOpen(true);
    requestAnimationFrame(() => logRef.current?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" }));
  };
  // Your own latest draw: the cards you drew blind are yours to see.
  const myLast = lines.findLast((l) => l.type === "cards" && l.who === me);
  const story = (line: Line): ReactNode =>
    line.type === "cards" ? (
      <CardsStory line={line} nameOf={nameOf} blind={line === myLast ? view.you.drawn : []} />
    ) : line.type === "claim" ? (
      <ClaimStory e={line} nameOf={nameOf} />
    ) : (
      <span className="ttr-story-text">{describe(line, nameOf)}</span>
    );

  return (
    <div ref={root} className={`ttr ${layout}`} data-layout={layout}>
      <div className="ttr-grid">
        <div className="ttr-board">
          <ZoomableBoard aspect={VIEWBOX.w / VIEWBOX.h}>
            <TicketMap
              claims={view.claims}
              bothTracks={view.bothTracks}
              colorOf={colorOf}
              nameOf={plainName}
              claimable={claimable}
              selected={route?.id ?? null}
              onSelect={(id) => setPicked(id === picked ? null : id)}
              marked={marked}
              focus={hovered ? [hovered.a, hovered.b] : undefined}
              recent={lastClaim?.type === "claim" ? lastClaim.route : null}
              laying={laying}
              owner={hoveredPlayer}
              picking={!!route}
            >
              {route && hand && (
                <ClaimPopover
                  route={route}
                  hand={hand}
                  why={why}
                  onPay={(p) => send({ type: "claim", route: route.id, color: p.color, locos: p.locos })}
                  onCancel={() => setPicked(null)}
                />
              )}
            </TicketMap>
          </ZoomableBoard>
        </div>

        <Result view={view} me={me} name={plainName} start={view.canStart && view.you.seat !== null ? () => send({ type: "start" }) : null} why={why} />

        {/* Your side of the table: beside the map when there's room, under it otherwise. */}
        <div className="ttr-side">
          <Players view={view} me={me} members={members} connected={connected} busy={busy} send={send} serverNow={serverNow} onHover={setHoveredPlayer} hurry={hurry} />
          {inGame ? (
            <News view={view} myTurn={myTurn} away={away} nameOf={plainName} recent={lines.slice(-2)} story={story} className={turnClass} onOpen={openLog} />
          ) : (
            <Herald testId="ttr-news">
              <span>{view.seats.filter(Boolean).length < 2 ? "Take a seat. Two to five can play." : "Start when everyone's seated."}</span>
            </Herald>
          )}

          <ActionTray aside={<Controls view={view} connected={connected} busy={busy} send={send} />} testId="ttr-tray" className={turnClass}>
            {away && (
              <div className="ttr-away" data-testid="ttr-away">
                <span>
                  <strong>You're away.</strong> Your turns are played for you (two cards from the deck). Tap your name above, or:
                </span>
                <Button className="btn primary small" why={why} onClick={() => send({ type: "sitIn" })}>
                  I'm back
                </Button>
              </div>
            )}
            {offered ? (
              <TicketChoice
                offered={offered}
                keepAtLeast={view.you.keepAtLeast}
                selected={keeping}
                onToggle={(id) => setKeepSel(keeping.includes(id) ? keeping.filter((x) => x !== id) : [...keeping, id])}
                onHover={setHovered}
                deadline={view.phase === "choosing" ? view.setupDeadline : view.turnDeadline}
                totalMs={view.phase === "choosing" ? view.config.turnSeconds * 2000 : view.config.turnSeconds * 1000}
                serverNow={serverNow}
                why={why}
                onKeep={() => send({ type: "keep", tickets: keeping })}
              />
            ) : mine && hand && view.phase === "playing" ? (
              <div className="ttr-me">
                <Market view={view} turnWhy={turnWhy} why={why} send={send} onTake={flights.takeFrom} />
                <HandView hand={hand} />
                {/* Last in the tray, in a space of its own that's always there, so nothing moves as it changes:
                    what to do now on your turn (whose turn it is otherwise is in the news), else what you drew blind. */}
                <div className="ttr-note">
                  {myTurn ? (
                    <span className="ttr-hint" data-testid="ttr-hint">
                      {route
                        ? `Choose how to pay for ${routeName(route)}, on the map.`
                        : view.stage === "second"
                          ? "Take one more card (not a face-up locomotive)."
                          : claimable.size
                            ? "Draw cards, take tickets, or tap a highlighted route to claim it."
                            : "Draw cards or take tickets."}
                    </span>
                  ) : (
                    view.you.drawn.length > 0 && <span className="ttr-drawn">From the deck last turn: {view.you.drawn.map((c) => cardName(c)).join(", ")}</span>
                  )}
                </div>
              </div>
            ) : (
              <Status view={view} />
            )}
          </ActionTray>

          {view.you.tickets.length > 0 && view.phase !== "over" && <YourTickets tickets={view.you.tickets} onHover={setHovered} />}
        </div>

        <TableFooter
          log={
            view.log.length > 0 && (
              // Most recent first, a page at a time.
              <div ref={logRef} className="ttr-log">
                <GameLog
                  title="What happened"
                  open={logOpen}
                  onToggle={setLogOpen}
                  footer={
                    lines.length > logShown && (
                      <button type="button" className="btn ghost small" onClick={() => setLogShown((n) => n + LOG_PAGE)} data-testid="ttr-log-more">
                        Load more
                      </button>
                    )
                  }
                >
                  {lines
                    .map((line, i) => (
                      <li key={i} className="ttr-story">
                        {story(line)}
                      </li>
                    ))
                    .reverse()
                    .slice(0, logShown)}
                </GameLog>
              </div>
            )
          }
          actions={<SeatActions view={view} connected={connected} busy={busy} send={send} />}
        />
      </div>
      <Flights flights={flights.flights} onLand={flights.land} />
    </div>
  );
}

/** The game's width (and more) your side of the table goes beside the map at, in a landscape window. */
const BESIDE_WIDTH = 1000;
/** ...and how much wider than tall the window has to be: a tall window has room for the map the whole width. */
const BESIDE_ASPECT = 1.35;
/** Narrower than this, everything is one column (a phone). */
const MIDDLE_WIDTH = 680;

/**
 * Which layout fits (see ticket.css): beside the map in a wide, landscape window, where
 * everything then fits on one screen; otherwise the map takes the whole width, with your
 * side in two columns under it, or one on a phone. Needs the window's shape as well as the
 * game's width, which a container query can't see.
 */
function useLayout(root: RefObject<HTMLDivElement | null>): "beside" | "middle" | "stacked" {
  const [layout, setLayout] = useState<"beside" | "middle" | "stacked">("stacked");
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      const landscape = window.innerWidth / window.innerHeight >= BESIDE_ASPECT;
      setLayout(w >= BESIDE_WIDTH && landscape ? "beside" : w >= MIDDLE_WIDTH ? "middle" : "stacked");
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [root]);
  return layout;
}

/**
 * Cards on the move. Yours fly from where they were (a face-up slot, or the deck) to your
 * hand: whatever your hand gains (in the same game) is a card you took. Someone else's fly
 * to the news under the map, where their move shows up: whatever their card count gains is
 * the end of their latest draw in the log, from the face-up slot that changed (or the deck).
 */
function useCardFlights(view: TtrView, me: string) {
  const { flights, launch, land } = useFlights();
  const from = useRef<{ rect: DOMRect; at: number } | null>(null);
  const before = useRef<{ game: number; hand: Hand | null; faceUp: (CardColor | null)[]; cards: Map<string, number> } | null>(null);
  const { game, players, faceUp, log } = view;
  const hand = view.you.hand;

  useLayoutEffect(() => {
    const prev = before.current;
    before.current = { game, hand, faceUp, cards: new Map(players.map((p) => [p.playerId, p.cards])) };
    if (!prev || prev.game !== game) return;

    if (hand && prev.hand) {
      const gained = CARD_COLORS.flatMap((c) => Array<CardColor>(Math.max(0, hand[c] - prev.hand![c])).fill(c));
      // Only draws (one or two cards); a new deal or anything bigger isn't animated.
      const deck = document.querySelector('[data-testid="ttr-deck"]');
      const start = from.current && Date.now() - from.current.at < 5000 ? from.current.rect : deck?.getBoundingClientRect();
      if (gained.length) from.current = null;
      if (gained.length && gained.length <= 2 && start) {
        launch(
          gained.map((color, i) => {
            const to = document.querySelector(`[data-testid="ttr-hand"] [data-color="${color}"]`)?.getBoundingClientRect();
            return to ? { node: <TrainCard color={color} />, from: start, to, delay: i * 0.12, duration: 0.62, sound: "card" as const } : null;
          }),
        );
      }
    }

    const lines = summarize(log);
    for (const p of players) {
      if (p.playerId === me || p.left) continue;
      const more = p.cards - (prev.cards.get(p.playerId) ?? p.cards);
      const line = lines.at(-1);
      if (more < 1 || more > 2 || line?.type !== "cards" || line.who !== p.playerId) continue;
      const shown = [...document.querySelectorAll('[data-testid="ttr-news"] .ttr-news-line.latest .ttr-story-cards > .ttr-card')];
      const taken = line.cards.slice(-more);
      const used = new Set<number>();
      launch(
        taken.map((card, i) => {
          const target = shown[shown.length - more + i];
          const start = card ? faceUpRect(prev.faceUp, faceUp, card, used) : rectOf('[data-testid="ttr-deck"] .ttr-card');
          if (!target || !start) return null;
          const to = target.getBoundingClientRect();
          const delay = i * 0.12;
          const duration = 0.6;
          // The card in the news shows up as this one lands on it.
          if (!reducedMotion()) target.animate({ opacity: [0, 0] }, { duration: (delay + duration * 0.9) * 1000 });
          return {
            node: (
              <span className="ttr-fly-card" style={{ width: start.width, height: start.height }}>
                {card ? <TrainCard color={card} /> : <CardBack />}
              </span>
            ),
            from: start,
            to,
            scale: [1, to.width / start.width] as [number, number],
            delay,
            duration,
            sound: "card" as const,
          };
        }),
      );
    }
  }, [game, hand, players]);

  return {
    flights,
    takeFrom: (el: Element) => (from.current = { rect: el.getBoundingClientRect(), at: Date.now() }),
    land,
  };
}

/** Where a face-up card someone took was: the slot that had it and changed (a refill can bring the same color back, so else any slot that had it). */
function faceUpRect(was: (CardColor | null)[], now: (CardColor | null)[], card: CardColor, used: Set<number>): DOMRect | null {
  const had = was.flatMap((c, i) => (c === card && !used.has(i) ? [i] : []));
  const slot = had.find((i) => now[i] !== card) ?? had[0];
  if (slot === undefined) return null;
  used.add(slot);
  return rectOf(`[data-testid="ttr-faceup-${slot}"] .ttr-card`);
}

// --- players ------------------------------------------------------------------

function Players({
  view,
  me,
  members,
  connected,
  busy,
  send,
  serverNow,
  onHover,
  hurry,
}: Pick<Props, "view" | "me" | "members" | "connected" | "serverNow"> & {
  busy: boolean;
  send(op: TtrOp): void;
  onHover(playerId: string | null): void;
  /** Your clock is running out. */
  hurry: "urgent" | "racing" | null;
}) {
  const inGame = view.phase !== "lobby";
  return (
    <div className="ttr-players">
      {view.seats.map((seat, i) => {
        const p = inGame ? view.players.find((x) => x.seat === i && !x.left) : undefined;
        if (p)
          return (
            <PlateWithInfo key={i} p={p} view={view} me={me} name={members.get(p.playerId)?.name ?? "Player"} onHover={onHover}>
              <InGamePlate
                p={p}
                view={view}
                me={me}
                name={members.get(p.playerId)?.name ?? "Player"}
                online={members.get(p.playerId)?.online ?? false}
                serverNow={serverNow}
                hurry={p.playerId === me ? hurry : null}
                onBack={p.playerId === me ? () => send({ type: "sitIn" }) : undefined}
              />
            </PlateWithInfo>
          );
        if (seat) {
          return (
            <PlayerPlate
              key={i}
              playerId={seat.playerId}
              name={members.get(seat.playerId)?.name ?? "Player"}
              you={seat.playerId === me}
              online={members.get(seat.playerId)?.online ?? false}
              dim={seat.sittingOut}
              testId={`ttr-seat-${i}`}
            >
              <div className="plate-line status">
                {seat.gamesWon} {seat.gamesWon === 1 ? "win" : "wins"}
                {seat.sittingOut ? " · away" : view.phase === "playing" || view.phase === "choosing" ? " · next game" : ""}
              </div>
            </PlayerPlate>
          );
        }
        // Empty seats only matter when someone can sit down for a game.
        if (view.phase === "playing" || view.phase === "choosing") return null;
        return (
          <div key={i} className="seat-open ttr-seat-open" data-testid={`ttr-seat-${i}`}>
            {view.you.seat === null ? (
              // The whole seat is the button.
              <Button className="ttr-sit" why={busyWhy({ busy, connected })} onClick={() => send({ type: "sit", seat: i })}>
                <span className="ttr-sit-plus" aria-hidden>
                  +
                </span>
                Sit here
              </Button>
            ) : (
              <span className="label">Open seat</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** You're away, and pressing your plate brings you back (rather than explaining it). */
const comesBack = (p: TtrPlayerView, view: TtrView, me: string) => p.playerId === me && view.phase !== "over" && !!view.seats[p.seat]?.sittingOut;

/**
 * A player's plate, which explains itself: hovering it (with a mouse) shows what its
 * numbers mean in a bubble, and pressing it keeps the bubble open, which on a phone is
 * the only way. Hovering also shows their railway on the map.
 */
function PlateWithInfo({ p, view, me, name, onHover, children }: { p: TtrPlayerView; view: TtrView; me: string; name: string; onHover(playerId: string | null): void; children: ReactNode }) {
  const peek = usePeek();
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const pressable = !comesBack(p, view, me);
  return (
    <div
      ref={setAnchor}
      className={`ttr-plate-hover${pressable ? " pressable" : ""}`}
      onMouseEnter={() => onHover(p.playerId)}
      onMouseLeave={() => onHover(null)}
      onPointerEnter={peek.hover.onPointerEnter}
      onPointerLeave={peek.hover.onPointerLeave}
      {...(pressable && {
        role: "button",
        tabIndex: 0,
        "aria-expanded": peek.open,
        "aria-label": `${name}: what the numbers mean`,
        // Only presses on the plate itself: the bubble is portaled, but its clicks still bubble up here through React.
        onClick: (e) => anchor?.contains(e.target as Node) && peek.toggle(),
        onKeyDown: (e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          peek.toggle();
        },
      })}
    >
      {children}
      {peek.open && anchor && (
        <Popover anchor={anchor} label={`${name}: what the numbers mean`} onClose={peek.close} align="left" className="ttr-peek" hover={peek.hover}>
          <PlateInfo p={p} view={view} me={me} name={name} />
        </Popover>
      )}
    </div>
  );
}

/** What a plate's numbers mean, said for this player. */
function PlateInfo({ p, view, me, name }: { p: TtrPlayerView; view: TtrView; me: string; name: string }) {
  const color = usePlayerColors()(p.playerId);
  const you = p.playerId === me;
  const score = view.phase === "over" ? view.result?.scores.find((x) => x.playerId === p.playerId) : undefined;
  const done = you ? view.you.tickets.filter((t) => t.done).length : null;
  const away = view.seats[p.seat]?.playerId === p.playerId && !!view.seats[p.seat]?.sittingOut;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return (
    <div className="ttr-peek-body">
      <p className="ttr-peek-title">
        <PlayerName name={name} color={color} />
        {you && <span className="tag accent">you</span>}
        {away && <span className="tag ttr-away-tag">away</span>}
      </p>
      <ul className="ttr-peek-list">
        <li>
          <span className="ttr-peek-icon">
            <TrainSwatch color={color} />
          </span>
          <span>
            <strong>{plural(p.trains, "train", "trains")}</strong> left to put on the map.{" "}
            {view.finalTurns ? "The last round is on." : "At 2 or fewer, the last round starts."}
          </span>
        </li>
        <li>
          <span className="ttr-peek-icon">
            <span className="ttr-mini-card" />
          </span>
          <span>
            <strong>{plural(p.cards, "train card", "train cards")}</strong> in hand{you ? "" : " (only they see which)"}. Cards of one color claim a route.
          </span>
        </li>
        <li>
          <span className="ttr-peek-icon">
            <span className="ttr-mini-ticket" />
          </span>
          <span>
            <strong>{plural(p.tickets, "ticket", "tickets")}</strong>
            {done !== null && p.tickets > 0 ? `, ${done} done` : ""}. Joining a ticket's two cities scores its points at the end; one not joined loses them.
          </span>
        </li>
        <li>
          <span className="ttr-peek-icon ttr-points">
            <span className="num">{score ? score.total : p.points}</span>
          </span>
          <span>
            {score ? (
              <>
                <strong>{plural(score.total, "point", "points")}</strong> in the end: routes, tickets and the longest railway.
              </>
            ) : (
              <>
                <strong>{plural(p.points, "point", "points")}</strong> from routes so far. Tickets, and +{LONGEST_BONUS} for the longest railway, are added at the end.
              </>
            )}
          </span>
        </li>
      </ul>
      {away && <p className="ttr-peek-away">{you ? "You're away: your turns are played for you. Tap your plate to come back." : "Away: their turns are played for them."}</p>}
    </div>
  );
}

function InGamePlate({
  p,
  view,
  me,
  name,
  online,
  serverNow,
  hurry,
  onBack,
}: {
  p: TtrPlayerView;
  view: TtrView;
  me: string;
  name: string;
  online: boolean;
  serverNow: number;
  hurry: "urgent" | "racing" | null;
  /** Coming back from being away, by tapping your own plate. */
  onBack?(): void;
}) {
  const turn = view.turn === p.seat && view.phase === "playing";
  const seat = view.seats[p.seat];
  const away = seat?.playerId === p.playerId && seat.sittingOut;
  const won = view.phase === "over" && !!view.result?.winners.includes(p.playerId);
  const score = view.phase === "over" ? view.result?.scores.find((x) => x.playerId === p.playerId) : undefined;
  const color = usePlayerColors()(p.playerId);
  const you = p.playerId === me;
  // Away and it's you: the plate is a button that brings you back.
  const back = comesBack(p, view, me) ? onBack : undefined;
  return (
    <PlayerPlate
      playerId={p.playerId}
      name={name}
      you={you}
      online={online}
      active={turn || (view.phase === "choosing" && p.choosing)}
      dim={away && !you}
      winner={won}
      tags={away && !back && <span className="tag ttr-away-tag">away</span>}
      testId={`ttr-seat-${p.seat}`}
      className={`ttr-plate${away ? " away" : ""}${back ? " ttr-plate-back" : ""}${hurry ? ` hurry-${hurry}` : ""}`}
      selectable={!!back}
      onClick={back}
    >
      <div className="ttr-plate-line">
        <div className="ttr-stats">
          <span title="Trains left">
            <TrainSwatch color={color} />
            <span className="num">{p.trains}</span>
          </span>
          <span title="Train cards">
            <span className="ttr-mini-card" />
            <span className="num">{p.cards}</span>
          </span>
          <span title="Tickets">
            <span className="ttr-mini-ticket" />
            <span className="num">{p.tickets}</span>
          </span>
        </div>
        {/* At the end, the final score (tickets and the longest railway counted); before, points from routes. */}
        {score ? (
          <span className="ttr-points final" title="Final score">
            <span className="num">{score.total}</span> pts
          </span>
        ) : (
          <span className="ttr-points" title="Points from routes">
            <span className="num">{p.points}</span> pts
          </span>
        )}
      </div>
      {/* One line for whatever's going on, kept even when empty so every plate is the same size. */}
      <div className="ttr-plate-foot">
        {back ? (
          <div className="plate-line status ttr-back-line">Away: tap to come back</div>
        ) : turn && view.turnDeadline !== null ? (
          <TurnTimer deadline={view.turnDeadline} totalMs={away ? AUTO_PLAY_DELAY_MS : view.config.turnSeconds * 1000} serverNow={serverNow} />
        ) : view.phase === "choosing" && p.choosing ? (
          <div className="plate-line status">choosing tickets</div>
        ) : view.finalTurns?.includes(p.playerId) ? (
          <div className="plate-line status good">last turn</div>
        ) : null}
      </div>
    </PlayerPlate>
  );
}

/** A little train car in the player's color. */
function TrainSwatch({ color }: { color: number }) {
  return <span className="ttr-swatch" style={playerStyle(color)} />;
}

// --- your turn ------------------------------------------------------------------

function Market({
  view,
  turnWhy,
  why,
  send,
  onTake,
}: {
  view: TtrView;
  /** Whose turn it is, when it isn't yours (null on your turn). */
  turnWhy: string | null;
  why: string | null;
  send(op: TtrOp): void;
  /** Where a card is being taken from, for its flight to your hand. */
  onTake(from: Element): void;
}) {
  const second = view.stage === "second";
  const deckLeft = view.deckCount + view.discardCount;
  const stageWhy = view.stage === "tickets" ? "Choose your tickets first." : null;
  const ticketsWhy = view.stage === "second" ? "Take your second card first." : stageWhy;
  return (
    <div className="ttr-market" data-testid="ttr-market">
      <div className="ttr-faceup">
        {view.faceUp.map((c, i) => (
          <Button
            key={i}
            className="ttr-take"
            why={!c ? "There's no card here." : (turnWhy ?? stageWhy ?? (second && c === "loco" ? "A face-up locomotive counts as two cards: take a different one." : why))}
            onClick={(e) => {
              onTake(e.currentTarget);
              blurAfterPointer(e);
              send({ type: "draw", from: i });
            }}
            aria-label={c ? `Take the face-up ${cardName(c)}` : "Empty"}
            data-testid={`ttr-faceup-${i}`}
          >
            <TrainCard color={c} />
          </Button>
        ))}
      </div>
      <Button
        className="ttr-take"
        why={turnWhy ?? stageWhy ?? (deckLeft === 0 ? "The deck is empty." : why)}
        onClick={(e) => {
          onTake(e.currentTarget);
          blurAfterPointer(e);
          send({ type: "draw", from: "deck" });
        }}
        data-testid="ttr-deck"
      >
        <DeckPile count={view.deckCount} label="Deck" />
      </Button>
      <Button
        className="ttr-take ttr-tickets-pile"
        why={turnWhy ?? ticketsWhy ?? (view.ticketCount === 0 ? "There are no tickets left." : why)}
        onClick={(e) => {
          blurAfterPointer(e);
          send({ type: "tickets" });
        }}
        data-testid="ttr-draw-tickets"
      >
        <span className="ttr-ticket-back" />
        <span className="ttr-pile-label">
          Tickets<span className="num">{view.ticketCount}</span>
        </span>
      </Button>
    </div>
  );
}

/**
 * A face-up slot stays the same button while its card changes, so after a tap or click
 * it shouldn't stay focused (a key pressed later would ring it). Keyboard presses keep focus.
 */
function blurAfterPointer(e: MouseEvent<HTMLElement>) {
  if (e.detail > 0) e.currentTarget.blur();
}

function HandView({ hand }: { hand: Hand }) {
  const held = CARD_COLORS.filter((c) => hand[c] > 0);
  return (
    <div className="ttr-hand" data-testid="ttr-hand">
      <span className="label">Your cards</span>
      <div className="ttr-hand-cards">
        {held.length ? held.map((c) => <TrainCard key={c} color={c} count={hand[c]} />) : <span className="muted">No cards.</span>}
      </div>
    </div>
  );
}

/**
 * Choosing how to pay for a route: a bubble by the route (the shared popover, so a zoomed or
 * small map doesn't clip it), with the rest of the board dimmed. Escape, Cancel or a press
 * anywhere else backs out.
 */
function ClaimPopover({ route, hand, why, onPay, onCancel }: { route: Route; hand: Hand; why: string | null; onPay(p: Payment): void; onCancel(): void }) {
  const options = payments(hand, route);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => setAnchor(document.querySelector<HTMLElement>(`.ttr-map [data-route="${route.id}"]`)), [route.id]);
  const points = ROUTE_POINTS[route.length]!;
  if (!anchor) return null;
  return (
    <Popover anchor={anchor} label={`Claim ${routeName(route)}`} onClose={onCancel} align="left" className="ttr-claim">
      <div className="ttr-claim-body" data-testid="ttr-claim">
        <div className="ttr-claim-head">
          <strong>{routeName(route)}</strong>
          <span className="muted">
            {route.length} {route.length === 1 ? "train" : "trains"}, {route.color === "gray" ? "any one color" : route.color} · {points}{" "}
            {points === 1 ? "point" : "points"}
          </span>
        </div>
        <span className="label ttr-pay-heading">Choose</span>
        <div className="ttr-pay">
          {options.map((p) => {
            const colored = route.length - p.locos;
            return (
              <Button key={`${p.color}-${p.locos}`} className="btn ttr-pay-btn" why={why} onClick={() => onPay(p)} data-testid="ttr-pay">
                <span className="ttr-pay-cards">
                  {p.color !== "loco" && <TrainCard color={p.color} count={colored} size="sm" />}
                  {p.locos > 0 && <TrainCard color="loco" count={p.locos} size="sm" />}
                </span>
              </Button>
            );
          })}
        </div>
        <button className="btn ghost small ttr-claim-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Popover>
  );
}

function TicketChoice(props: {
  offered: Ticket[];
  keepAtLeast: number;
  selected: number[];
  onToggle(id: number): void;
  onHover(t: Ticket | null): void;
  deadline: number | null;
  totalMs: number;
  serverNow: number;
  why: string | null;
  onKeep(): void;
}) {
  const n = props.selected.length;
  const short = props.keepAtLeast - n;
  const keepWhy = short > 0 ? (n === 0 ? `Pick at least ${props.keepAtLeast} ${props.keepAtLeast === 1 ? "ticket" : "tickets"} to keep first.` : `Pick ${short} more ${short === 1 ? "ticket" : "tickets"} to keep first.`) : null;
  return (
    <div className="ttr-choose" data-testid="ttr-choose">
      <div className="ttr-choose-head">
        <strong>Choose your tickets</strong>
        <span className="muted">Keep at least {props.keepAtLeast}. Completed tickets score their points; unfinished ones cost them.</span>
      </div>
      <div className="ttr-ticket-row">
        {props.offered.map((t) => (
          <button
            key={t.id}
            className="ttr-ticket-btn"
            aria-pressed={props.selected.includes(t.id)}
            onClick={() => props.onToggle(t.id)}
            onMouseEnter={() => props.onHover(t)}
            onMouseLeave={() => props.onHover(null)}
            onFocus={() => props.onHover(t)}
            onBlur={() => props.onHover(null)}
            data-testid="ttr-offer"
          >
            <TicketCard ticket={t} />
          </button>
        ))}
      </div>
      <div className="ttr-choose-foot">
        <Button className="btn primary" why={keepWhy ?? props.why} onClick={props.onKeep} data-testid="ttr-keep">
          {n === 0
            ? `Pick at least ${props.keepAtLeast}`
            : n < props.keepAtLeast
              ? `Pick ${props.keepAtLeast - n} more`
              : `Keep ${n} ${n === 1 ? "ticket" : "tickets"}`}
        </Button>
        <div className="ttr-choose-timer">
          <TurnTimer deadline={props.deadline} totalMs={props.totalMs} serverNow={props.serverNow} />
        </div>
      </div>
    </div>
  );
}

function TicketCard({ ticket, done }: { ticket: Ticket; done?: boolean }) {
  return (
    <span className={`ttr-ticket${done ? " done" : ""}`}>
      <span className="ttr-ticket-cities">
        {cityName(ticket.a)} – {cityName(ticket.b)}
      </span>
      <span className="ttr-ticket-points num">{ticket.points}</span>
      {done && (
        <span className="ttr-ticket-done" aria-label="completed">
          ✓
        </span>
      )}
    </span>
  );
}

function YourTickets({ tickets, onHover }: { tickets: TicketView[]; onHover(t: Ticket | null): void }) {
  const done = tickets.filter((t) => t.done).length;
  return (
    <div className="ttr-yours box" data-testid="ttr-tickets">
      <span className="label">
        Your tickets · {done} of {tickets.length} done
      </span>
      <div className="ttr-ticket-row">
        {tickets.map((t) => (
          <span key={t.id} onMouseEnter={() => onHover(t)} onMouseLeave={() => onHover(null)}>
            <TicketCard ticket={t} done={t.done} />
          </span>
        ))}
      </div>
    </div>
  );
}

// --- news, results, housekeeping ---------------------------------------------------

/** Log lines: a turn's card draws are one line. */
type Line = TtrEvent | { type: "cards"; who: string; cards: (CardColor | null)[] };

function summarize(log: TtrEvent[]): Line[] {
  const out: Line[] = [];
  for (const e of log) {
    const last = out.at(-1);
    if (e.type === "card" && last?.type === "cards" && last.who === e.who && last.cards.length === 1 && last.cards[0] !== "loco") last.cards.push(e.card);
    else out.push(e.type === "card" ? { type: "cards", who: e.who, cards: [e.card] } : e);
  }
  return out;
}

function describe(e: Line, nameOf: (id: string) => string): string {
  const who = (id: string) => nameOf(id);
  switch (e.type) {
    case "cards": {
      const blind = e.cards.filter((c) => c === null).length;
      const shown = e.cards.filter((c): c is CardColor => c !== null).map((c) => (c === "loco" ? "a locomotive" : `${c === "orange" ? "an" : "a"} ${c} card`));
      const parts = [...shown, ...(blind ? [blind === 1 ? "one from the deck" : `${blind} from the deck`] : [])];
      return `${who(e.who)} took ${parts.join(" and ")}.`;
    }
    case "card":
      return `${who(e.who)} took a card.`;
    case "claim": {
      const r = routeById.get(e.route)!;
      return `${who(e.who)} claimed ${routeName(r)} (${r.length} ${r.length === 1 ? "train" : "trains"}, ${ROUTE_POINTS[r.length]} points).`;
    }
    case "tickets":
      return `${who(e.who)} drew ${e.drew} tickets and kept ${e.kept}.`;
    case "reset":
      return "Three locomotives face up: all five cards were replaced.";
    case "lastRound":
      return `${who(e.who)} ${nameOf(e.who) === "You" ? "have" : "has"} 2 or fewer trains left: last round!`;
    case "pass":
      return `${who(e.who)} couldn't do anything and passed.`;
    case "left":
      return `${who(e.who)} left the game.`;
  }
}

/**
 * The news under the map, always the same height: whose move it is (and the last round),
 * then the last two things that happened, with their cards, a line each (the latest in
 * bold, underneath; a long one is cut short, and the history has it whole). Pressing it
 * opens the whole history.
 */
function News({
  view,
  myTurn,
  away,
  nameOf,
  recent,
  story,
  className,
  onOpen,
}: {
  view: TtrView;
  myTurn: boolean;
  away: boolean;
  nameOf(id: string): string;
  /** The last two lines of the log, oldest first. */
  recent: Line[];
  story(line: Line): ReactNode;
  className: string;
  onOpen(): void;
}) {
  const current = view.players.find((p) => p.seat === view.turn && !p.left);
  const status =
    view.phase === "choosing"
      ? view.you.offered
        ? "Choose your tickets"
        : "Everyone's choosing their tickets…"
      : view.phase === "over"
        ? "Game over"
        : myTurn
          ? away
            ? "Your turn (you're away)"
            : "Your turn"
          : current
            ? `${nameOf(current.playerId)} ${view.stage === "tickets" ? "is choosing tickets" : "is playing"}…`
            : null;
  return (
    <Herald testId="ttr-news" className={`ttr-news ${className}`} onClick={onOpen} label="What happened: show the history">
      <span className="ttr-news-status">
        <span className={`ttr-news-turn${myTurn || (view.phase === "choosing" && view.you.offered) ? " mine" : ""}`} data-testid="ttr-status">
          {status}
          {view.finalTurns && (
            <span className="ttr-last-round">
              {" "}
              · Last round: {view.finalTurns.length} {view.finalTurns.length === 1 ? "turn" : "turns"} to go
            </span>
          )}
        </span>
        <span className="ttr-news-more" aria-hidden>
          History
          <svg viewBox="0 0 12 12">
            <path d="M3 4.5 6 7.5 9 4.5" />
          </svg>
        </span>
      </span>
      {view.phase === "choosing" || !recent.length ? (
        <span className="ttr-news-line latest">
          {view.phase === "choosing" ? `Game ${view.game}: everyone picks their first tickets at once.` : `Game ${view.game} is on. Good luck!`}
        </span>
      ) : (
        recent.map((line, i) => (
          <span key={i} className={`ttr-news-line${i === recent.length - 1 ? " latest" : ""}`}>
            {story(line)}
          </span>
        ))
      )}
    </Herald>
  );
}

/** "Bob took [red] [card back]": the cards drawn, face up ones in color, blind ones as backs (yours in color). */
function CardsStory({ line, nameOf, blind }: { line: Extract<Line, { type: "cards" }>; nameOf(id: string): string; blind: CardColor[] }) {
  const hidden = line.cards.filter((c) => c === null).length;
  // Only when they're this draw's cards (the count matches): a new turn starts with none drawn.
  const seen = blind.length === hidden ? blind : [];
  let k = 0;
  return (
    <>
      <span className="ttr-story-text">{nameOf(line.who)} took</span>
      <span className="ttr-story-cards">
        {line.cards.map((c, i) => {
          const card = c ?? seen[k++] ?? null;
          return card ? <TrainCard key={i} color={card} size="xs" /> : <CardBack key={i} size="xs" title="From the deck" />;
        })}
      </span>
      {hidden > 0 && (
        <span className="ttr-story-note">{hidden === line.cards.length ? (hidden === 1 ? "from the deck" : "both from the deck") : "one from the deck"}</span>
      )}
    </>
  );
}

/** "Ann claimed Seattle–Helena with [cards] · 15 points": the cards paid are shown, as at the table. */
function ClaimStory({ e, nameOf }: { e: Extract<Line, { type: "claim" }>; nameOf(id: string): string }) {
  const r = routeById.get(e.route)!;
  const cards: CardColor[] = [...Array<CardColor>(r.length - e.locos).fill(e.color), ...Array<CardColor>(e.locos).fill("loco")];
  return (
    <>
      <span className="ttr-story-text">
        {nameOf(e.who)} claimed {routeName(r)} with
      </span>
      <span className="ttr-story-cards">
        {cards.map((c, i) => (
          <TrainCard key={i} color={c} size="xs" />
        ))}
      </span>
      <span className="ttr-story-note">
        {ROUTE_POINTS[r.length]} {ROUTE_POINTS[r.length] === 1 ? "point" : "points"}
      </span>
    </>
  );
}

/** The end: everyone's score (routes, tickets, the longest railway), over the map. */
function Result({ view, me, name, start, why }: { view: TtrView; me: string; name(id: string): string; start: (() => void) | null; why: string | null }) {
  const result = view.result;
  const ranked = result ? [...result.scores].sort((a, b) => b.total - a.total) : [];
  const winners = result?.winners ?? [];
  const longest = ranked.find((s) => s.bonus > 0);
  const title = winners.includes(me) ? (winners.length > 1 ? "You share the win!" : "You win!") : `${winners.map(name).join(" & ")} ${winners.length > 1 ? "share the win!" : "wins!"}`;
  return (
    <GameOver
      open={view.phase === "over" && !!result}
      gameKey={view.game}
      me={me}
      testId="ttr-result"
      className="ttr-result"
      title={title}
      subtitle={
        ranked[0] && (
          <>
            {ranked[0].total} points
            {longest && ` · longest railway: ${longest.playerId === me ? "you" : name(longest.playerId)} (${longest.longest} trains, +${longest.bonus})`}
          </>
        )
      }
      columns={["Total"]}
      rows={ranked.map((s) => ({
        playerId: s.playerId,
        name: name(s.playerId),
        winner: winners.includes(s.playerId),
        left: s.left,
        cells: [s.total],
        detail: <FinalScore s={s} />,
      }))}
      actions={
        start && (
          <Button className="btn primary" why={why} onClick={start}>
            Play again
          </Button>
        )
      }
    />
  );
}

/** How a final score adds up (routes, tickets, the longest railway), and the tickets, as little tickets. */
function FinalScore({ s }: { s: NonNullable<TtrView["result"]>["scores"][number] }) {
  const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");
  // Finished tickets first, then the missed ones; biggest first within each.
  const tickets = [...s.tickets].sort((a, b) => Number(b.done) - Number(a.done) || ticketById.get(b.id)!.points - ticketById.get(a.id)!.points);
  return (
    <span className="ttr-final">
      <span className="ttr-final-parts">
        <span className="ttr-part">
          Routes <b className="num">{s.routePoints}</b>
        </span>
        <span className={`ttr-part${s.ticketPoints < 0 ? " minus" : ""}`}>
          Tickets <b className="num">{signed(s.ticketPoints)}</b>
        </span>
        <span className={`ttr-part${s.bonus ? " bonus" : ""}`} title={s.bonus ? "The longest railway" : undefined}>
          Longest <b className="num">{s.longest}</b>
          {s.bonus > 0 && <b className="num ttr-part-bonus">+{s.bonus}</b>}
        </span>
      </span>
      {tickets.length > 0 && (
        <span className="ttr-final-tickets">
          {tickets.map((t) => {
            const ticket = ticketById.get(t.id)!;
            return (
              <span key={t.id} className={`ttr-mini-tix ${t.done ? "done" : "missed"}`} title={t.done ? "Completed" : "Not completed"}>
                <span className="cities">
                  {cityName(ticket.a)}–{cityName(ticket.b)}
                </span>
                <span className="pts num">{signed(t.done ? ticket.points : -ticket.points)}</span>
              </span>
            );
          })}
        </span>
      )}
    </span>
  );
}

function Status({ view }: { view: TtrView }) {
  const seat = view.you.seat;
  const s = seat === null ? null : view.seats[seat];
  const running = view.phase === "playing" || view.phase === "choosing";
  if (view.phase === "choosing" && view.you.inGame) return <span className="muted">Waiting for the others to choose their tickets…</span>;
  if (view.seats.filter(Boolean).length < 2) return <span className="muted">Waiting for players to sit down…</span>;
  if (!s && running) return <span className="muted">You're watching. Take an open seat to play the next game.</span>;
  if (s && !view.you.inGame && running) return <span className="muted">You're in the next game.</span>;
  if (!s) return <span className="muted">Take an open seat to play.</span>;
  return null;
}

/** The big buttons: start, play again, come back. */
function Controls({ view, connected, busy, send }: { view: TtrView; connected: boolean; busy: boolean; send(op: TtrOp): void }) {
  const seat = view.you.seat;
  const s = seat === null ? null : view.seats[seat];
  const why = busyWhy({ busy, connected });
  if (!s) return null;
  return (
    <>
      {view.canStart && view.phase !== "over" && (
        <Button className="btn primary" why={why} onClick={() => send({ type: "start" })} data-testid="ttr-start">
          {view.game === 0 ? "Start" : "Play again"}
        </Button>
      )}
      {/* Away from a game that's on: the notice at the top of the tray has "I'm back". */}
      {s.sittingOut && !(view.you.inGame && (view.phase === "playing" || view.phase === "choosing")) && (
        <Button className="btn" why={why} onClick={() => send({ type: "sitIn" })}>
          I'm back
        </Button>
      )}
    </>
  );
}

/** Quiet housekeeping under the map: step away, leave. */
function SeatActions({ view, connected, busy, send }: { view: TtrView; connected: boolean; busy: boolean; send(op: TtrOp): void }) {
  const seat = view.you.seat;
  const s = seat === null ? null : view.seats[seat];
  const why = busyWhy({ busy, connected });
  const running = view.phase === "playing" || view.phase === "choosing";
  if (!s) return null;
  return (
    <>
      {!s.sittingOut && running && view.you.inGame && (
        <Button className="btn ghost small" why={why} onClick={() => send({ type: "sitOut" })}>
          Step away
        </Button>
      )}
      <Button className="btn ghost small" why={why} onClick={() => send({ type: "leave" })}>
        {running && view.you.inGame ? "Leave game" : "Leave seat"}
      </Button>
    </>
  );
}
