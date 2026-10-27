import { useEffect, useRef, useState } from "react";
import { Bell, Bot, FolderUp, Languages, MessageSquare, Radar, Search, Settings2, Plus, Trash2 } from "lucide-react";
import { fetchJson, postApi, putApi, useApi } from "../hooks/use-api";
import { usePreferencesStore } from "../store/preferences";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { getUiLocale, isWritingLanguage, tr, type WritingLanguage } from "../lib/app-language";
import {
  buildDetectionConfig,
  buildNotifyChannel,
  DEFAULT_DETECTION,
  detectionDraftFromConfig,
  notifyDraftFromChannel,
  NOTIFY_TYPES,
  type DetectionDraft,
  type NotifyChannelDraft,
  type NotifyType,
  type OverrideRow,
} from "./project-settings-model";
import {
  serializeSkillFolder,
  type StudioSkill,
} from "./skill-ui-state";

interface Nav {
  toDashboard: () => void;
  toServices: () => void;
}

type NoticeTone = "success" | "error" | "info";

interface SkillsResponse {
  readonly skills: ReadonlyArray<StudioSkill>;
  readonly diagnostics?: ReadonlyArray<{ readonly path?: string; readonly message?: string }>;
}

interface ResearchSearchDraft {
  readonly enabled: boolean;
  readonly provider: "tavily" | "custom";
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly apiKeyEnv: string;
}

const DEFAULT_RESEARCH_SEARCH: ResearchSearchDraft = {
  enabled: false,
  provider: "tavily",
  baseUrl: "",
  apiKey: "",
  apiKeyEnv: "TAVILY_API_KEY",
};

// Smooth open/close via grid-template-rows (same trick as the sidebar).
function Collapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}

