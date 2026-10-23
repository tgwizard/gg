/**
 * A provider-neutral LLM client, for bots. Everything runs in the browser: API keys
 * live in localStorage, and requests go straight from the tab to the provider. gg's
 * server never sees them.
 */

export type Provider = "openai" | "anthropic" | "meta";

export type Effort = "low" | "medium" | "high";

export interface LLMMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LLMRequest {
  model: string;
  /** System-level guidance (the bot's rules and persona). */
  instructions?: string;
  messages: LLMMessage[];
  maxOutputTokens?: number;
  /** How hard the model should think, on models that support it. */
  effort?: Effort;
  signal?: AbortSignal;
  /** Called with each piece of text as it streams in. */
  onText?(delta: string): void;
}

export interface LLMResult {
  text: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface LLMModel {
  id: string;
  name: string;
}

export interface LLMClient {
  listModels(signal?: AbortSignal): Promise<LLMModel[]>;
  generate(req: LLMRequest): Promise<LLMResult>;
}

export type LLMErrorCode =
  | "auth" // a bad or revoked key: the user has to fix it
  | "rate_limit"
  | "refused"
  | "bad_request" // e.g. a model this connection can't use
  | "network"
  | "server"
  | "cancelled";

export class LLMError extends Error {
  constructor(
    readonly code: LLMErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LLMError";
  }

  get retryable(): boolean {
    return this.code === "rate_limit" || this.code === "network" || this.code === "server";
  }
}

/** An LLMError for an HTTP failure, keeping the provider's message when it has one. */
export function httpError(status: number | undefined, detail?: string): LLMError {
  const suffix = detail ? `: ${detail}` : "";
  if (status === 401 || status === 403) return new LLMError("auth", `Not authorized${suffix}`, status);
  if (status === 429) return new LLMError("rate_limit", `Rate or usage limit reached${suffix}`, status);
  if (status !== undefined && status >= 500) return new LLMError("server", `The provider had a problem${suffix}`, status);
  return new LLMError("bad_request", `Request failed${suffix}`, status);
}

/** A pasted API key, billed to the user's own account with that provider. */
export interface Connection {
  id: string;
  provider: Provider;
  /** What the user sees, e.g. "Anthropic API key sk-…f3a9". */
  label: string;
  addedAt: string;
  apiKey: string;
  /** The model picked for this connection. */
  model?: string;
  /** How hard it thinks; low when unset. */
  effort?: Effort;
}
