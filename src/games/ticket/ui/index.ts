import { turnTimerSetting } from "../../kit/ui/settings";
import type { GameUI } from "../../ui";
import type { TtrView } from "../engine";
import { ticketMeta } from "../meta";
import { TicketGame } from "./TicketGame";
import { TicketSetup } from "./TicketSetup";

export const ticketUI: GameUI = {
  meta: ticketMeta,
  icon: "/icons/coast.jpg",
  Game: TicketGame,
  Setup: TicketSetup,
  settings: ({ config, bothTracks, phase }: TtrView) => [
    turnTimerSetting(config.turnSeconds, "Run out and your turn is played for you (two cards from the deck), and you're marked away."),
    ...(phase === "lobby"
      ? []
      : [{ label: "Double routes", value: bothTracks ? "Both tracks" : "One track", hint: "With 2–3 players only one track of each double route can be used; with 4–5 both can, but not by the same player." }]),
  ],
};
