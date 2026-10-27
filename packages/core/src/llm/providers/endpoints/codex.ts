/**
 * Codex CLI (ChatGPT subscription)
 *
 * - Reuses the `codex login` ChatGPT sign-in from $CODEX_HOME/auth.json; no API key.
 * - Calls the chatgpt.com Codex backend through pi-ai's openai-codex-responses API
 *   (see ../../codex-provider.ts for token injection).
 * - The model list mirrors the catalog the Codex CLI caches for the signed-in account.
 */
import type { InkosEndpoint } from "../types.js";
import { CODEX_BASE_URL, loadCodexModelCatalog } from "../../codex-auth.js";

const CODEX_MODELS = loadCodexModelCatalog();

export const CODEX: InkosEndpoint = {
  id: "codex",
  label: "Codex CLI (ChatGPT)",
  group: "local",
  api: "openai-codex-responses",
  baseUrl: CODEX_BASE_URL,
  checkModel: CODEX_MODELS[0]?.id,
  models: CODEX_MODELS,
};
