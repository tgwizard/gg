/** The Anthropic Messages API with a user's own API key. */
import Anthropic from "@anthropic-ai/sdk";
import { httpError, type LLMClient, LLMError } from "./types";

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
          messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
          ...(req.effort ? { output_config: { effort: req.effort } } : {}),
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
        for (const block of message.content) if (block.type === "text") text += block.text;
        return { text, usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens } };
      });
    },
  };
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