function SettingsCard({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border/50 bg-card/70 p-5 shadow-sm space-y-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-xl bg-primary/10 p-2 text-primary">{icon}</div>
        <div>
          <h2 className="text-base font-bold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

const fieldClass = "w-full rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm outline-none focus:border-primary/50";

export function ProjectSettings({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { data: overridesData, refetch: refetchOverrides } = useApi<{ overrides: Record<string, unknown> }>("/project/model-overrides");
  const { data: defaultModelData, refetch: refetchDefaultModel } = useApi<{ service: string | null; defaultModel: string | null }>("/project/default-model");
  const { data: researchSearchData, refetch: refetchResearchSearch } = useApi<{ researchSearch: Partial<ResearchSearchDraft> }>("/project/research-search");
  const { data: notifyData, refetch: refetchNotify } = useApi<{ channels: unknown[] }>("/project/notify");
  const { data: detectionData, refetch: refetchDetection } = useApi<{ detection: unknown | null }>("/project/detection");
  const { data: skillsData, refetch: refetchSkills } = useApi<SkillsResponse>("/skills");
  const [defaultService, setDefaultService] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [researchSearch, setResearchSearch] = useState<ResearchSearchDraft>({ ...DEFAULT_RESEARCH_SEARCH });
  const [overrideRows, setOverrideRows] = useState<OverrideRow[]>([]);
  const [notifyChannels, setNotifyChannels] = useState<NotifyChannelDraft[]>([]);
  const [det, setDet] = useState<DetectionDraft>({ ...DEFAULT_DETECTION });
  const [notice, setNotice] = useState<{ tone: NoticeTone; message: string } | null>(null);
  const { data: projectData, refetch: refetchProject } = useApi<{ language: string }>("/project");
  const writingLanguage: WritingLanguage = isWritingLanguage(projectData?.language) ? projectData.language : "zh";
  const [saving, setSaving] = useState<string | null>(null);
  const skillFolderInputRef = useRef<HTMLInputElement>(null);
  const toolDetailsDefaultOpen = usePreferencesStore((s) => s.toolDetailsDefaultOpen);
  const setToolDetailsDefaultOpen = usePreferencesStore((s) => s.setToolDetailsDefaultOpen);
  const skills = skillsData?.skills ?? [];

  useEffect(() => {
    if (!overridesData) return;
    setOverrideRows(Object.entries(overridesData.overrides ?? {}).map(([agent, val]) => {
      if (typeof val === "string") return { agent, model: val };
      const { model, ...rest } = (val ?? {}) as { model?: string };
      return { agent, model: model ?? "", rest };
    }));
  }, [overridesData]);

  useEffect(() => {
    if (!defaultModelData) return;
    setDefaultService(defaultModelData.service ?? "");
    setDefaultModel(defaultModelData.defaultModel ?? "");
  }, [defaultModelData]);

  useEffect(() => {
    if (!researchSearchData) return;
    const raw = researchSearchData.researchSearch ?? {};
    setResearchSearch({
      ...DEFAULT_RESEARCH_SEARCH,
      ...raw,
      provider: raw.provider === "custom" ? "custom" : "tavily",
      baseUrl: raw.baseUrl ?? "",
      apiKey: raw.apiKey ?? "",
      apiKeyEnv: raw.apiKeyEnv ?? "TAVILY_API_KEY",
    });
  }, [researchSearchData]);

  useEffect(() => {
    if (!notifyData) return;
    setNotifyChannels((notifyData.channels ?? []).map(notifyDraftFromChannel));
  }, [notifyData]);

  useEffect(() => {
    if (!detectionData) return;
    setDet(detectionDraftFromConfig(detectionData.detection));
  }, [detectionData]);

  const runSave = async (key: string, work: () => Promise<void>, success: string) => {
    setSaving(key);
    setNotice(null);
    try {
      await work();
      setNotice({ tone: "success", message: success });
    } catch (e) {
      setNotice({ tone: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(null);
    }
  };

  const importSkillFolder = async (files: FileList | null) => {
    if (!files?.length) return;
    await runSave("skill-import", async () => {
      const serialized = await serializeSkillFolder(files);
      await postApi("/skills/import", { files: serialized });
      await refetchSkills();
    }, tr("Skill 文件夹已导入", "Skill folder imported", "스킬 폴더를 가져왔습니다"));
  };

  const updateChannel = (index: number, patch: Partial<NotifyChannelDraft>) => {
    setNotifyChannels((prev) => prev.map((ch, i) => (i === index ? { ...ch, ...patch } : ch)));
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.home")}</button>
        <span className="text-border">/</span>
        <span>{t("settings.title")}</span>
      </div>

      <div className="space-y-2">
        <h1 className="font-serif text-3xl flex items-center gap-3">
          <Settings2 size={28} className="text-primary" />
          {t("settings.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("settings.subtitle")}</p>
      </div>

      {notice && (
        <div
          className={`rounded-xl px-4 py-3 text-sm ${
            notice.tone === "error"
              ? "bg-destructive/10 text-destructive"
              : notice.tone === "info"
                ? "bg-secondary text-muted-foreground"
                : "bg-emerald-500/10 text-emerald-600"
          }`}
        >
          {notice.message}
        </div>
      )}

      {/* Default writing language for new Works (existing books keep their own language). */}
      <SettingsCard
        title={tr("默认写作语言", "Default writing language", "기본 집필 언어")}
        description={tr(
          "新建书籍默认使用的正文语言。已有书籍保持各自的语言。韩语书籍使用英文提示词，并要求正文以韩语写作。",
          "Prose language for newly created books. Existing books keep their own language. Korean books run on the English prompt set with a Korean output contract.",
          "새로 만드는 책의 본문 언어입니다. 이미 있는 책은 각자의 언어를 유지합니다. 한국어 책은 영어 지시문에 '본문은 한국어로' 지시를 붙여 씁니다.",
        )}
        icon={<Languages size={18} />}
      >
        <select
          className={fieldClass}
          value={writingLanguage}
          disabled={saving === "writing-language"}
          onChange={(event) => {
            const next = event.target.value;
            if (!isWritingLanguage(next) || next === writingLanguage) return;
            void runSave("writing-language", async () => {
              await putApi("/project", { language: next });
              refetchProject();
            }, tr("已保存默认写作语言。", "Default writing language saved.", "기본 집필 언어를 저장했습니다."));
          }}
        >
          <option value="ko">{tr("韩语", "Korean", "한국어")}</option>
          <option value="zh">{tr("中文", "Chinese", "중국어")}</option>
          <option value="en">{tr("英文", "English", "영어")}</option>
        </select>
      </SettingsCard>

      {/* Chat UI preferences — applied immediately, persisted in this browser's localStorage */}
      <SettingsCard title={t("settings.chatUi")} description={t("settings.chatUiHint")} icon={<MessageSquare size={18} />}>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={toolDetailsDefaultOpen}
            onChange={(e) => setToolDetailsDefaultOpen(e.target.checked)}
          />
          {t("settings.toolDetailsDefaultOpen")}
        </label>
        <p className="text-xs text-muted-foreground">{t("settings.toolDetailsDefaultOpenHint")}</p>
      </SettingsCard>

      <SettingsCard
        title={tr("Agent Skills", "Agent Skills", "에이전트 스킬")}
        description={tr(
          "导入标准 SKILL.md 专业能力包。Chat 可以按意图自主使用，也可以在输入框用 + 号强制启用。",
          "Import standard SKILL.md expertise packages. Chat can choose a skill from intent, or you can force one from the + menu.",
          "표준 SKILL.md 전문 지식 패키지를 가져옵니다. 대화가 의도에 맞는 스킬을 스스로 고르며, 입력창의 + 메뉴에서 특정 스킬을 강제로 사용할 수도 있습니다.",
        )}
        icon={<Bot size={18} />}
      >
        <div className="space-y-3">
          {skillsData?.diagnostics?.length ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              <div className="font-semibold">{tr("部分外部 Skill 未加载", "Some external skills were not loaded", "일부 외부 스킬을 불러오지 못했습니다")}</div>
              {skillsData.diagnostics.slice(0, 8).map((item, index) => (
                <div key={`${item.path ?? "skill"}-${index}`} className="mt-1 break-all">
                  {item.path ? `${item.path}: ` : ""}{item.message ?? tr("格式无效", "Invalid format", "형식이 올바르지 않습니다")}
                </div>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-secondary/20 p-3">
            <div>
              <div className="text-sm font-semibold">{tr("导入外部 Skill", "Import external skill", "외부 스킬 가져오기")}</div>
              <p className="mt-1 text-xs text-muted-foreground">
                {tr(
                  "兼容 AgentSkills / OpenClaw：选择包含 SKILL.md 的完整文件夹，静态参考资料会一并导入；脚本不会自动执行。",
                  "AgentSkills / OpenClaw compatible: select a complete folder containing SKILL.md. Static references are imported; scripts are never auto-executed.",
                  "AgentSkills / OpenClaw 호환: SKILL.md가 들어 있는 폴더 전체를 선택하세요. 정적 참고 자료도 함께 가져오며, 스크립트는 자동으로 실행되지 않습니다.",
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => skillFolderInputRef.current?.click()}
              disabled={saving === "skill-import"}
              className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-40"
            >
              <FolderUp size={16} />
              {saving === "skill-import"
                ? tr("导入中...", "Importing...", "가져오는 중...")
                : tr("选择 Skill 文件夹", "Choose skill folder", "스킬 폴더 선택")}
            </button>
            <input
              ref={skillFolderInputRef}
              type="file"
              multiple
              className="hidden"
              {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
              onChange={(event) => {
                void importSkillFolder(event.currentTarget.files);
                event.currentTarget.value = "";
              }}
            />
          </div>
          {skills.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">{tr("还没有 Skill。", "No skills yet.", "아직 스킬이 없습니다.")}</p>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {skills.map((skill) => (
                <div key={skill.id} className="rounded-xl border border-border/60 bg-secondary/20 p-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="truncate text-sm font-semibold">{skill.name}</div>
                        <span className="rounded-full bg-background px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {skill.source ?? "skill"}
                        </span>
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] text-muted-foreground/70">@{skill.id}</div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{skill.description || tr("无说明", "No description", "설명 없음")}</p>
                    </div>
                    {skill.editable ? (
                      <button
                        type="button"
                        onClick={() => runSave(`delete-skill:${skill.id}`, async () => {
                          await fetchJson(`/skills/${encodeURIComponent(skill.id)}`, { method: "DELETE" });
                          await refetchSkills();
                        }, tr("Skill 已删除", "Skill deleted", "스킬을 삭제했습니다"))}
                        className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                        aria-label={tr(`删除 ${skill.name}`, `Delete ${skill.name}`, `${skill.name} 삭제`)}
                      >
                        <Trash2 size={14} />
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SettingsCard>

      {/* Model routing — per-agent model overrides */}
      <SettingsCard title={t("settings.modelOverrides")} description={t("settings.modelOverridesHint")} icon={<Bot size={18} />}>
        <div className="rounded-xl border border-border/60 bg-secondary/20 p-3 space-y-2">
          <div>
            <div className="text-sm font-semibold">{t("settings.globalDefaultModel")}</div>
            <p className="mt-1 text-xs text-muted-foreground">{t("settings.globalDefaultModelHint")}</p>
          </div>
          <div className="grid gap-2 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_auto]">
            <input
              value={defaultService}
              onChange={(e) => setDefaultService(e.target.value)}
              placeholder={t("settings.serviceId")}
              className={`${fieldClass} font-mono`}
            />
            <input
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
              placeholder={t("settings.modelId")}
              className={`${fieldClass} font-mono`}
            />
            <button
              onClick={() => runSave("default-model", async () => {
                await putApi("/project/default-model", {
                  service: defaultService.trim() || undefined,
                  defaultModel: defaultModel.trim(),
                });
                await refetchDefaultModel();
              }, t("settings.saved"))}
              disabled={saving === "default-model" || !defaultModel.trim()}
              className={`rounded-lg px-4 py-2 text-sm font-bold ${c.btnPrimary} disabled:opacity-40`}
            >
              {saving === "default-model" ? t("config.saving") : t("config.save")}
            </button>
          </div>
        </div>
        <div className="space-y-2">
          {overrideRows.length === 0 && (
            <p className="text-xs text-muted-foreground italic">{t("settings.noOverrides")}</p>
          )}
          {overrideRows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={row.agent}
                onChange={(e) => setOverrideRows((prev) => prev.map((r, j) => (j === i ? { ...r, agent: e.target.value } : r)))}
                placeholder={t("settings.agentName")}
                className={`${fieldClass} flex-1`}
              />
              <span className="text-muted-foreground">→</span>
              <input
                value={row.model}
                onChange={(e) => setOverrideRows((prev) => prev.map((r, j) => (j === i ? { ...r, model: e.target.value } : r)))}
                placeholder={t("settings.modelId")}
                className={`${fieldClass} flex-1 font-mono`}
              />
              <button
                onClick={() => setOverrideRows((prev) => prev.filter((_, j) => j !== i))}
                className="shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                aria-label={tr("移除", "remove", "삭제")}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setOverrideRows((prev) => [...prev, { agent: "", model: "" }])}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium ${c.btnSecondary}`}
          >
            <Plus size={14} /> {t("settings.addOverride")}
          </button>
          <button
            onClick={() => runSave("overrides", async () => {
              const overrides: Record<string, unknown> = {};
              for (const r of overrideRows) {
                const agent = r.agent.trim();
                const model = r.model.trim();
                if (!agent || !model) continue;
                overrides[agent] = r.rest && Object.keys(r.rest).length > 0 ? { ...r.rest, model } : model;
              }
              await putApi("/project/model-overrides", { overrides });
              await refetchOverrides();
            }, t("settings.saved"))}
            disabled={saving === "overrides"}
            className={`rounded-lg px-4 py-2 text-sm font-bold ${c.btnPrimary} disabled:opacity-40`}
          >
            {saving === "overrides" ? t("config.saving") : t("config.save")}
          </button>
          <button onClick={nav.toServices} className={`rounded-lg px-4 py-2 text-sm font-bold ${c.btnSecondary}`}>
            {t("settings.openModelConfig")}
          </button>
        </div>
      </SettingsCard>

      <SettingsCard
        title={tr("联网研究搜索服务", "Research Search Provider", "웹 리서치 검색 서비스")}
        description={tr(
          "给 research_web 配置外部搜索 API。未配置时仍可用服务器环境变量 TAVILY_API_KEY 作为兜底。",
          "Configure the external search API used by research_web. If unset, the server may still use TAVILY_API_KEY as a fallback.",
          "research_web이 사용할 외부 검색 API를 설정합니다. 설정하지 않으면 서버 환경 변수 TAVILY_API_KEY를 대신 사용할 수 있습니다.",
        )}
        icon={<Search size={18} />}
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={researchSearch.enabled}
            onChange={(e) => setResearchSearch((prev) => ({ ...prev, enabled: e.target.checked }))}
          />
          {tr("启用项目级搜索配置", "Enable project-level search config", "프로젝트 단위 검색 설정 사용")}
        </label>
        <Collapse open={researchSearch.enabled}>
          <div className="grid gap-2 pt-1 md:grid-cols-2">
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>{tr("搜索服务", "Provider", "검색 서비스")}</span>
              <select
                value={researchSearch.provider}
                onChange={(e) => setResearchSearch((prev) => ({ ...prev, provider: e.target.value === "custom" ? "custom" : "tavily" }))}
                className={fieldClass}
              >
                <option value="tavily">Tavily</option>
                <option value="custom">{tr("自定义 / Tavily 兼容", "Custom / Tavily-compatible", "사용자 지정 / Tavily 호환")}</option>
              </select>
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>{tr("API Key 环境变量名", "API key env var", "API 키 환경 변수 이름")}</span>
              <input
                value={researchSearch.apiKeyEnv}
                onChange={(e) => setResearchSearch((prev) => ({ ...prev, apiKeyEnv: e.target.value }))}
                placeholder="TAVILY_API_KEY"
                className={`${fieldClass} font-mono`}
              />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground md:col-span-2">
              <span>{tr("Base URL（可选，自定义兼容端点）", "Base URL (optional custom compatible endpoint)", "Base URL(선택, 사용자 지정 호환 엔드포인트)")}</span>
              <input
                value={researchSearch.baseUrl}
                onChange={(e) => setResearchSearch((prev) => ({ ...prev, baseUrl: e.target.value }))}
                placeholder="https://api.tavily.com/search"
                className={`${fieldClass} font-mono`}
              />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground md:col-span-2">
              <span>{tr("API Key（可选；留空则读环境变量）", "API key (optional; leave blank to use env var)", "API 키(선택, 비워 두면 환경 변수를 읽습니다)")}</span>
              <input
                value={researchSearch.apiKey}
                onChange={(e) => setResearchSearch((prev) => ({ ...prev, apiKey: e.target.value }))}
                type="password"
                placeholder={tr("可直接填 key，或只填环境变量名", "Paste key, or use env var only", "키를 직접 붙여 넣거나 환경 변수만 사용하세요")}
                className={`${fieldClass} font-mono`}
              />
            </label>
          </div>
        </Collapse>
        <button
          onClick={() => runSave("research-search", async () => {
            const next = {
              enabled: researchSearch.enabled,
              provider: researchSearch.provider,
              ...(researchSearch.baseUrl.trim() ? { baseUrl: researchSearch.baseUrl.trim() } : {}),
              ...(researchSearch.apiKey.trim() ? { apiKey: researchSearch.apiKey.trim() } : {}),
              ...(researchSearch.apiKeyEnv.trim() ? { apiKeyEnv: researchSearch.apiKeyEnv.trim() } : {}),
            };
            await putApi("/project/research-search", { researchSearch: next });
            await refetchResearchSearch();
          }, t("settings.saved"))}
          disabled={saving === "research-search"}
          className={`rounded-lg px-4 py-2 text-sm font-bold ${c.btnPrimary} disabled:opacity-40`}
        >
          {saving === "research-search" ? t("config.saving") : t("config.save")}
        </button>
      </SettingsCard>

      {/* Notification channels */}
      <SettingsCard title={t("settings.notify")} description={t("settings.notifyHint")} icon={<Bell size={18} />}>
        <div className="space-y-3">
          {notifyChannels.length === 0 && (
            <p className="text-xs text-muted-foreground italic">{t("settings.noChannels")}</p>
          )}
          {notifyChannels.map((ch, i) => (
            <div key={i} className="rounded-xl border border-border/60 bg-secondary/20 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <select
                  value={ch.type}
                  onChange={(e) => updateChannel(i, { type: e.target.value as NotifyType })}
                  className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none"
                >
                  {NOTIFY_TYPES.map((nt) => <option key={nt.value} value={nt.value}>{getUiLocale() === "ko" && nt.ko ? nt.ko : nt.label}</option>)}
                </select>
                <div className="flex-1" />
                <button
                  onClick={() => setNotifyChannels((prev) => prev.filter((_, j) => j !== i))}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                  aria-label={tr("移除", "remove", "삭제")}
                >
                  <Trash2 size={15} />
                </button>
              </div>
              {ch.type === "telegram" && (
                <div className="grid grid-cols-2 gap-2">
                  <input value={ch.botToken ?? ""} onChange={(e) => updateChannel(i, { botToken: e.target.value })} placeholder="botToken" className={`${fieldClass} font-mono`} />
                  <input value={ch.chatId ?? ""} onChange={(e) => updateChannel(i, { chatId: e.target.value })} placeholder="chatId" className={`${fieldClass} font-mono`} />
                </div>
              )}
              {(ch.type === "feishu" || ch.type === "wechat-work") && (
                <input value={ch.webhookUrl ?? ""} onChange={(e) => updateChannel(i, { webhookUrl: e.target.value })} placeholder="webhookUrl" className={`${fieldClass} font-mono`} />
              )}
              {ch.type === "webhook" && (
                <div className="grid grid-cols-2 gap-2">
                  <input value={ch.url ?? ""} onChange={(e) => updateChannel(i, { url: e.target.value })} placeholder="url" className={`${fieldClass} font-mono`} />
                  <input value={ch.secret ?? ""} onChange={(e) => updateChannel(i, { secret: e.target.value })} placeholder={tr("secret (可选)", "secret (optional)", "secret(선택)")} className={`${fieldClass} font-mono`} />
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setNotifyChannels((prev) => [...prev, { type: "feishu" }])}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium ${c.btnSecondary}`}
          >
            <Plus size={14} /> {t("settings.addChannel")}
          </button>
          <button
            onClick={() => runSave("notify", async () => {
              await putApi("/project/notify", { channels: notifyChannels.map(buildNotifyChannel) });
              await refetchNotify();
            }, t("settings.saved"))}
            disabled={saving === "notify"}
            className={`rounded-lg px-4 py-2 text-sm font-bold ${c.btnPrimary} disabled:opacity-40`}
          >
            {saving === "notify" ? t("config.saving") : t("config.save")}
          </button>
        </div>
      </SettingsCard>

      {/* AIGC detection */}
      <SettingsCard title={t("settings.detection")} description={t("settings.detectionHint")} icon={<Radar size={18} />}>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={det.enabled} onChange={(e) => setDet((d) => ({ ...d, enabled: e.target.checked }))} />
          {t("settings.detectionEnable")}
        </label>
        <Collapse open={det.enabled}>
          <div className="space-y-2 pt-1">
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-muted-foreground space-y-1">
                <span>{t("settings.detectionProvider")}</span>
                <select value={det.provider} onChange={(e) => setDet((d) => ({ ...d, provider: e.target.value }))} className={fieldClass}>
                  <option value="custom">custom</option>
                  <option value="gptzero">gptzero</option>
                  <option value="originality">originality</option>
                </select>
              </label>
              <label className="text-xs text-muted-foreground space-y-1">
                <span>{t("settings.detectionApiKeyEnv")}</span>
                <input value={det.apiKeyEnv} onChange={(e) => setDet((d) => ({ ...d, apiKeyEnv: e.target.value }))} placeholder="DETECTOR_API_KEY" className={`${fieldClass} font-mono`} />
              </label>
            </div>
            <label className="text-xs text-muted-foreground space-y-1 block">
              <span>{t("settings.detectionApiUrl")}</span>
              <input value={det.apiUrl} onChange={(e) => setDet((d) => ({ ...d, apiUrl: e.target.value }))} placeholder="https://..." className={`${fieldClass} font-mono`} />
            </label>
          </div>
        </Collapse>
        <button
          onClick={() => runSave("detection", async () => {
            const payload = { detection: buildDetectionConfig(det) };
            await fetchJson("/project/detection", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
            await refetchDetection();
          }, t("settings.saved"))}
          disabled={saving === "detection"}
          className={`rounded-lg px-4 py-2 text-sm font-bold ${c.btnPrimary} disabled:opacity-40`}
        >
          {saving === "detection" ? t("config.saving") : t("config.save")}
        </button>
      </SettingsCard>
    </div>
  );
}
