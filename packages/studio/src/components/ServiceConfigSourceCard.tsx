import { useEffect, useState } from "react";
import { fetchJson } from "../hooks/use-api";
import { tr } from "../lib/app-language";

type ConfigSource = "env" | "studio";
type EnvScope = "project" | "global" | null;

interface EnvConfigSummary {
  detected: boolean;
  provider: string | null;
  baseUrl: string | null;
  model: string | null;
  hasApiKey: boolean;
}

interface ServiceConfigPayload {
  services: Array<Record<string, unknown>>;
  defaultModel: string | null;
  configSource: ConfigSource;
  storedConfigSource?: ConfigSource;
  envConfig: {
    project: EnvConfigSummary;
    global: EnvConfigSummary;
    effectiveSource: EnvScope;
    runtimeUsesEnv: boolean;
  };
}

export function ServiceConfigSourceCard({ onChange }: { onChange?: () => void }) {
  const [data, setData] = useState<ServiceConfigPayload | null>(null);
  const [saving, setSaving] = useState<ConfigSource | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const payload = await fetchJson<ServiceConfigPayload>("/services/config");
      setData(payload);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : tr("读取配置来源失败", "Failed to load config source", "설정 출처를 불러오지 못했습니다"));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const switchSource = async (configSource: ConfigSource) => {
    setSaving(configSource);
    try {
      await fetchJson("/services/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configSource }),
      });
      await load();
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : tr("切换配置来源失败", "Failed to switch config source", "설정 출처를 전환하지 못했습니다"));
    } finally {
      setSaving(null);
    }
  };

  const importEnvConfig = async () => {
    setImporting(true);
    try {
      await fetchJson("/services/config/import-env", {
        method: "POST",
      });
      await load();
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : tr("导入环境变量配置失败", "Failed to import env config", "환경 변수 설정을 가져오지 못했습니다"));
    } finally {
      setImporting(false);
    }
  };

  if (!data && !error) {
    return (
      <div className="rounded-xl border border-border/40 bg-card/70 p-4 text-sm text-muted-foreground/70">
        {tr("正在读取配置来源…", "Loading config source…", "설정 출처를 불러오는 중…")}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-4 text-sm text-amber-600">
        {error ?? tr("读取配置来源失败", "Failed to load config source", "설정 출처를 불러오지 못했습니다")}
      </div>
    );
  }

  const { configSource, envConfig } = data;
  const storedConfigSource = data.storedConfigSource ?? configSource;
  const activeEnvSummary = envConfig.effectiveSource === "project" ? envConfig.project : envConfig.global;
  const envLabel = envConfig.effectiveSource === "project"
    ? tr("项目 .env", "Project .env", "프로젝트 .env")
    : envConfig.effectiveSource === "global"
      ? tr("全局 ~/.inkos/.env", "Global ~/.inkos/.env", "전역 ~/.inkos/.env")
      : null;
  const envDetected = envConfig.project.detected || envConfig.global.detected;

  return (
    <div className="rounded-xl border border-border/40 bg-card/70 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{tr("LLM 配置来源", "LLM config source", "LLM 설정 출처")}</div>
          <div className="text-xs text-muted-foreground/70 mt-1">
            {tr("Studio 运行时：", "Studio runtime:", "Studio 런타임:")}
            <span className="text-foreground"> {tr("使用服务页配置和 Studio 密钥", "uses service page config and Studio keys", "서비스 페이지 설정과 Studio 키 사용")}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void switchSource("studio")}
            disabled={saving !== null || importing || configSource === "studio"}
            className="rounded-lg border border-border/50 px-3 py-1.5 text-xs hover:bg-secondary/50 disabled:opacity-50"
          >
            {saving === "studio" ? tr("切换中…", "Switching…", "전환 중…") : tr("使用 Studio 配置", "Use Studio config", "Studio 설정 사용")}
          </button>
          {envDetected && activeEnvSummary.hasApiKey ? (
            <button
              type="button"
              onClick={() => void importEnvConfig()}
              disabled={saving !== null || importing}
              className="rounded-lg border border-border/50 bg-secondary/40 px-3 py-1.5 text-xs hover:bg-secondary/70 disabled:opacity-50"
            >
              {importing ? tr("导入中…", "Importing…", "가져오는 중…") : tr("导入检测到的配置", "Import detected config", "감지된 설정 가져오기")}
            </button>
          ) : null}
        </div>
      </div>

      {storedConfigSource === "env" ? (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.04] p-3 text-xs text-muted-foreground/80">
          {tr(
            "检测到旧配置标记为 `.env` 优先。Studio 运行时不会使用它；CLI、daemon 和部署环境仍可按 env 覆盖层使用。",
            "A legacy setting marks `.env` as preferred. The Studio runtime ignores it; CLI, daemon, and deployment environments may still use the env override layer.",
            "이전 설정에 `.env` 우선 사용이 지정되어 있습니다. Studio 런타임은 이 설정을 사용하지 않으며, CLI·데몬·배포 환경에서는 계속 env 덮어쓰기 계층으로 사용할 수 있습니다.",
          )}
        </div>
      ) : null}

      {envDetected ? (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.04] p-3 text-xs text-muted-foreground/80 space-y-1.5">
          <div className="text-foreground">
            {tr("检测到 LLM 环境变量覆盖：", "Detected LLM environment variable override:", "LLM 환경 변수 덮어쓰기 감지:")}
            <span className="font-medium"> {envLabel ?? tr("已检测到但未定位来源", "detected but source not located", "감지되었지만 출처를 찾지 못함")}</span>
          </div>
          {activeEnvSummary.baseUrl ? <div>Base URL: <span className="font-mono text-foreground">{activeEnvSummary.baseUrl}</span></div> : null}
          {activeEnvSummary.model ? <div>{tr("模型：", "Model: ", "모델: ")}<span className="font-mono text-foreground">{activeEnvSummary.model}</span></div> : null}
          {activeEnvSummary.provider ? <div>{tr("服务商：", "Provider: ", "서비스: ")}<span className="font-mono text-foreground">{activeEnvSummary.provider}</span></div> : null}
          <div>{tr("API Key：", "API Key: ", "API 키: ")}<span className="text-foreground">{activeEnvSummary.hasApiKey ? tr("已设置", "set", "설정됨") : tr("未设置", "not set", "설정 안 됨")}</span></div>
          <div className="text-muted-foreground/70 pt-1">
            {tr(
              "当前虽然检测到 .env，但 Studio 和 Agent 请求不会直接使用这套覆盖；点击“导入检测到的配置”后，会把它保存为 Studio 服务配置。",
              "A .env override was detected, but Studio and agent requests do not use it directly. Click “Import detected config” to save it as Studio service config.",
              ".env 덮어쓰기가 감지되었지만 Studio와 에이전트 요청은 이를 직접 사용하지 않습니다. “감지된 설정 가져오기”를 누르면 Studio 서비스 설정으로 저장됩니다.",
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border/30 bg-secondary/20 p-3 text-xs text-muted-foreground/75">
          {tr(
            "未检测到目录或全局 `.env` 里的 LLM 覆盖变量。当前会直接使用项目配置和 Studio 服务配置。",
            "No LLM override variables detected in the project or global `.env`. Project config and Studio service config are used directly.",
            "프로젝트 또는 전역 `.env`에서 LLM 덮어쓰기 변수가 감지되지 않았습니다. 프로젝트 설정과 Studio 서비스 설정을 그대로 사용합니다.",
          )}
        </div>
      )}

      {error ? (
        <div className="text-xs text-rose-500">{error}</div>
      ) : null}
    </div>
  );
}
