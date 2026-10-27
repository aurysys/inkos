import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { findProjectRoot, log, logError, GLOBAL_ENV_PATH } from "../utils.js";
import { fetchWithProxy } from "@actalk/inkos-core";
import {
  ensureNodeRuntimePinFiles,
  evaluateNodeRuntimeSupport,
  inspectNodeRuntimePinFiles,
} from "../runtime-requirements.js";
import {
  formatDoctorHintBaseUrl,
  formatDoctorHintInvalidApiKey,
  formatDoctorHintModelName,
  formatDoctorHintOpenAiProbeExhausted,
  formatDoctorHintQuota,
  formatDoctorHintStreamRequirement,
  resolveCliLanguage,
} from "../localization.js";
import type { LLMApiFormat } from "@actalk/inkos-core";
import { uiText } from "../ui-locale.js";

function buildDoctorProbePlans(
  preferredApiFormat: LLMApiFormat | undefined,
  preferredStream: boolean | undefined,
): Array<{ apiFormat: LLMApiFormat; stream: boolean }> {
  const plans: Array<{ apiFormat: LLMApiFormat; stream: boolean }> = [];
  const seen = new Set<string>();
  const push = (apiFormat: LLMApiFormat, stream: boolean) => {
    const key = `${apiFormat}:${stream ? "1" : "0"}`;
    if (seen.has(key)) return;
    seen.add(key);
    plans.push({ apiFormat, stream });
  };

  if (preferredApiFormat) {
    push(preferredApiFormat, preferredStream ?? false);
    push(preferredApiFormat, !(preferredStream ?? false));
  }
  const alternate = preferredApiFormat === "responses"
    ? "chat"
    : preferredApiFormat === "anthropic"
      ? "chat"
      : "responses";
  push(alternate, false);
  push(alternate, true);
  push("chat", false);
  push("chat", true);
  push("responses", false);
  push("responses", true);
  return plans;
}

export function buildDoctorModelCandidates(
  preferredModel: string | undefined,
  discoveredModels: Array<{ id: string; name: string }>,
): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];
  const push = (value: string | undefined | null) => {
    if (!value || value.trim().length === 0) return;
    const model = value.trim();
    if (seen.has(model)) return;
    seen.add(model);
    candidates.push(model);
  };

  push(preferredModel);
  for (const model of discoveredModels) push(model.id);
  push("gpt-5.4");
  push("gpt-4o");
  push("claude-sonnet-4-6");
  push("MiniMax-M2.7");
  push("kimi-k2.5");
  push("gemini-2.5-flash");
  return candidates;
}

export function resolveDoctorModelsBaseUrl(
  service: string | undefined,
  baseUrl: string,
  resolveServiceModelsBaseUrl: (service: string) => string | undefined,
): string {
  if (!service || service.length === 0) {
    return baseUrl;
  }
  return resolveServiceModelsBaseUrl(service) ?? baseUrl;
}

async function fetchDoctorModels(
  modelsBaseUrl: string,
  apiKey: string,
  proxyUrl?: string,
): Promise<Array<{ id: string; name: string }>> {
  const modelsUrl = modelsBaseUrl.replace(/\/$/, "") + "/models";
  try {
    const res = await fetchWithProxy(modelsUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    }, proxyUrl);
    if (!res.ok) return [];
    const json = await res.json() as { data?: Array<{ id: string }> };
    return (json.data ?? []).map((model) => ({ id: model.id, name: model.id }));
  } catch {
    return [];
  }
}

