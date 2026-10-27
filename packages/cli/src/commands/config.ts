import { Command } from "commander";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { findProjectRoot, log, logError, GLOBAL_CONFIG_DIR, GLOBAL_ENV_PATH } from "../utils.js";
import { listModelsForService } from "@actalk/inkos-core";
import { formatListModelsEmpty, formatListModelsHeader, resolveCliLanguage } from "../localization.js";
import { uiText } from "../ui-locale.js";

export const configCommand = new Command("config")
  .description(uiText("Manage project configuration", "프로젝트 설정을 관리합니다"));

configCommand
  .command("set")
  .description(uiText("Set a configuration value", "설정 값을 지정합니다"))
  .argument("<key>", uiText("Config key (e.g., llm.apiKey)", "설정 키(예: llm.apiKey)"))
  .argument("<value>", uiText("Config value", "설정 값"))
  .action(async (key: string, value: string) => {
    const root = findProjectRoot();
    const configPath = join(root, "inkos.json");

    try {
      const raw = await readFile(configPath, "utf-8");
      const config = JSON.parse(raw);

      const keys = key.split(".");

      const KNOWN_KEYS = new Set([
        "llm.provider", "llm.baseUrl", "llm.model", "llm.temperature",
        "llm.thinkingBudget", "llm.proxyUrl", "llm.apiFormat", "llm.stream",
        "daemon.schedule.radarCron", "daemon.schedule.writeCron",
        "daemon.maxConcurrentBooks", "daemon.chaptersPerCycle",
        "daemon.retryDelayMs", "daemon.cooldownAfterChapterMs",
        "daemon.maxChaptersPerDay",
      ]);
      // Allow any key under llm.extra.* (passthrough to API)
      if (!KNOWN_KEYS.has(key) && !key.startsWith("llm.extra.")) {
        // Find closest match by edit distance on the last segment
        const candidates = [...KNOWN_KEYS];
        const inputParts = key.split(".");
        const samePrefixCandidates = candidates.filter(k => {
          const parts = k.split(".");
          return parts.length === inputParts.length && parts.slice(0, -1).join(".") === inputParts.slice(0, -1).join(".");
        });
        const editDist = (a: string, b: string): number => {
          const m = a.length, n = b.length;
          const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
          for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
            dp[i]![j] = Math.min(dp[i-1]![j]! + 1, dp[i]![j-1]! + 1, dp[i-1]![j-1]! + (a[i-1] !== b[j-1] ? 1 : 0));
          return dp[m]![n]!;
        };
        const inputLast = inputParts[inputParts.length - 1]!;
        const suggestion = samePrefixCandidates
          .map(k => ({ k, d: editDist(k.split(".").pop()!, inputLast) }))
          .sort((a, b) => a.d - b.d)
          .find(x => x.d <= 3)?.k;
        logError(uiText(
          `Unknown config key "${key}".${suggestion ? ` Did you mean "${suggestion}"?` : ""}`,
          `알 수 없는 설정 키입니다: "${key}".${suggestion ? ` "${suggestion}"을(를) 의도하셨나요?` : ""}`,
        ));
        log(uiText(`Known keys: ${candidates.join(", ")}`, `사용 가능한 키: ${candidates.join(", ")}`));
        process.exit(1);
      }

      let target = config;
      for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i]!;
        if (!(k in target)) {
          target[k] = {};
        }
        target = target[k];
      }
      const finalKey = keys[keys.length - 1]!;
      // Auto-coerce types: numbers and booleans shouldn't be stored as strings
      if (/^\d+(\.\d+)?$/.test(value)) {
        target[finalKey] = parseFloat(value);
      } else if (value === "true") {
        target[finalKey] = true;
      } else if (value === "false") {
        target[finalKey] = false;
      } else {
        target[finalKey] = value;
      }

      await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
      log(uiText(`Set ${key} = ${value}`, `설정했습니다: ${key} = ${value}`));
    } catch (e) {
      logError(uiText(`Failed to update config: ${e}`, `설정을 변경하지 못했습니다: ${e}`));
      process.exit(1);
    }
  });

