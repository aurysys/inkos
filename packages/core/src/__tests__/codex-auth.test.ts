import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadCodexModelCatalog,
  readCodexAuthStatus,
  resolveCodexAccessToken,
} from "../llm/codex-auth.js";

function fakeJwt(expiresAtMs: number): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode({ exp: Math.floor(expiresAtMs / 1000) })}.sig`;
}

describe("codex-auth", () => {
  let codexHome: string;
  const previousCodexHome = process.env.CODEX_HOME;

  beforeEach(async () => {
    codexHome = await mkdtemp(join(tmpdir(), "inkos-codex-"));
    process.env.CODEX_HOME = codexHome;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    await rm(codexHome, { recursive: true, force: true });
  });

  async function writeAuth(accessToken: string, refreshToken = "refresh-1"): Promise<void> {
    await writeFile(join(codexHome, "auth.json"), JSON.stringify({
      auth_mode: "chatgpt",
      OPENAI_API_KEY: null,
      tokens: { id_token: "id-1", access_token: accessToken, refresh_token: refreshToken, account_id: "acct" },
      last_refresh: "2026-01-01T00:00:00Z",
    }));
  }

  it("reports a missing login without throwing", async () => {
    const status = await readCodexAuthStatus();
    expect(status.loggedIn).toBe(false);
    expect(status.error).toMatch(/codex login/);
  });

  it("reuses a stored access token that is not close to expiry", async () => {
    const token = fakeJwt(Date.now() + 24 * 3600_000);
    await writeAuth(token);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveCodexAccessToken()).resolves.toBe(token);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes an expiring token and writes the rotated tokens back for the Codex CLI", async () => {
    await writeAuth(fakeJwt(Date.now() + 60_000));
    const refreshed = fakeJwt(Date.now() + 10 * 24 * 3600_000);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      access_token: refreshed,
      refresh_token: "refresh-2",
      id_token: "id-2",
    }), { status: 200 })));

    await expect(resolveCodexAccessToken()).resolves.toBe(refreshed);
    const saved = JSON.parse(await readFile(join(codexHome, "auth.json"), "utf-8"));
    expect(saved.auth_mode).toBe("chatgpt");
    expect(saved.tokens).toEqual({
      id_token: "id-2",
      access_token: refreshed,
      refresh_token: "refresh-2",
      account_id: "acct",
    });
    expect(saved.last_refresh).not.toBe("2026-01-01T00:00:00Z");
  });

  it("reads listed models from the Codex model cache and falls back when absent", async () => {
    expect(loadCodexModelCatalog().length).toBeGreaterThan(0);

    await writeFile(join(codexHome, "models_cache.json"), JSON.stringify({
      models: [
        { slug: "model-a", visibility: "list", supported_in_api: true, context_window: 500000 },
        { slug: "model-hidden", visibility: "hide", supported_in_api: true, context_window: 272000 },
        { slug: "model-b", visibility: "list", supported_in_api: true },
      ],
    }));
    const models = loadCodexModelCatalog();
    expect(models.map((model) => model.id)).toEqual(["model-a", "model-b"]);
    expect(models[0]?.contextWindowTokens).toBe(500000);
    expect(models[1]?.contextWindowTokens).toBe(272000);
  });
});