export const doctorCommand = new Command("doctor")
  .description(uiText("Check environment and project health", "실행 환경과 프로젝트 상태를 점검합니다"))
  .option("--repair-node-runtime", uiText("Write .nvmrc and .node-version pinned to Node 22 for this project", "이 프로젝트에 Node 22로 고정한 .nvmrc와 .node-version을 씁니다"))
  .action(async (opts: { repairNodeRuntime?: boolean }) => {
    const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
    const root = findProjectRoot();
    // doctor is not scoped to a book, so the language comes from the environment
    // (INKOS_LOCALE -> LC_ALL/LC_MESSAGES/LANG, default zh).
    const language = resolveCliLanguage();

    if (opts.repairNodeRuntime) {
      const repair = await ensureNodeRuntimePinFiles(root);
      checks.push({
        name: uiText("Node runtime pin files repaired", "Node 런타임 고정 파일 복구"),
        ok: true,
        detail: repair.updated
          ? uiText(`Wrote ${repair.written.join(", ")} -> Node 22`, `${repair.written.join(", ")} 작성 -> Node 22`)
          : uiText("Already pinned to Node 22", "이미 Node 22로 고정되어 있습니다"),
      });
    }

    // 1. Check Node.js version
    const nodeVersion = process.version;
    checks.push({
      name: "Node.js >= 22.16",
      ...evaluateNodeRuntimeSupport({ nodeVersion }),
    });
    checks.push({
      name: uiText("Node runtime pin files", "Node 런타임 고정 파일"),
      ...await inspectNodeRuntimePinFiles(root),
    });

    // 2. Check inkos.json exists
    try {
      await readFile(join(root, "inkos.json"), "utf-8");
      checks.push({ name: "inkos.json", ok: true, detail: uiText("Found", "있음") });
    } catch {
      checks.push({ name: "inkos.json", ok: false, detail: uiText("Not found. Run 'inkos init'", "없습니다. 'inkos init'을 실행하세요") });
    }

    // 3. Check .env exists
    try {
      await readFile(join(root, ".env"), "utf-8");
      checks.push({ name: ".env", ok: true, detail: uiText("Found", "있음") });
    } catch {
      checks.push({ name: ".env", ok: false, detail: uiText("Not found", "없음") });
    }

    // 4. Check global config
    {
      let hasGlobal = false;
      try {
        const globalContent = await readFile(GLOBAL_ENV_PATH, "utf-8");
        hasGlobal = globalContent.includes("INKOS_LLM_API_KEY=") && !globalContent.includes("your-api-key-here");
      } catch { /* no global config */ }
      checks.push({
        name: uiText("Global Config", "전역 설정"),
        ok: hasGlobal,
        detail: hasGlobal
          ? uiText(`Found (${GLOBAL_ENV_PATH})`, `있음 (${GLOBAL_ENV_PATH})`)
          : uiText("Not set. Run 'inkos config set-global'", "설정되지 않았습니다. 'inkos config set-global'을 실행하세요"),
      });
    }

    // 5. Check effective LLM config (Studio project base + env/CLI overlay, or legacy env)
    {
      const { loadConfigWithDiagnostics } = await import("../utils.js");
      const { isApiKeyOptionalForEndpoint } = await import("@actalk/inkos-core");
      let configResult: Awaited<ReturnType<typeof loadConfigWithDiagnostics>> | undefined;
      try {
        configResult = await loadConfigWithDiagnostics({ requireApiKey: false });
        checks.push({
          name: uiText("LLM Config Mode", "LLM 설정 방식"),
          ok: true,
          detail: `${configResult.diagnostics.configMode} (service=${configResult.diagnostics.serviceSource}, model=${configResult.diagnostics.modelSource}, key=${configResult.diagnostics.apiKeySource})`,
        });
        for (const warning of configResult.diagnostics.warnings) {
          checks.push({ name: uiText("  Config Hint", "  설정 안내"), ok: true, detail: warning });
        }
      } catch {
        // The API connectivity check below will report the concrete config failure.
      }
      const provider = configResult?.llm.provider;
      const baseUrl = configResult?.llm.baseUrl;
      const apiKey = configResult?.llm.apiKey;
      const apiKeyOptional = isApiKeyOptionalForEndpoint({ provider, baseUrl });
      const hasKey = apiKeyOptional || (!!apiKey && apiKey.length > 10 && apiKey !== "your-api-key-here");
      checks.push({
        name: uiText("LLM API Key", "LLM API 키"),
        ok: hasKey,
        detail: apiKeyOptional
          ? uiText("Optional for local/self-hosted endpoint", "로컬/자체 호스팅 엔드포인트에서는 선택 사항입니다")
          : hasKey
            ? uiText("Configured", "설정됨")
            : uiText("Missing — save a Studio service key or set env for CLI/daemon/deploy", "없습니다 — Studio에서 서비스 키를 저장하거나 CLI/데몬/배포용 환경 변수를 설정하세요"),
      });
    }

    // 5. Check books directory
    try {
      const { StateManager } = await import("@actalk/inkos-core");
      const state = new StateManager(root);
      const books = await state.listBooks();
      checks.push({
        name: uiText("Books", "책"),
        ok: true,
        detail: uiText(`${books.length} book(s) found`, `책 ${books.length}권 확인`),
      });
    } catch (error) {
      checks.push({ name: uiText("Books", "책"), ok: false, detail: String(error) });
    }

    // 6. API connectivity test
    try {
      const { createLLMClient, chatCompletion, LLMConfigSchema, isApiKeyOptionalForEndpoint, resolveServiceModelsBaseUrl } = await import("@actalk/inkos-core");
      const { loadConfig } = await import("../utils.js");

      let llmConfig;
      try {
        const config = await loadConfig();
        llmConfig = config.llm;
      } catch {
        // No project config — try building from global env
        const { config: loadDotenv } = await import("dotenv");
        loadDotenv({ path: GLOBAL_ENV_PATH });
        const env = process.env;
        const apiKeyOptional = isApiKeyOptionalForEndpoint({
          provider: env.INKOS_LLM_PROVIDER,
          baseUrl: env.INKOS_LLM_BASE_URL,
        });
        if ((env.INKOS_LLM_API_KEY || apiKeyOptional) && env.INKOS_LLM_BASE_URL && env.INKOS_LLM_MODEL) {
          llmConfig = LLMConfigSchema.parse({
            provider: env.INKOS_LLM_PROVIDER ?? "custom",
            baseUrl: env.INKOS_LLM_BASE_URL,
            apiKey: env.INKOS_LLM_API_KEY ?? "",
            model: env.INKOS_LLM_MODEL,
          });
        }
      }

      if (!llmConfig) {
        checks.push({
          name: uiText("API Connectivity", "API 연결"),
          ok: false,
          detail: uiText("No LLM config available (no project config or global .env)", "사용할 LLM 설정이 없습니다(프로젝트 설정과 전역 .env 모두 없음)"),
        });
        checks.push({
          name: uiText("  Hint", "  안내"),
          ok: false,
          detail: uiText(
            "Run `inkos setup`, `inkos config set-global`, or add LLM settings to the project .env file.",
            "`inkos setup` 또는 `inkos config set-global`을 실행하거나, 프로젝트 .env 파일에 LLM 설정을 추가하세요.",
          ),
        });
      } else {
        checks.push({
          name: uiText("LLM Config", "LLM 설정"),
          ok: true,
          detail: `provider=${llmConfig.provider} model=${llmConfig.model} stream=${llmConfig.stream ?? true} baseUrl=${llmConfig.baseUrl}`,
        });

        log(uiText("\n  [..] Testing API connectivity...", "\n  [..] API 연결을 확인하는 중..."));

        let connected = false;
        let detectedDetail = "";
        let lastError = "Unknown error";
        const modelsBaseUrl = resolveDoctorModelsBaseUrl(
          typeof llmConfig.service === "string" ? llmConfig.service : undefined,
          llmConfig.baseUrl,
          resolveServiceModelsBaseUrl,
        );
        const discoveredModels = (llmConfig.apiKey && modelsBaseUrl)
          ? await fetchDoctorModels(modelsBaseUrl, llmConfig.apiKey, llmConfig.proxyUrl)
          : [];
        const modelCandidates = (llmConfig.provider === "openai" || discoveredModels.length > 0)
          ? buildDoctorModelCandidates(llmConfig.model, discoveredModels)
          : [llmConfig.model];
        const plans = llmConfig.provider === "openai"
          ? buildDoctorProbePlans(llmConfig.apiFormat, llmConfig.stream)
          : [{ apiFormat: (llmConfig.apiFormat ?? "chat") as LLMApiFormat, stream: llmConfig.stream ?? true }];

        for (const model of modelCandidates) {
          for (const plan of plans) {
            try {
              const client = createLLMClient({
                ...llmConfig,
                model,
                apiFormat: plan.apiFormat,
                stream: plan.stream,
              });
              const response = await chatCompletion(client, model, [
                { role: "user", content: "Say OK" },
              ], { maxTokens: 16 });

              connected = true;
              detectedDetail = `OK (model: ${model}, apiFormat=${plan.apiFormat}, stream=${plan.stream}, tokens: ${response.usage.totalTokens})`;
              break;
            } catch (error) {
              lastError = error instanceof Error ? error.message : String(error);
            }
          }
          if (connected) {
            break;
          }
        }

        checks.push({
          name: uiText("API Connectivity", "API 연결"),
          ok: connected,
          detail: connected ? detectedDetail : lastError.split("\n")[0]!,
        });

        if (!connected && /\b(?:401|403|429)\b|unauthorized|forbidden|quota|balance|insufficient|exceeded|额度|余额|配额/i.test(lastError)) {
          checks.push({
            name: uiText("  Hint", "  안내"),
            ok: false,
            detail: formatDoctorHintQuota(language),
          });
        }

        if (!connected && llmConfig.provider === "openai") {
          checks.push({
            name: uiText("  Hint", "  안내"),
            ok: false,
            detail: formatDoctorHintOpenAiProbeExhausted(language),
          });
        }
      }
    } catch (e) {
      const errMsg = String(e);
      const hints: string[] = [];

      if (errMsg.includes("Connection error") || errMsg.includes("ECONNREFUSED") || errMsg.includes("fetch failed")) {
        hints.push(formatDoctorHintBaseUrl(language));
      }
      if (errMsg.includes("400")) {
        hints.push(formatDoctorHintStreamRequirement(language));
        hints.push(formatDoctorHintModelName(language));
      }
      if (errMsg.includes("401")) {
        hints.push(formatDoctorHintInvalidApiKey(language));
      }

      checks.push({
        name: uiText("API Connectivity", "API 연결"),
        ok: false,
        detail: errMsg.split("\n")[0]!,
      });

      if (hints.length > 0) {
        for (const hint of hints) {
          checks.push({ name: uiText("  Hint", "  안내"), ok: false, detail: hint });
        }
      }
    }

    // Output
    log(uiText("\nInkOS Doctor\n", "\nInkOS 진단\n"));
    for (const check of checks) {
      const icon = check.ok ? "[OK]" : "[!!]";
      log(`  ${icon} ${check.name}: ${check.detail}`);
    }

    const failed = checks.filter((c) => !c.ok);
    if (failed.length > 0) {
      log(uiText(`\n${failed.length} issue(s) found.`, `\n문제 ${failed.length}건을 발견했습니다.`));
    } else {
      log(uiText("\nAll checks passed.", "\n모든 점검을 통과했습니다."));
    }
  });
