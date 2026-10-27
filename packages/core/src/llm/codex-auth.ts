import { readFileSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { InkosModel } from "./providers/types.js";

/**
 * Codex CLI login reuse.
 *
 * `codex login` (ChatGPT sign-in) stores OAuth tokens in $CODEX_HOME/auth.json.
 * InkOS reads the same file so a ChatGPT subscription can drive the
 * chatgpt.com Codex backend without an API key. Refresh tokens rotate on every
 * refresh, so a refreshed token set is written back to auth.json in Codex's own
 * format; otherwise the Codex CLI would be left holding a revoked refresh token.
 */

export const CODEX_BASE_URL = "https://chatgpt.com/backend-api";

// Public OAuth client of the Codex CLI (same value the CLI and pi-ai use).
const CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const DEFAULT_CODEX_MAX_OUTPUT = 128_000;

interface CodexAuthTokens {
  readonly id_token?: string;
  readonly access_token?: string;
  readonly refresh_token?: string;
  readonly account_id?: string;
}

interface CodexAuthFile {
  readonly auth_mode?: string;
  readonly tokens?: CodexAuthTokens | null;
  readonly last_refresh?: string;
  readonly [key: string]: unknown;
}

export class CodexAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexAuthError";
  }
}

export interface CodexAuthStatus {
  readonly loggedIn: boolean;
  readonly authPath: string;
  readonly authMode?: string;
  readonly expiresAt?: number;
  readonly error?: string;
}

export function resolveCodexHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.CODEX_HOME?.trim() || join(homedir(), ".codex");
}

function resolveCodexAuthPath(): string {
  return join(resolveCodexHome(), "auth.json");
}

function decodeJwtExpiry(token: string): number | undefined {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf-8")) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

async function readCodexAuthFile(path: string): Promise<CodexAuthFile> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    throw new CodexAuthError(`Codex CLI is not logged in (${path} not found). Run \`codex login\` and sign in with ChatGPT.`);
  }
  try {
    return JSON.parse(raw) as CodexAuthFile;
  } catch {
    throw new CodexAuthError(`Codex auth file is not valid JSON: ${path}. Run \`codex login\` again.`);
  }
}

function requireChatGptTokens(auth: CodexAuthFile, path: string): CodexAuthTokens & { access_token: string } {
  const tokens = auth.tokens;
  if (!tokens?.access_token) {
    throw new CodexAuthError(
      `Codex CLI has no ChatGPT login in ${path}. Run \`codex login\` and choose "Sign in with ChatGPT".`,
    );
  }
  return tokens as CodexAuthTokens & { access_token: string };
}

export async function readCodexAuthStatus(): Promise<CodexAuthStatus> {
  const authPath = resolveCodexAuthPath();
  try {
    const auth = await readCodexAuthFile(authPath);
    const tokens = requireChatGptTokens(auth, authPath);
    return {
      loggedIn: true,
      authPath,
      authMode: auth.auth_mode,
      expiresAt: decodeJwtExpiry(tokens.access_token),
    };
  } catch (error) {
    return { loggedIn: false, authPath, error: error instanceof Error ? error.message : String(error) };
  }
}

let inflightRefresh: Promise<string> | undefined;

/** Returns a usable ChatGPT access token, refreshing (and persisting) it when close to expiry. */
export async function resolveCodexAccessToken(): Promise<string> {
  const authPath = resolveCodexAuthPath();
  const auth = await readCodexAuthFile(authPath);
  const tokens = requireChatGptTokens(auth, authPath);
  const expiresAt = decodeJwtExpiry(tokens.access_token);
  if (expiresAt === undefined || expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return tokens.access_token;
  }
  inflightRefresh ??= refreshAndPersist(authPath, auth, tokens).finally(() => {
    inflightRefresh = undefined;
  });
  return inflightRefresh;
}

async function refreshAndPersist(
  authPath: string,
  auth: CodexAuthFile,
  tokens: CodexAuthTokens & { access_token: string },
): Promise<string> {
  if (!tokens.refresh_token) {
    throw new CodexAuthError("Codex access token expired and no refresh token is stored. Run `codex login` again.");
  }
  const response = await fetch(CODEX_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: CODEX_OAUTH_CLIENT_ID,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    // The Codex CLI may have rotated the tokens concurrently; prefer its fresh copy.
    const latest = requireChatGptTokens(await readCodexAuthFile(authPath), authPath);
    const latestExpiry = decodeJwtExpiry(latest.access_token);
    if (latest.access_token !== tokens.access_token && (latestExpiry ?? 0) - Date.now() > REFRESH_MARGIN_MS) {
      return latest.access_token;
    }
    throw new CodexAuthError(`Codex token refresh failed (HTTP ${response.status}). Run \`codex login\` again.`);
  }
  const refreshed = await response.json() as { access_token?: string; refresh_token?: string; id_token?: string };
  if (!refreshed.access_token) {
    throw new CodexAuthError("Codex token refresh returned no access token. Run `codex login` again.");
  }
  const next: CodexAuthFile = {
    ...auth,
    tokens: {
      ...tokens,
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token ?? tokens.refresh_token,
      ...(refreshed.id_token ? { id_token: refreshed.id_token } : {}),
    },
    last_refresh: new Date().toISOString(),
  };
  const tempPath = `${authPath}.inkos-${process.pid}-${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
  await rename(tempPath, authPath);
  return refreshed.access_token;
}

// Fallback when Codex has not cached its model catalog yet (ids pi-ai knows for this backend).
const FALLBACK_CODEX_MODELS: readonly InkosModel[] = [
  { id: "gpt-5.4", maxOutput: DEFAULT_CODEX_MAX_OUTPUT, contextWindowTokens: 272_000 },
  { id: "gpt-5.4-mini", maxOutput: DEFAULT_CODEX_MAX_OUTPUT, contextWindowTokens: 272_000 },
  { id: "gpt-5.3-codex", maxOutput: DEFAULT_CODEX_MAX_OUTPUT, contextWindowTokens: 272_000 },
];

/**
 * Models the logged-in account can use, read from the catalog the Codex CLI
 * caches in $CODEX_HOME/models_cache.json (only entries Codex lists in its picker).
 */
export function loadCodexModelCatalog(): readonly InkosModel[] {
  try {
    const raw = readFileSync(join(resolveCodexHome(), "models_cache.json"), "utf-8");
    const parsed = JSON.parse(raw) as { models?: unknown };
    const entries = Array.isArray(parsed.models) ? parsed.models : [];
    const models = entries.flatMap((entry): InkosModel[] => {
      const model = entry as { slug?: unknown; visibility?: unknown; supported_in_api?: unknown; context_window?: unknown };
      if (typeof model.slug !== "string" || !model.slug) return [];
      if (model.visibility !== "list" || model.supported_in_api === false) return [];
      const contextWindowTokens = typeof model.context_window === "number" && model.context_window > 0
        ? model.context_window
        : 272_000;
      return [{
        id: model.slug,
        maxOutput: Math.min(DEFAULT_CODEX_MAX_OUTPUT, contextWindowTokens),
        contextWindowTokens,
        capabilities: { text: true, tools: true, reasoning: true },
      }];
    });
    return models.length > 0 ? models : FALLBACK_CODEX_MODELS;
  } catch {
    return FALLBACK_CODEX_MODELS;
  }
}
