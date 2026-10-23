/**
 * The OpenAI Responses API, for an OpenAI API key and for other providers that speak
 * it (Meta's Model API).
 */
import OpenAI from "openai";
import { httpError, type LLMClient, LLMError, type LLMModel } from "./types";

export const OPENAI_API = "https://api.openai.com/v1";
export const META_API = "https://api.meta.ai/v1";

export function openAIClient(opts: {
  /** Defaults to OpenAI's. */
  baseURL?: string;
  /** Who to blame in network errors. */
  providerName?: string;
  apiKey: string;
  listModels(apiKey: string, signal?: AbortSignal): Promise<LLMModel[]>;
}): LLMClient {
  const client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL ?? OPENAI_API, dangerouslyAllowBrowser: true });

  return {
    async listModels(signal) {
      return wrap(async () => opts.listModels(opts.apiKey, signal), opts.providerName);
    },

    async generate(req) {
      return wrap(async () => {
        const stream = await client.responses.create(
          {
            model: req.model,
            ...(req.instructions !== undefined ? { instructions: req.instructions } : {}),
            input: req.messages.map((m) => ({ role: m.role, content: m.content })),
            ...(req.maxOutputTokens ? { max_output_tokens: req.maxOutputTokens } : {}),
            ...(req.effort ? { reasoning: { effort: req.effort } } : {}),
            store: false,
            stream: true,
          },
          { signal: req.signal },
        );
        let text = "";
        for await (const event of stream) {
          if (event.type === "response.output_text.delta") {
            text += event.delta;
            req.onText?.(event.delta);
          } else if (event.type === "response.completed") {
            const usage = event.response.usage;
            return { text, ...(usage ? { usage: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens } } : {}) };
          } else if (event.type === "response.failed") {
            throw new LLMError("server", event.response.error?.message ?? "The response failed.");
          } else if (event.type === "response.incomplete") {
            throw new LLMError("server", `The response stopped early (${event.response.incomplete_details?.reason ?? "unknown reason"}).`);
          } else if (event.type === "error") {
            throw new LLMError("server", event.message);
          }
        }
        throw new LLMError("network", "The response ended before it completed.");
      }, opts.providerName);
    },
  };
}

/**
 * Text models on an OpenAI API key, newest GPTs first. The catalog also has audio,
 * image, embedding and live models, and a dated snapshot of each model, which we skip.
 */
export async function listPlatformModels(apiKey: string, signal?: AbortSignal): Promise<LLMModel[]> {
  const client = new OpenAI({ apiKey, baseURL: OPENAI_API, dangerouslyAllowBrowser: true });
  const ids: string[] = [];
  for await (const m of client.models.list({ signal })) ids.push(m.id);
  return platformTextModels(ids).map((id) => ({ id, name: id }));
}

export function platformTextModels(ids: string[]): string[] {
  const keep = ids.filter(
    (id) =>
      /^(gpt-|o\d)/.test(id) &&
      !/audio|realtime|live|tts|transcribe|image|embedding|search|instruct/.test(id) &&
      !/-\d{4}-\d{2}-\d{2}$|-\d{4}$|^gpt-3\.5|-16k$/.test(id),
  );
  const rank = (id: string) => (id.startsWith("gpt-") ? 0 : 1);
  return keep.sort((a, b) => rank(a) - rank(b) || b.localeCompare(a, "en", { numeric: true }));
}

/** Meta's chat models, newest first; its catalog also has image, voice and vision models. */
export async function listMetaModels(apiKey: string, signal?: AbortSignal): Promise<LLMModel[]> {
  const client = new OpenAI({ apiKey, baseURL: META_API, dangerouslyAllowBrowser: true });
  const ids: string[] = [];
  for await (const m of client.models.list({ signal })) ids.push(m.id);
  return metaTextModels(ids).map((id) => ({ id, name: id }));
}

export function metaTextModels(ids: string[]): string[] {
  // "-contributor" variants come after the plain one of the same version.
  return ids
    .filter((id) => id.startsWith("muse-spark-"))
    .sort((a, b) => b.replace(/-contributor$/, "").localeCompare(a.replace(/-contributor$/, ""), "en", { numeric: true }) || a.length - b.length);
}

/** Map SDK errors onto LLMError; let our own through. */
async function wrap<T>(fn: () => Promise<T>, provider = "OpenAI"): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof LLMError) throw e;
    if (e instanceof OpenAI.APIUserAbortError) throw new LLMError("cancelled", "Cancelled.");
    if (e instanceof OpenAI.APIConnectionError) throw new LLMError("network", `Couldn't reach ${provider}.`);
    if (e instanceof OpenAI.APIError) {
      const detail = (e.error as { message?: string; detail?: string } | undefined) ?? {};
      throw httpError(e.status, detail.message ?? detail.detail ?? e.message);
    }
    throw e;
  }
}