configCommand
  .command("set-global")
  .description(uiText("Set global LLM config (~/.inkos/.env), shared by all projects", "모든 프로젝트가 함께 쓰는 전역 LLM 설정(~/.inkos/.env)을 지정합니다"))
  .requiredOption("--provider <provider>", uiText("LLM provider (openai / anthropic)", "LLM 서비스 종류(openai / anthropic)"))
  .requiredOption("--base-url <url>", uiText("API base URL", "API 기본 URL"))
  .requiredOption("--api-key <key>", uiText("API key", "API 키"))
  .requiredOption("--model <model>", uiText("Model name", "모델 이름"))
  .option("--temperature <n>", uiText("Temperature", "온도"))
  .option("--max-tokens <n>", uiText("Max output tokens", "최대 출력 토큰"))
  .option("--thinking-budget <n>", uiText("Anthropic thinking budget", "Anthropic 사고(thinking) 예산"))
  .option("--api-format <format>", uiText("API format (chat / responses)", "API 형식(chat / responses)"))
  .option("--lang <language>", uiText("Default writing language: zh (Chinese) or en (English)", "기본 집필 언어: zh(중국어) 또는 en(영어)"))
  .action(async (opts) => {
    try {
      await mkdir(GLOBAL_CONFIG_DIR, { recursive: true });

      const lines = [
        "# InkOS Global LLM Configuration",
        `INKOS_LLM_PROVIDER=${opts.provider}`,
        `INKOS_LLM_BASE_URL=${opts.baseUrl}`,
        `INKOS_LLM_API_KEY=${opts.apiKey}`,
        `INKOS_LLM_MODEL=${opts.model}`,
      ];
      if (opts.temperature) lines.push(`INKOS_LLM_TEMPERATURE=${opts.temperature}`);
      if (opts.thinkingBudget) lines.push(`INKOS_LLM_THINKING_BUDGET=${opts.thinkingBudget}`);
      if (opts.apiFormat) lines.push(`INKOS_LLM_API_FORMAT=${opts.apiFormat}`);
      if (opts.lang) lines.push(`INKOS_DEFAULT_LANGUAGE=${opts.lang}`);

      await writeFile(GLOBAL_ENV_PATH, lines.join("\n") + "\n", "utf-8");
      log(uiText(`Global config saved to ${GLOBAL_ENV_PATH}`, `전역 설정을 ${GLOBAL_ENV_PATH}에 저장했습니다`));
      log(uiText("All projects will use this config unless overridden by project .env", "프로젝트 .env에서 덮어쓰지 않는 한 모든 프로젝트가 이 설정을 사용합니다"));
    } catch (e) {
      logError(uiText(`Failed to set global config: ${e}`, `전역 설정을 저장하지 못했습니다: ${e}`));
      process.exit(1);
    }
  });

configCommand
  .command("show-global")
  .description(uiText("Show global LLM config (~/.inkos/.env)", "전역 LLM 설정(~/.inkos/.env)을 보여 줍니다"))
  .action(async () => {
    try {
      const content = await readFile(GLOBAL_ENV_PATH, "utf-8");
      const masked = content.replace(
        /(INKOS_LLM_API_KEY=)(.{8})(.*)(.{4})/,
        "$1$2...$4",
      );
      log(masked);
    } catch {
      log(uiText("No global config found. Run 'inkos config set-global' to create one.", "전역 설정이 없습니다. 'inkos config set-global'을 실행해 만드세요."));
    }
  });

configCommand
  .command("show")
  .description(uiText("Show current project configuration", "현재 프로젝트 설정을 보여 줍니다"))
  .action(async () => {
    const root = findProjectRoot();
    const configPath = join(root, "inkos.json");

    try {
      const raw = await readFile(configPath, "utf-8");
      const config = JSON.parse(raw);
      // Mask API key
      if (config.llm?.apiKey) {
        const key = config.llm.apiKey;
        config.llm.apiKey = key.slice(0, 8) + "..." + key.slice(-4);
      }
      log(JSON.stringify(config, null, 2));
    } catch (e) {
      logError(uiText(`Failed to read config: ${e}`, `설정을 읽지 못했습니다: ${e}`));
      process.exit(1);
    }
  });

