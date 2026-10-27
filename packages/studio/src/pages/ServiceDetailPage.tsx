import { useState, useEffect } from "react";
import { fetchJson } from "../hooks/use-api";
import { useServiceStore } from "../store/service";
import { Eye, EyeOff, Loader2, ArrowLeft, Plus, Trash2, X } from "lucide-react";
import { ServiceQuickLinks } from "../components/ServiceQuickLinks";
import { tr } from "../lib/app-language";
import { isLLMApiFormat } from "@actalk/inkos-core/llm/api-format";
import {
  deleteServiceConfig,
  matchServiceConfigEntryForDetail,
  mergeServiceDetailModels,
  probeServiceForDetail,
  rehydrateServiceConnectionStatus,
  saveServiceConfig,
  type ServiceDetailConnectionStatus as ConnectionStatus,
  type ServiceDetailDetectedConfig as DetectedConfig,
  type ServiceDetailModelInfo as ModelInfo,
  type ServiceDetailVerifiedProbe as VerifiedProbe,
  type LLMApiFormat,
} from "./service-detail-state";

interface Nav {
  toServices: () => void;
}

interface CodexAuthStatus {
  readonly loggedIn: boolean;
  readonly authPath: string;
  readonly authMode?: string;
  readonly expiresAt?: number;
  readonly error?: string;
}

function CodexLoginCard({ status, onRecheck }: { status: CodexAuthStatus | null; onRecheck: () => void }) {
  if (!status) {
    return (
      <div className="rounded-lg border border-border/60 bg-card/60 px-4 py-3 text-sm text-muted-foreground">
        {tr("正在检查 Codex CLI 登录状态…", "Checking Codex CLI login…", "Codex CLI 로그인 상태를 확인하는 중...")}
      </div>
    );
  }
  const expiresLabel = status.expiresAt ? new Date(status.expiresAt).toLocaleString() : null;
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm space-y-1.5 ${status.loggedIn ? "border-emerald-500/30 bg-emerald-500/[0.04]" : "border-amber-500/40 bg-amber-500/[0.06]"}`}>
      <div className="flex items-center justify-between gap-3">
        <span className={`font-medium ${status.loggedIn ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
          {status.loggedIn
            ? tr("已使用 Codex CLI 登录（ChatGPT）", "Signed in via Codex CLI (ChatGPT)", "Codex CLI로 로그인됨 (ChatGPT)")
            : tr("需要登录 Codex CLI", "Codex CLI login required", "Codex CLI 로그인이 필요합니다")}
        </span>
        <button type="button" onClick={onRecheck} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          {tr("重新检查", "Recheck", "다시 확인")}
        </button>
      </div>
      {status.loggedIn ? (
        <p className="text-xs text-muted-foreground">
          {tr(
            "无需 API Key：InkOS 直接使用 Codex CLI 的 ChatGPT 登录，按你的 ChatGPT 订阅额度调用模型。",
            "No API key needed: InkOS reuses the Codex CLI ChatGPT login and draws on your ChatGPT subscription.",
            "API 키가 필요 없습니다. InkOS가 Codex CLI의 ChatGPT 로그인을 그대로 써서 ChatGPT 구독 한도 안에서 모델을 호출합니다.",
          )}
          {expiresLabel ? ` ${tr("令牌到期：", "Token expires:", "토큰 만료:")} ${expiresLabel}${tr("（到期前自动刷新）", " (refreshed automatically)", " (만료 전에 자동 갱신)")}` : ""}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {tr("在终端运行", "Run", "터미널에서")}{" "}
          <code className="font-mono text-foreground">codex login</code>{" "}
          {tr(
            "并选择 ChatGPT 登录，然后点击“重新检查”。",
            "in a terminal, choose “Sign in with ChatGPT”, then click “Recheck”.",
            "을 실행해 ChatGPT로 로그인한 뒤 “다시 확인”을 누르세요.",
          )}
          {status.error ? <span className="block mt-1 font-mono text-[11px] opacity-70">{status.error}</span> : null}
        </p>
      )}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="max-w-xl mx-auto space-y-6 animate-pulse">
      <div className="h-4 w-16 bg-muted rounded" />
      <div className="h-7 w-40 bg-muted rounded" />
      <div className="space-y-2"><div className="h-3 w-16 bg-muted/60 rounded" /><div className="h-10 w-full bg-muted/40 rounded-lg" /></div>
      <div className="h-9 w-24 bg-muted/40 rounded-lg" />
    </div>
  );
}

