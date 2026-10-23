/**
 * The user's LLM connections (API keys), kept in localStorage only. `clientFor` turns
 * one into an LLMClient; the provider SDKs load on first use.
 */
import { useSyncExternalStore } from "react";
import { storage } from "../storage";
import type { Connection, LLMClient, LLMModel, Provider } from "./types";

const KEY = "gg.llm.connections";
const EVENT = "gg:llm";

export const PROVIDERS: Record<Provider, { name: string; billing: string; cheapest(ids: string[]): string | undefined }> = {
  // Model lists come newest first, so these pick the newest of the cheapest line.
  openai: { name: "OpenAI API", billing: "Billed to your OpenAI API account.", cheapest: (ids) => ids.find((id) => id.endsWith("-luna")) ?? ids.find((id) => id.includes("nano")) },
  anthropic: { name: "Anthropic API", billing: "Billed to your Anthropic API account.", cheapest: (ids) => ids.find((id) => id.includes("haiku")) },
  meta: { name: "Meta Model API", billing: "Billed to your Meta developer account.", cheapest: (ids) => ids.find((id) => id.endsWith("-contributor")) },
};

/** The model a new connection starts on: the provider's cheapest, else its newest. */
export function defaultModel(provider: Provider, models: LLMModel[]): string | undefined {
  const ids = models.map((m) => m.id);
  return PROVIDERS[provider].cheapest(ids) ?? ids[0];
}

// Parsed once per stored value, so useSyncExternalStore sees a stable snapshot.
let cache: { raw: string | null; list: Connection[] } = { raw: null, list: [] };

export function getConnections(): Connection[] {
  const raw = storage.get(KEY);
  if (raw !== cache.raw) {
    let list: Connection[] = [];
    try {
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      // Entries from providers we no longer support (e.g. ChatGPT sign-ins) are skipped.
      if (Array.isArray(parsed)) list = (parsed as Connection[]).filter((c) => c?.provider in PROVIDERS && typeof c.apiKey === "string");
    } catch {
      // Unreadable: start over rather than break the page.
    }
    cache = { raw, list };
  }
  return cache.list;
}

export function getConnection(id: string): Connection | undefined {
  return getConnections().find((c) => c.id === id);
}

function save(list: Connection[]) {
  storage.set(KEY, JSON.stringify(list));
  window.dispatchEvent(new Event(EVENT));
}

/** Add a connection, or replace the one with the same id. */
export function putConnection(c: Connection) {
  const list = getConnections();
  save(list.some((x) => x.id === c.id) ? list.map((x) => (x.id === c.id ? c : x)) : [...list, c]);
}

export function updateConnection(id: string, patch: Partial<Connection>) {
  save(getConnections().map((c) => (c.id === id ? ({ ...c, ...patch } as Connection) : c)));
}

export function removeConnection(id: string) {
  save(getConnections().filter((c) => c.id !== id));
}

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
}

export function useConnections(): Connection[] {
  return useSyncExternalStore(subscribe, getConnections);
}

/** "sk-…f3a9": enough to tell keys apart, never the key. */
export function maskKey(key: string): string {
  return key.length > 8 ? `${key.slice(0, 3)}…${key.slice(-4)}` : "…";
}

export async function clientFor(c: Connection): Promise<LLMClient> {
  switch (c.provider) {
    case "openai": {
      const { openAIClient, listPlatformModels } = await import("./openai");
      return openAIClient({ apiKey: c.apiKey, listModels: listPlatformModels });
    }
    case "anthropic": {
      const { anthropicClient } = await import("./anthropic");
      return anthropicClient(c.apiKey);
    }
    case "meta": {
      // Meta's Model API speaks the OpenAI Responses API.
      const { openAIClient, listMetaModels, META_API } = await import("./openai");
      return openAIClient({ baseURL: META_API, providerName: "Meta", apiKey: c.apiKey, listModels: listMetaModels });
    }
  }
}