const KNOWN_AGENTS = ["writer", "auditor", "reviser", "architect", "radar", "chapter-analyzer"] as const;
const ENV_VAR_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function validateApiKeyEnvName(value: string): string | undefined {
  if (ENV_VAR_NAME_PATTERN.test(value)) return undefined;
  if (/^(sk-|sess-|rk-|pk-)/i.test(value) || value.includes("://")) {
    return uiText(
      "--api-key-env expects an environment variable name like PACKY_API_KEY, not a raw API key or URL.",
      "--api-key-env에는 API 키나 URL이 아니라 PACKY_API_KEY 같은 환경 변수 이름을 넣어야 합니다.",
    );
  }
  return uiText(
    `--api-key-env expects an environment variable name like PACKY_API_KEY. "${value}" is not a valid env var name.`,
    `--api-key-env에는 PACKY_API_KEY 같은 환경 변수 이름을 넣어야 합니다. "${value}"은(는) 올바른 환경 변수 이름이 아닙니다.`,
  );
}

configCommand
  .command("set-model")
  .description(uiText("Set model override for a specific agent (with optional provider routing)", "특정 에이전트가 쓸 모델을 따로 지정합니다(서비스 라우팅 선택 가능)"))
  .argument("<agent>", uiText(`Agent name (${KNOWN_AGENTS.join(", ")})`, `에이전트 이름(${KNOWN_AGENTS.join(", ")})`))
  .argument("<model>", uiText("Model name", "모델 이름"))
  .option("--base-url <url>", uiText("API base URL (for different provider)", "API 기본 URL(다른 서비스를 쓸 때)"))
  .option("--provider <provider>", uiText("Provider type (openai / anthropic / custom)", "서비스 종류(openai / anthropic / custom)"))
  .option("--api-key-env <envVar>", uiText("Env variable name for API key (e.g., PACKYAPI_KEY)", "API 키를 담은 환경 변수 이름(예: PACKYAPI_KEY)"))
  .option("--stream", uiText("Enable streaming (default)", "스트리밍을 켭니다(기본값)"))
  .option("--no-stream", uiText("Disable streaming", "스트리밍을 끕니다"))
  .action(async (agent: string, model: string, opts: { baseUrl?: string; provider?: string; apiKeyEnv?: string; stream?: boolean }) => {
    if (!KNOWN_AGENTS.includes(agent as typeof KNOWN_AGENTS[number])) {
      logError(uiText(
        `Unknown agent "${agent}". Valid agents: ${KNOWN_AGENTS.join(", ")}`,
        `알 수 없는 에이전트입니다: "${agent}". 사용 가능한 에이전트: ${KNOWN_AGENTS.join(", ")}`,
      ));
      process.exit(1);
    }

    if (opts.apiKeyEnv) {
      const validationError = validateApiKeyEnvName(opts.apiKeyEnv);
      if (validationError) {
        logError(validationError);
        process.exit(1);
      }
    }

    const root = findProjectRoot();
    const configPath = join(root, "inkos.json");

    try {
      const raw = await readFile(configPath, "utf-8");
      const config = JSON.parse(raw);
      const overrides = config.modelOverrides ?? {};

      const hasProviderOpts = opts.baseUrl || opts.provider || opts.apiKeyEnv || opts.stream === false;
      if (hasProviderOpts) {
        const override: Record<string, unknown> = { model };
        if (opts.baseUrl) override.baseUrl = opts.baseUrl;
        if (opts.provider) override.provider = opts.provider;
        if (opts.apiKeyEnv) override.apiKeyEnv = opts.apiKeyEnv;
        if (opts.stream === false) override.stream = false;
        config.modelOverrides = { ...overrides, [agent]: override };
      } else {
        config.modelOverrides = { ...overrides, [agent]: model };
      }

      await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
      log(uiText(
        `Model override: ${agent} → ${model}${opts.baseUrl ? ` (${opts.baseUrl})` : ""}`,
        `모델 개별 지정: ${agent} → ${model}${opts.baseUrl ? ` (${opts.baseUrl})` : ""}`,
      ));
    } catch (e) {
      logError(uiText(`Failed to update config: ${e}`, `설정을 변경하지 못했습니다: ${e}`));
      process.exit(1);
    }
  });

configCommand
  .command("remove-model")
  .description(uiText("Remove model override for a specific agent (falls back to default)", "특정 에이전트의 개별 모델 지정을 해제합니다(기본 모델로 돌아갑니다)"))
  .argument("<agent>", uiText("Agent name", "에이전트 이름"))
  .action(async (agent: string) => {
    const root = findProjectRoot();
    const configPath = join(root, "inkos.json");

    try {
      const raw = await readFile(configPath, "utf-8");
      const config = JSON.parse(raw);
      const overrides = config.modelOverrides;
      if (!overrides || !(agent in overrides)) {
        log(uiText(`No model override for "${agent}".`, `"${agent}"에 개별 지정된 모델이 없습니다.`));
        return;
      }
      const { [agent]: _, ...rest } = overrides;
      config.modelOverrides = Object.keys(rest).length > 0 ? rest : undefined;
      await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
      log(uiText(`Removed model override for ${agent}. Will use default model.`, `${agent}의 개별 모델 지정을 해제했습니다. 이제 기본 모델을 사용합니다.`));
    } catch (e) {
      logError(uiText(`Failed to update config: ${e}`, `설정을 변경하지 못했습니다: ${e}`));
      process.exit(1);
    }
  });