export function ServiceDetailPage({ serviceId, nav }: { serviceId: string; nav: Nav }) {
  // -- Service store --
  const services = useServiceStore((s) => s.services);
  const loading = useServiceStore((s) => s.servicesLoading);
  const fetchServices = useServiceStore((s) => s.fetchServices);
  const refreshServices = useServiceStore((s) => s.refreshServices);
  const fetchBankModels = useServiceStore((s) => s.fetchBankModels);
  const setStoreModels = useServiceStore((s) => s.setLiveModels);
  const clearStoreModels = useServiceStore((s) => s.clearModels);

  useEffect(() => { void fetchServices(); }, [fetchServices]);

  const svc = services.find((s) => s.service === serviceId);
  const isCustom = serviceId === "custom" || serviceId.startsWith("custom:");
  // Codex CLI service: auth comes from `codex login`; protocol, streaming and temperature are fixed by the backend.
  const isCodex = serviceId === "codex";
  const [codexStatus, setCodexStatus] = useState<CodexAuthStatus | null>(null);
  const [codexStatusVersion, setCodexStatusVersion] = useState(0);

  useEffect(() => {
    if (!isCodex) return;
    let cancelled = false;
    setCodexStatus(null);
    void fetchJson<CodexAuthStatus>("/codex/status")
      .then((result) => { if (!cancelled) setCodexStatus(result); })
      .catch((e) => {
        if (!cancelled) setCodexStatus({ loggedIn: false, authPath: "~/.codex/auth.json", error: e instanceof Error ? e.message : String(e) });
      });
    return () => { cancelled = true; };
  }, [isCodex, codexStatusVersion]);
  const persistedCustomName = serviceId.startsWith("custom:") ? decodeURIComponent(serviceId.slice("custom:".length)) : "";

  // -- Local form state --
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [customName, setCustomName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [temperature, setTemperature] = useState("0.7");
  const [apiFormat, setApiFormat] = useState<LLMApiFormat>("chat");
  const [stream, setStream] = useState(true);
  const [detectedModel, setDetectedModel] = useState<string>("");
  const [detectedConfig, setDetectedConfig] = useState<DetectedConfig | null>(null);
  const [verifiedProbe, setVerifiedProbe] = useState<VerifiedProbe | null>(null);
  const [configuredModels, setConfiguredModels] = useState<ModelInfo[]>([]);
  const [modelIdInput, setModelIdInput] = useState("");
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);

  // -- Unified connection status --
  const [status, setStatus] = useState<ConnectionStatus>({ state: "idle" });

  useEffect(() => {
    let cancelled = false;
    void fetchJson<{ services: Array<Record<string, unknown>> }>("/services/config")
      .then((data) => {
        if (cancelled) return;
        const matched = matchServiceConfigEntryForDetail(data.services ?? [], serviceId);
        if (!matched) return;
        if (isCustom) {
          setCustomName(String(matched.name ?? persistedCustomName));
          setBaseUrl(String(matched.baseUrl ?? ""));
        }
        if (typeof matched.temperature === "number") setTemperature(String(matched.temperature));
        if (isLLMApiFormat(matched.apiFormat)) setApiFormat(matched.apiFormat);
        if (typeof matched.stream === "boolean") setStream(matched.stream);
        if (Array.isArray(matched.models)) {
          setConfiguredModels(mergeServiceDetailModels(matched.models.filter((model): model is string => typeof model === "string")));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isCustom, persistedCustomName, serviceId]);

  const resolvedCustomName = persistedCustomName || customName.trim() || "Custom";
  const effectiveServiceId = isCustom ? `custom:${resolvedCustomName}` : serviceId;
  const label = isCustom ? (customName || persistedCustomName || tr("自定义服务", "Custom service", "사용자 지정 서비스")) : (svc?.label ?? serviceId);
  const storeModels = useServiceStore((s) => s.modelsByService[effectiveServiceId]);

  useEffect(() => {
    let cancelled = false;
    void rehydrateServiceConnectionStatus({
      effectiveServiceId,
      shouldVerify: Boolean(svc?.connected),
      isCustom,
      baseUrl,
      apiFormat,
      stream,
    })
      .then((result) => {
        if (cancelled) return;
        setApiKey(result.apiKey);
        setDetectedModel(result.detectedModel);
        setDetectedConfig(result.detectedConfig);
        setStatus(result.status);
        if (result.status.state === "connected") {
          setStoreModels(effectiveServiceId, result.status.models);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setStatus({ state: "idle" });
      });
    return () => { cancelled = true; };
  }, [
    apiFormat,
    baseUrl,
    effectiveServiceId,
    isCustom,
    setStoreModels,
    stream,
    svc?.connected,
  ]);

  if (loading) return <DetailSkeleton />;

  // -- Derived state --
  const isConnected = Boolean(svc?.connected);
  const apiKeyOptional = Boolean(svc?.apiKeyOptional);
  const models = mergeServiceDetailModels(
    configuredModels,
    status.state === "connected" ? status.models : undefined,
    storeModels,
  );
  const hasModelCatalog = models.length > 0 || status.state === "connected";
  const isBusy = status.state === "testing" || status.state === "saving";

  // -- Handlers --
  const handleTest = async () => {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey && !isCustom && !apiKeyOptional) {
      setStatus({ state: "error", message: tr("请先输入 API Key", "Enter an API key first", "먼저 API 키를 입력하세요") });
      return;
    }
    if (isCustom && !baseUrl.trim()) {
      setStatus({ state: "error", message: tr("请先填写 Base URL", "Enter a base URL first", "먼저 Base URL을 입력하세요") });
      return;
    }
    setApiKey(trimmedKey);
    setSaveFeedback(null);
    setStatus({ state: "testing" });
    try {
      const preferredModel = modelIdInput.trim() || configuredModels[0]?.id || detectedModel || undefined;
      const result = await probeServiceForDetail(effectiveServiceId, {
        apiKey: trimmedKey,
        apiFormat,
        stream,
        ...(preferredModel ? { preferredModel } : {}),
        ...(isCustom ? { baseUrl: baseUrl.trim() } : {}),
      });
      if (result.ok) {
        const models = result.models ?? [];
        const verifiedApiFormat = result.detected?.apiFormat ?? apiFormat;
        const verifiedStream = typeof result.detected?.stream === "boolean" ? result.detected.stream : stream;
        const verifiedBaseUrl = isCustom ? (result.detected?.baseUrl ?? baseUrl.trim()) : "";
        if (result.detected?.apiFormat) setApiFormat(result.detected.apiFormat);
        if (typeof result.detected?.stream === "boolean") setStream(result.detected.stream);
        if (isCustom && result.detected?.baseUrl) setBaseUrl(result.detected.baseUrl);
        setDetectedModel(result.selectedModel ?? "");
        setDetectedConfig(result.detected ?? null);
        setVerifiedProbe({
          apiKey: trimmedKey,
          baseUrl: verifiedBaseUrl,
          apiFormat: verifiedApiFormat,
          stream: verifiedStream,
          models,
          selectedModel: result.selectedModel,
          detected: result.detected,
        });
        const mergedModels = mergeServiceDetailModels(configuredModels, preferredModel ? [preferredModel] : undefined, models);
        setConfiguredModels(mergedModels);
        setStatus({ state: "connected", models: mergedModels });
        setStoreModels(effectiveServiceId, mergedModels); // Write to global store
      } else {
        setVerifiedProbe(null);
        setStatus({ state: "error", message: result.error ?? tr("连接失败", "Connection failed", "연결에 실패했습니다") });
        clearStoreModels(effectiveServiceId);
      }
    } catch (e) {
      setVerifiedProbe(null);
      setStatus({ state: "error", message: e instanceof Error ? e.message : tr("连接失败", "Connection failed", "연결에 실패했습니다") });
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(tr(`删除“${label}”的配置和密钥？`, `Delete the config and key for “${label}”?`, `“${label}”의 설정과 키를 삭제할까요?`))) return;
    setStatus({ state: "saving" });
    try {
      await deleteServiceConfig(effectiveServiceId);
      clearStoreModels(effectiveServiceId);
      await refreshServices();
      nav.toServices();
    } catch (e) {
      setStatus({ state: "error", message: e instanceof Error ? e.message : tr("删除失败", "Delete failed", "삭제에 실패했습니다") });
    }
  };

  const handleSave = async () => {
    const trimmedKey = apiKey.trim();
    setApiKey(trimmedKey);
    if (isCustom && !baseUrl.trim()) {
      setStatus({ state: "error", message: tr("请先填写 Base URL", "Enter a base URL first", "먼저 Base URL을 입력하세요") });
      return;
    }
    setStatus({ state: "saving" });
    try {
      const result = await saveServiceConfig({
        effectiveServiceId,
        serviceId,
        isCustom,
        apiKeyOptional,
        resolvedCustomName,
        apiKey: trimmedKey,
        baseUrl,
        apiFormat,
        stream,
        temperature,
        detectedModel,
        configuredModels,
        verifiedProbe,
      });
      if (result.status.state === "connected") {
        if (result.detectedConfig?.apiFormat) setApiFormat(result.detectedConfig.apiFormat);
        if (typeof result.detectedConfig?.stream === "boolean") setStream(result.detectedConfig.stream);
        if (isCustom && result.detectedConfig?.baseUrl) setBaseUrl(result.detectedConfig.baseUrl);
        setDetectedModel(result.detectedModel);
        setDetectedConfig(result.detectedConfig);
        setConfiguredModels(result.status.models);
        setStoreModels(effectiveServiceId, result.status.models);
        setStatus(result.status);
        setSaveFeedback(tr(
          `已保存 ${result.status.models.length} 个模型，创作选择器将使用这份目录。`,
          `Saved ${result.status.models.length} models. The writing picker will use this catalog.`,
          `모델 ${result.status.models.length}개를 저장했습니다. 창작 화면의 모델 선택 목록에 이 목록이 쓰입니다.`,
        ));
      } else {
        setStatus(result.status);
        if (result.status.state === "error") return;
      }
      await refreshServices();
      await fetchBankModels();
    } catch (e) {
      setStatus({ state: "error", message: e instanceof Error ? e.message : tr("保存失败", "Save failed", "저장에 실패했습니다") });
    }
  };

  const handleAddModel = () => {
    const next = mergeServiceDetailModels(configuredModels, [modelIdInput]);
    if (next.length === configuredModels.length) return;
    setConfiguredModels(next);
    setStoreModels(effectiveServiceId, next);
    if (status.state === "connected") setStatus({ state: "connected", models: next });
    setModelIdInput("");
  };

  const handleRemoveModel = (modelId: string) => {
    const next = models.filter((model) => model.id.toLowerCase() !== modelId.toLowerCase());
    setConfiguredModels(next);
    setStoreModels(effectiveServiceId, next);
    if (status.state === "connected") setStatus({ state: "connected", models: next });
  };

  return (
    <div className="max-w-xl mx-auto space-y-6">
      {/* Back */}
      <button
        onClick={nav.toServices}
        className="inline-flex items-center gap-2 rounded-lg border border-border/50 bg-card/60 px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary/50 transition-colors"
      >
        <ArrowLeft size={14} />
        {tr("返回服务商管理", "Back to providers", "서비스 목록으로")}
      </button>

      {/* Title + status */}
      <div className="flex items-center gap-3">
        <h1 className="font-serif text-2xl">{label}</h1>
        {isConnected && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 font-medium">
            {tr("已连接", "Connected", "연결됨")}
          </span>
        )}
      </div>
      <ServiceQuickLinks serviceId={serviceId} />

      <div className="space-y-5">
        {/* Custom fields */}
        {isCustom && (
        <div className="grid grid-cols-2 gap-4">
            <Field label={tr("服务名称", "Service name", "서비스 이름")}>
              <input type="text" value={customName} onChange={(e) => setCustomName(e.target.value)}
                placeholder={tr("例如：本地 Ollama", "e.g. local Ollama", "예: 로컬 Ollama")} className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm" />
            </Field>
            <Field label="Base URL">
              <input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com/v1" className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm font-mono" />
            </Field>
          </div>
        )}

        {/* API Key (Codex uses the Codex CLI login instead) */}
        {isCodex ? (
          <CodexLoginCard status={codexStatus} onRecheck={() => setCodexStatusVersion((v) => v + 1)} />
        ) : (
        <Field label={apiKeyOptional ? tr("API Key（可选）", "API key (optional)", "API 키 (선택)") : tr("API Key", "API Key", "API 키")}>
          <div className="relative">
            <input
              type={showKey ? "text" : "password"} value={apiKey}
              onChange={(e) => setApiKey(e.target.value)} placeholder={apiKeyOptional ? tr("本地服务可留空", "Optional for local service", "로컬 서비스는 비워 둬도 됩니다") : "sk-..."}
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 pr-10 text-sm font-mono"
            />
            <button type="button" onClick={() => setShowKey((v) => !v)}
              aria-label={showKey ? tr("隐藏 API Key", "Hide API key", "API 키 숨기기") : tr("显示 API Key", "Show API key", "API 키 보기")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground transition-colors">
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </Field>
        )}

        {/* Actions + feedback */}
        <div className="flex items-center gap-2">
          <button onClick={handleTest} disabled={isBusy}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs rounded-lg border border-border/60 hover:bg-secondary/50 transition-colors disabled:opacity-50">
            {status.state === "testing" && <Loader2 size={12} className="animate-spin" />}
            {tr("测试连接", "Test connection", "연결 테스트")}
          </button>
          <button onClick={handleSave} disabled={isBusy}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
            {status.state === "saving" && <Loader2 size={12} className="animate-spin" />}
            {tr("保存", "Save", "저장")}
          </button>
          {(isConnected || isCustom) && (
            <button onClick={handleDelete} disabled={isBusy}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50">
              <Trash2 size={12} />
              {tr("删除配置", "Delete config", "설정 삭제")}
            </button>
          )}
          {/* Status feedback */}
          {status.state === "connected" && (
            <span className="text-xs text-emerald-500">
              {saveFeedback ?? (
                <>
                  {tr(`连接成功，${models.length} 个模型`, `Connected, ${models.length} models`, `연결 성공, 모델 ${models.length}개`)}
                  {detectedModel
                    ? tr(
                        `，已自动匹配 ${detectedModel}${detectedConfig ? ` / ${detectedConfig.apiFormat === "anthropic" ? "Anthropic Messages" : detectedConfig.apiFormat === "responses" ? "Responses" : "Chat / Completions"} / ${detectedConfig.stream ? "流式" : "非流式"}` : ""}`,
                        `, auto-matched ${detectedModel}${detectedConfig ? ` / ${detectedConfig.apiFormat === "anthropic" ? "Anthropic Messages" : detectedConfig.apiFormat === "responses" ? "Responses" : "Chat / Completions"} / ${detectedConfig.stream ? "streaming" : "non-streaming"}` : ""}`,
                        isCodex
                          ? `, 자동 선택된 모델: ${detectedModel}`
                          : `, 자동 선택: ${detectedModel}${detectedConfig ? ` / ${detectedConfig.apiFormat === "anthropic" ? "Anthropic Messages" : detectedConfig.apiFormat === "responses" ? "Responses" : "Chat / Completions"} / ${detectedConfig.stream ? "스트리밍" : "비스트리밍"}` : ""}`,
                      )
                    : ""}
                </>
              )}
            </span>
          )}
          {status.state === "error" && (
            <span className="text-xs text-destructive">{status.message}</span>
          )}
          {status.state === "saved" && (
            <span className="text-xs text-emerald-500">{saveFeedback ?? tr("已保存", "Saved", "저장했습니다")}</span>
          )}
        </div>

        {!isCodex && (
        <div className="grid grid-cols-2 gap-4">
          <Field label={tr("协议类型", "Protocol", "프로토콜")}>
            <select
              value={apiFormat}
              onChange={(e) => setApiFormat(e.target.value as LLMApiFormat)}
              className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm"
            >
              <option value="chat">OpenAI Chat Completions</option>
              <option value="responses">OpenAI Responses</option>
              <option value="anthropic">Anthropic Messages</option>
            </select>
          </Field>

          <Field label={tr("流式响应", "Streaming", "스트리밍 응답")}>
            <label className="flex h-10 items-center gap-2 rounded-lg border border-border/60 bg-background px-3 text-sm">
              <input
                type="checkbox"
                checked={stream}
                onChange={(e) => setStream(e.target.checked)}
              />
              <span>{stream ? tr("开启", "On", "켜짐") : tr("关闭", "Off", "꺼짐")}</span>
            </label>
          </Field>
        </div>
        )}

        {/* Models */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground/70 font-medium uppercase tracking-wider">
            {tr(`模型目录（${models.length}）`, `Model catalog (${models.length})`, `모델 목록 (${models.length})`)}
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={modelIdInput}
              onChange={(event) => setModelIdInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleAddModel();
                }
              }}
              placeholder={isCodex
                ? tr("输入 Codex 模型 ID，例如 gpt-5.4", "Enter a Codex model ID, e.g. gpt-5.4", "Codex 모델 ID 입력, 예: gpt-5.4")
                : tr("输入模型 ID，例如 gemini-3.1-pro", "Enter a model ID, e.g. gemini-3.1-pro", "모델 ID 입력, 예: gemini-3.1-pro")}
              className="min-w-0 flex-1 rounded-lg border border-border/60 bg-background px-3 py-2 text-sm font-mono"
            />
            <button
              type="button"
              onClick={handleAddModel}
              disabled={!modelIdInput.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-2 text-xs hover:bg-secondary/50 disabled:opacity-40"
            >
              <Plus size={13} />
              {tr("添加", "Add", "추가")}
            </button>
          </div>
          <p className="text-xs text-muted-foreground/60">
            {tr("先点“测试连接”拉取最新列表，再点“保存”写入创作选择器。内置目录只在还没有保存过快照时作为兜底。", "Click “Test connection” to fetch the latest list, then “Save” to write it into the writing picker. The built-in catalog is only a fallback before a snapshot is saved.", "“연결 테스트”로 최신 목록을 불러온 뒤 “저장”을 누르면 창작 화면의 모델 선택 목록에 반영됩니다. 기본 목록은 아직 저장한 목록이 없을 때만 쓰입니다.")}
          </p>
          {hasModelCatalog && (
          <div className="space-y-2">
            {models.length > 0 ? (
              <div className="flex gap-1.5 flex-wrap">
                {models.map((m) => (
                  <span key={m.id} className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md bg-emerald-500/[0.06] text-emerald-600 dark:text-emerald-400 border border-emerald-500/15">
                    {m.name ?? m.id}
                    <button
                      type="button"
                      onClick={() => handleRemoveModel(m.id)}
                      aria-label={tr(`移除模型 ${m.id}`, `Remove model ${m.id}`, `모델 ${m.id} 제거`)}
                      className="rounded-sm opacity-60 hover:opacity-100"
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground/60">{tr("点击“测试连接”查看可用模型", "Click “Test connection” to list available models", "“연결 테스트”를 눌러 사용할 수 있는 모델을 확인하세요")}</p>
            )}
          </div>
          )}
        </div>

        {/* Advanced params (the Codex backend rejects temperature) */}
        {!isCodex && (
        <details className="group pt-2 border-t border-border/20">
          <summary className="text-xs text-muted-foreground/60 cursor-pointer select-none hover:text-muted-foreground transition-colors py-2">
            {tr("高级参数", "Advanced", "고급 설정")}
          </summary>
          <div className="space-y-4 pt-2">
            <Field label="temperature">
              <div className="flex items-center gap-3">
                <input type="range" min="0" max="2" step="0.05" value={temperature}
                  onChange={(e) => setTemperature(e.target.value)} className="flex-1 accent-primary h-1" />
                <input type="number" value={temperature} onChange={(e) => setTemperature(e.target.value)}
                  min="0" max="2" step="0.05" className="w-16 rounded-md border border-border/60 bg-background px-2 py-1 text-xs text-right font-mono" />
              </div>
            </Field>
          </div>
        </details>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs text-muted-foreground/70 font-medium">{label}</label>
      {children}
    </div>
  );
}
