import { useState } from "react";
import { type BotRecord, type BotSetup } from "../bots/store";
import { defaultModel, EFFORTS, getConnection, PROVIDERS, useConnections, useModels } from "../llm/connections";
import type { Effort, Usage } from "../llm/types";
import { ProfileForm } from "./Profile";
import { SettingsLink } from "./SettingsLink";

/** "Built-in bot · no AI", "AI bot · muse-spark-1.3 · low effort". */
export function botCaption(bot: BotSetup): string {
  if (bot.level !== "ai" || !bot.connectionId) return "Built-in bot · no AI";
  const model = bot.model ?? getConnection(bot.connectionId)?.model;
  return ["AI bot", model, `${bot.effort ?? "low"} effort`].filter(Boolean).join(" · ");
}

/**
 * A bot's setup: name and color, a personality, and how it plays: built-in (no AI), or
 * with one of your AI connections. Editing also shows what it has used.
 */
export function BotForm(props: {
  initial: BotSetup;
  bot?: BotRecord;
  submitLabel: string;
  taken?: ReadonlyMap<number, string>;
  /** A line above the form. */
  intro?: string;
  /** On the settings page itself: no link to it. */
  inSettings?: boolean;
  onSubmit(setup: BotSetup): void;
  onCancel(): void;
}) {
  const connections = useConnections();
  const [plays, setPlays] = useState(props.initial.level === "ai" && props.initial.connectionId ? props.initial.connectionId : "easy");
  const [persona, setPersona] = useState(props.initial.persona ?? "");
  const connection = connections.find((c) => c.id === plays);
  const models = useModels(connection);
  // Unless chosen, the cheapest model at low effort.
  const [picked, setPicked] = useState(props.initial.level === "ai" ? props.initial.model : undefined);
  const [effort, setEffort] = useState<Effort>(props.initial.effort ?? "low");
  const model =
    picked && (!models || models.includes(picked))
      ? picked
      : connection && models
        ? defaultModel(connection.provider, models.map((id) => ({ id, name: id })))
        : undefined;
  const usage = props.bot?.usage;
  return (
    <ProfileForm
      name={props.initial.name}
      color={props.initial.color}
      whose="Bot"
      bot
      caption={connection ? `AI bot · ${model ?? "…"} · ${effort} effort` : "Built-in bot · no AI"}
      submitLabel={props.submitLabel}
      taken={props.taken}
      onSubmit={(name, color) =>
        props.onSubmit(connection ? { name, color, level: "ai", connectionId: connection.id, model, effort, persona } : { name, color, level: "easy", persona })
      }
      onCancel={props.onCancel}
      intro={props.intro}
    >
      <label className="field">
        <span>
          Personality <span className="hint">optional, and everyone sees it</span>
        </span>
        <textarea
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
          rows={2}
          maxLength={300}
          placeholder="e.g. A grumpy old sea captain who hates losing"
        />
      </label>
      <label className="field">
        <span>Plays</span>
        <select
          value={connection ? plays : "easy"}
          onChange={(e) => {
            setPlays(e.target.value);
            setPicked(undefined);
          }}
        >
          <option value="easy">Built-in, without AI</option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              AI · {c.label}
            </option>
          ))}
        </select>
      </label>
      {connection && (
        <div className="bot-form-pick">
          <label className="field">
            <span>Model</span>
            <select value={model ?? ""} onChange={(e) => setPicked(e.target.value)} disabled={!models}>
              {!models && <option value={model ?? ""}>{model ?? "Loading…"}</option>}
              {models?.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Effort</span>
            <select value={effort} onChange={(e) => setEffort(e.target.value as Effort)}>
              {EFFORTS.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <p className="muted small bot-form-note">
        {connection ? "It plays the part, in the chat and at the table. " : "Built-in bots don't talk; give it AI to have it play the part. "}
        It plays from this browser while you have its room open, and is away while you're not.{props.bot && " Changes apply in every room it's in."}{" "}
        {!props.inSettings && <SettingsLink tab="bots">{connections.length ? "Your bots and AI keys" : "Add an AI key"}</SettingsLink>}
      </p>
      {connection && (
        <p className="muted small bot-form-note">
          {PROVIDERS[connection.provider].billing} The room's chat and its view of the game (its own cards too) go to {PROVIDERS[connection.provider].short}, and only its moves and
          messages to the room. It's told to keep its cards to itself, but people in the chat can try to talk it out of that.
        </p>
      )}
      {usage && (
        <p className="muted small bot-form-note" data-testid="bot-usage">
          {usedSoFar(usage)}
        </p>
      )}
      {props.bot?.standIns && connection && (
        <p className="muted small bot-form-note" data-testid="bot-stand-ins">
          The built-in bot made {props.bot.standIns.count} {props.bot.standIns.count === 1 ? "move" : "moves"} for it; the last at{" "}
          {new Date(props.bot.standIns.lastAt).toTimeString().slice(0, 5)}, because {props.bot.standIns.lastWhy}.
        </p>
      )}
      {props.bot?.error && (
        <p className="bot-form-error small" role="alert">
          {props.bot.error}
        </p>
      )}
    </ProfileForm>
  );
}

/** "Used so far: 12.3k tokens in (9.1k cached), 840 out, over 14 calls." */
export function usedSoFar(u: Usage): string {
  return `Used so far: ${tokens(u.input)} tokens in (${tokens(u.cachedInput)} cached), ${tokens(u.output)} out, over ${u.calls} ${u.calls === 1 ? "call" : "calls"}.`;
}

/** 950, 12.3k, 1.2M. */
export function tokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
