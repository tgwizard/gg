/**
 * What an AI bot is told. Built so the conversation only ever grows at the end, which
 * keeps nearly every request a cache hit:
 *
 *   instructions: how to be a bot in gg, the persona, then the game's rules (fixed per bot and game)
 *   tool:         `act`, whose `op` is the game's own moves as JSON Schema (fixed per game)
 *   messages:     one update per wake-up (chat and game news since the last one, the
 *                 bot's view if it changed, and its legal moves), each answered by an
 *                 `act` call, whose result opens the next update.
 */
import { z } from "zod";
import { isLobbyOp } from "../../../games/kit/lobby";
import { gameMetas } from "../../../games/metas";
import type { AnyGameDefinition } from "../../../games/types";
import type { ChatMessage } from "../../../shared/protocol";
import type { LLMTool } from "../../llm/types";

export const ACT = "act";
export const MAX_SAY = 280;

const GAME_NAMES = gameMetas.map((m) => m.name).join(", ");

const TABLE_MOVES = new Set(["sit", "leave", "sitOut", "sitIn", "start"]);

/** For a game, or with `def` null, for the room between games (chat only). */
export function instructions(def: AnyGameDefinition | null, bot: { name: string; persona?: string }): string {
  const persona = bot.persona?.trim() || "Friendly, a little playful, and a good sport.";
  const intro = `You are ${bot.name}, a bot in a room on gg, a small website for playing games with friends. The room has a shared chat, and people (and maybe other bots) pick games to play together.`;
  if (!def) {
    return [
      intro,
      `Your personality: ${persona}`,
      "",
      "No game is being played right now; someone in the room picks one. Until then you can chat.",
      `- You get an update whenever something happens in the room. Answer every update by calling the \`${ACT}\` tool exactly once. Text outside the tool isn't shown to anyone.`,
      "- `say` writes one short message in the room chat (a sentence, casual, in the language people are using). Reply when someone talks to you; otherwise speak up only now and then.",
      "- Call it with nothing to pass: that's the right answer to most updates when nobody's talking to you.",
      `- The games here: ${GAME_NAMES}. You can play any of them once someone starts one.`,
    ].join("\n");
  }
  return [
    `${intro} Right now you're playing ${def.meta.name}.`,
    `Your personality: ${persona}`,
    "",
    "How it works:",
    `- You get an update whenever something happens: chat messages, game news, your current view of the game, and the moves you can make. Answer every update by calling the \`${ACT}\` tool exactly once. Text outside the tool isn't shown to anyone.`,
    "- `op` makes a move. Only make one when the update lists legal moves, and pick one of them (copy it exactly; for open-ended moves like bet sizes, you may change the number within the allowed range). If it's not accepted, you'll be told why and can try again.",
    "- `say` writes one short message in the room chat (a sentence, casual, in the language people are using). Reply when someone talks to you. Otherwise speak up only now and then, when something worth reacting to happens. Never reveal hidden information, like your cards.",
    "- Call it with neither to pass: that's the right answer to most updates when it isn't your move and nobody's talking to you.",
    "- Sitting down and leaving the table are handled for you. Play to win, at your own pace.",
    "",
    `The game: ${def.meta.name}`,
    def.meta.rules,
    ...(def.meta.botNotes ? ["", def.meta.botNotes] : []),
  ].join("\n");
}

/** The one tool: a move from the game's own schema (table moves left out), and/or something to say. */
export function actTool(def: AnyGameDefinition | null): LLMTool {
  const say = { type: "string", maxLength: MAX_SAY, description: "A short chat message for the room." };
  if (!def) {
    return {
      name: ACT,
      description: "Say something in the room chat, or call with nothing to pass.",
      parameters: { type: "object", properties: { say }, additionalProperties: false },
    };
  }
  const schema = z.toJSONSchema(def.opSchema) as { oneOf?: Record<string, unknown>[]; anyOf?: Record<string, unknown>[] };
  const options = (schema.oneOf ?? schema.anyOf ?? [schema]).filter((option) => {
    const type = (option.properties as { type?: { const?: string } } | undefined)?.type?.const;
    return !type || !TABLE_MOVES.has(type);
  });
  return {
    name: ACT,
    description: "Make a move, say something in the room chat, both, or neither (to pass).",
    parameters: {
      type: "object",
      properties: {
        op: { description: "A move: one of the legal moves listed in the latest update.", anyOf: options },
        say,
      },
      additionalProperties: false,
    },
  };
}

export interface Update {
  chat: ChatMessage[];
  /** The bot's view, when it changed since the last update. */
  view?: unknown;
  /** Game moves it can make now (table moves left out); empty when it isn't its move. */
  moves: unknown[];
  /** The player ids and names it should know by. */
  names: Map<string, string>;
  you: string;
  /** A nudge when it passed on its own move. */
  reminder?: string;
  /** False between games. */
  inGame?: boolean;
}

/** One wake-up's worth of news, as the text of a user turn. */
export function updateText(u: Update): string {
  const parts: string[] = [];
  if (u.chat.length) {
    const lines = u.chat.map((m) => {
      const time = new Date(m.ts).toTimeString().slice(0, 5);
      if (m.kind === "user") return `${time} ${m.playerId === u.you ? "You" : (m.name ?? "Someone")}: ${m.text}`;
      return `${time} (${m.kind === "game" ? "game" : "room"}) ${m.text}`;
    });
    parts.push(["Room chat and news since last time:", ...lines].join("\n"));
  }
  if (u.view !== undefined) {
    const people = [...u.names].map(([id, name]) => `${id} = ${id === u.you ? `${name} (you)` : name}`).join(", ");
    parts.push(`Your view of the game (player ids: ${people}):\n${JSON.stringify(u.view)}`);
  }
  if (u.moves.length) parts.push(`It's your move. Legal moves:\n${u.moves.map((m) => JSON.stringify(m)).join("\n")}`);
  else if (u.inGame !== false) parts.push("It isn't your move right now: you can say something or pass.");
  else parts.push("You can say something or pass.");
  if (u.reminder) parts.push(u.reminder);
  return parts.join("\n\n");
}

/** The game moves among the legal ops (table moves are handled for the bot). */
export function gameMoves(legalOps: unknown[]): unknown[] {
  return legalOps.filter((op) => !isLobbyOp(op));
}

/** Check what the model asked for before acting on it. */
export function parseAct(def: AnyGameDefinition | null, input: unknown): { op?: unknown; say?: string; error?: string } {
  const raw = (typeof input === "object" && input !== null ? input : {}) as { op?: unknown; say?: unknown; __invalid?: string };
  if (raw.__invalid !== undefined) return { error: "Couldn't read the tool call's arguments as JSON." };
  const say = typeof raw.say === "string" && raw.say.trim() ? raw.say.trim().slice(0, MAX_SAY) : undefined;
  if (raw.op === undefined || raw.op === null) return { say };
  if (!def) return { say, error: "No game is being played." };
  if (isLobbyOp(raw.op)) return { say, error: "Sitting down and leaving are handled for you; pick a game move." };
  const parsed = def.opSchema.safeParse(raw.op);
  if (!parsed.success) return { say, error: `That isn't a valid move: ${parsed.error.issues[0]?.message ?? "wrong shape"}.` };
  return { op: parsed.data, say };
}