configCommand
  .command("show-models")
  .description(uiText("Show model routing for all agents", "모든 에이전트의 모델 배정을 보여 줍니다"))
  .option("--json", uiText("Output JSON", "JSON으로 출력합니다"))
  .action(async (opts) => {
    const root = findProjectRoot();
    const configPath = join(root, "inkos.json");

    try {
      const raw = await readFile(configPath, "utf-8");
      const config = JSON.parse(raw);
      const defaultModel = config.llm?.model ?? "(not set)";
      const overrides: Record<string, unknown> = config.modelOverrides ?? {};

      if (opts.json) {
        log(JSON.stringify({ defaultModel, overrides }, null, 2));
        return;
      }

      log(uiText(`Default model: ${defaultModel}\n`, `기본 모델: ${config.llm?.model ?? "(설정 안 됨)"}\n`));
      if (Object.keys(overrides).length === 0) {
        log(uiText("No agent-specific overrides. All agents use the default model.", "에이전트별 개별 지정이 없습니다. 모든 에이전트가 기본 모델을 사용합니다."));
        return;
      }
      log(uiText("Agent overrides:", "에이전트별 개별 지정:"));
      for (const [agent, value] of Object.entries(overrides)) {
        if (typeof value === "string") {
          log(`  ${agent} → ${value}`);
        } else {
          const o = value as Record<string, unknown>;
          const parts = [o.model as string];
          if (o.baseUrl) parts.push(`@ ${o.baseUrl}`);
          if (o.stream === false) parts.push("[no-stream]");
          log(`  ${agent} → ${parts.join(" ")}`);
        }
      }
      log("");
      const usingDefault = KNOWN_AGENTS.filter((a) => !(a in overrides));
      if (usingDefault.length > 0) {
        log(uiText(`Using default: ${usingDefault.join(", ")}`, `기본 모델 사용: ${usingDefault.join(", ")}`));
      }
    } catch (e) {
      logError(uiText(`Failed to read config: ${e}`, `설정을 읽지 못했습니다: ${e}`));
      process.exit(1);
    }
  });

// B17: list-models 命令 —— 列出指定 service 的可用模型（含元数据）
configCommand
  .command("list-models <service>")
  .description(uiText("List available models for a service (with maxOutput / contextWindow / abilities)", "서비스에서 쓸 수 있는 모델을 나열합니다(maxOutput / contextWindow / 기능 포함)"))
  .option("--api-key <key>", uiText("API Key (also reads from INKOS_LLM_API_KEY env)", "API 키(INKOS_LLM_API_KEY 환경 변수에서도 읽습니다)"))
  .option("--base-url <url>", uiText("Live /models probe baseUrl (for custom/newapi)", "실시간 /models 조회에 쓸 baseUrl(custom/newapi용)"))
  .option("--json", uiText("Output as JSON", "JSON으로 출력합니다"))
  .action(async (service: string, opts: { apiKey?: string; baseUrl?: string; json?: boolean }) => {
    const apiKey = opts.apiKey ?? process.env.INKOS_LLM_API_KEY;
    const language = resolveCliLanguage();
    const models = await listModelsForService(service, apiKey, opts.baseUrl);
    if (models.length === 0) {
      logError(formatListModelsEmpty(language, service));
      process.exit(1);
    }
    if (opts.json) {
      log(JSON.stringify(models, null, 2));
      return;
    }
    log(`${formatListModelsHeader(language, service, models.length)}\n`);
    for (const m of models) {
      const maxOut = m.maxOutput ? `out=${m.maxOutput}` : "out=?";
      const ctx = m.contextWindow > 0 ? `ctx=${m.contextWindow}` : "ctx=?";
      log(`  ${m.id.padEnd(42)} ${maxOut.padEnd(14)} ${ctx}`);
    }
  });
