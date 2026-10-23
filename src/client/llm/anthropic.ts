/** The Anthropic Messages API with a user's own API key. */
import Anthropic from "@anthropic-ai/sdk";
import { httpError, type LLMClient, LLMError, type LLMMessage } from "./types";

/** Models that take server-side refusal fallbacks (re-run a declined request on another model). */
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

export function anthropicClient(apiKey: string): LLMClient {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  return {
    async listModels(signal) {
      return wrap(async () => {
        const models = [];
        for await (const m of client.models.list({}, { signal })) models.push({ id: m.id, name: m.display_name });
        return models;
      });
    },

    async generate(req) {
      return wrap(async () => {
        const params = {
          model: req.model,
          max_tokens: req.maxOutputTokens ?? 16000,
          ...(req.instructions !== undefined ? { system: req.instructions } : {}),
          messages: req.messages.map(toParam),
          ...(req.tools?.length ? { tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters as Anthropic.Tool.InputSchema })) } : {}),
          ...(req.effort ? { output_config: { effort: req.effort } } : {}),
          // Moves the cache marker to the end of the conversation on every request.
          ...(req.cache ? { cache_control: { type: "ephemeral" as const } } : {}),
        };
        const onText = (delta: string) => req.onText?.(delta);
        let message: Anthropic.Message | Anthropic.Beta.BetaMessage;
        if (FALLBACK_MODELS.has(req.model)) {
          const stream = client.beta.messages.stream(
            { ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" },
            { signal: req.signal },
          );
          message = await stream.on("text", onText).finalMessage();
        } else {
          message = await client.messages.stream(params, { signal: req.signal }).on("text", onText).finalMessage();
        }
        if (message.stop_reason === "refusal") throw new LLMError("refused", "The model declined this request.");
        let text = "";
        const toolCalls = [];
        for (const block of message.content) {
          if (block.type === "text") text += block.text;
          if (block.type === "tool_use") toolCalls.push({ id: block.id, name: block.name, input: block.input });
        }
        const { input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens } = message.usage;
        return {
          text,
          toolCalls,
          message: { role: "assistant", content: text, native: message.content },
          usage: {
            inputTokens: input_tokens + (cache_read_input_tokens ?? 0) + (cache_creation_input_tokens ?? 0),
            outputTokens: output_tokens,
            cachedInputTokens: cache_read_input_tokens ?? 0,
          },
        };
      });
    },
  };
}

/** One conversation turn as a Messages API message; tool results go first in a user turn. */
function toParam(m: LLMMessage): Anthropic.MessageParam {
  if (m.role === "assistant" && Array.isArray(m.native)) return { role: "assistant", content: m.native as Anthropic.ContentBlockParam[] };
  if (typeof m.content === "string") return { role: m.role, content: m.content };
  const results: Anthropic.ContentBlockParam[] = [];
  const rest: Anthropic.ContentBlockParam[] = [];
  for (const p of m.content) {
    if (p.type === "tool_result") results.push({ type: "tool_result", tool_use_id: p.callId, content: p.content, ...(p.isError ? { is_error: true } : {}) });
    else if (p.type === "tool_call") rest.push({ type: "tool_use", id: p.id, name: p.name, input: p.input });
    else rest.push({ type: "text", text: p.text });
  }
  return { role: m.role, content: [...results, ...rest] };
}

async function wrap<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof LLMError) throw e;
    if (e instanceof Anthropic.APIUserAbortError) throw new LLMError("cancelled", "Cancelled.");
    if (e instanceof Anthropic.APIConnectionError) throw new LLMError("network", "Couldn't reach Anthropic.");
    if (e instanceof Anthropic.APIError) {
      const detail = (e.error as { error?: { message?: string } } | undefined)?.error?.message;
      throw httpError(e.status, detail ?? e.message);
    }
    throw e;
  }
}
