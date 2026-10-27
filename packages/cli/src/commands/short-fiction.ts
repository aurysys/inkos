import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  SHORT_FICTION_DEFAULT_CHAPTERS,
  SHORT_FICTION_DEFAULT_CHARS_PER_CHAPTER,
  SHORT_FICTION_EN_DEFAULT_WORDS_PER_CHAPTER,
  activatedSkillIds,
  createBuiltInWorkProfileRegistry,
  createShortFictionRunTool,
  createShortFictionReviseTool,
  executeExplicitCapabilityTool,
  loadAvailableAgentSkills,
  PipelineRunner,
  resolveProfileSkillActivations,
  type ShortFictionReference,
  type ShortFictionLanguage,
} from "@actalk/inkos-core";
import { buildPipelineConfig, findProjectRoot, loadConfig, log, logError, resolveCliProfileSkills } from "../utils.js";
import { uiText } from "../ui-locale.js";

export { extractResponsesImageBase64, resolveCoverApiKey } from "@actalk/inkos-core";

export const shortCommand = new Command("short")
  .description(uiText("Short fiction production workflow", "단편소설 제작 워크플로"));

shortCommand.command("revise")
  .description(uiText("Revise a complete short-fiction Work using its review and update its sales package", "완성된 단편소설 작품을 검토 결과에 따라 수정하고 판매용 패키지를 갱신합니다"))
  .argument("<story-id>")
  .requiredOption("--instruction <text>",uiText("Revision direction", "수정 방향"))
  .option("--chars <n>",uiText("Target native length per chapter", "챕터당 목표 분량(집필 언어 기준 단위)"),"1000")
  .option("--model <model>",uiText("Whole-story revision model", "작품 전체 수정에 쓸 모델"),"deepseek-v4-pro")
  .option("--chapters <numbers>",uiText("Limit revision to comma-separated chapter numbers", "쉼표로 구분한 챕터 번호만 수정합니다"))
  .option("--json",uiText("Output JSON", "JSON으로 출력합니다"))
  .action(async(storyId:string,opts)=>{
    try {
      const root=findProjectRoot();const config=await loadConfig({projectRoot:root});
      config.modelOverrides={...config.modelOverrides,"short-reviser":opts.model};
      const pipeline=new PipelineRunner(buildPipelineConfig(config,root,{quiet:opts.json}));
      const skills=await resolveCliProfileSkills(root,"short-fiction");
      const result=await executeExplicitCapabilityTool({projectRoot:root,
        binding:{capabilityId:"short-fiction",actionId:"revise_short_fiction",profileId:"short-fiction",risk:"recoverable-write"},
        tool:createShortFictionReviseTool(pipeline,root,storyId,{activeSkills:()=>skills}),workId:storyId,
        parameters:{instruction:opts.instruction,charsPerChapter:parsePositiveInteger(opts.chars,1000,"chars"),...(opts.chapters?{chapterNumbers:opts.chapters.split(",").map((number:string)=>parsePositiveInteger(number.trim(),1,"chapter"))}:{})},
      });
      log(opts.json?JSON.stringify(result,null,2):result.content??result.summary);
    } catch(error) {logCommandError("Short revision failed","단편 수정에 실패했습니다",error,opts.json);process.exitCode=1;}
  });

shortCommand
  .command("run")
  .description(uiText("Run a short fiction chain from a direction", "주어진 방향으로 단편소설 제작 과정을 실행합니다"))
  .requiredOption("--direction <text>", uiText(
    "Story direction, e.g. \"女频短篇 婚姻背叛 证据反杀\" or \"female-lead short: marriage betrayal, evidence payback\"",
    "이야기 방향, 예: \"여성향 단편: 결혼 배신, 증거로 반격\"",
  ))
  .option("--reference <path>", uiText("Optional reference notes/text", "참고 메모/텍스트(선택)"))
  .option("--story-id <id>", uiText("Work id for the generated short fiction", "생성할 단편소설의 작품 ID"))
  .option("--lang <language>", uiText("Writing language: zh or en", "집필 언어: zh 또는 en"), "zh")
  .option("--chapters <n>", uiText("Complete short chapter count", "완성할 단편의 챕터 수"), String(SHORT_FICTION_DEFAULT_CHAPTERS))
  .option("--chars <n>", uiText("Per-chapter length: zh characters or en words", "챕터당 분량: zh는 글자 수, en은 단어 수"))
  .option("--min-chapter-length-ratio <ratio>", uiText("Minimum complete chapter length relative to target (0 < ratio <= 1)", "목표 대비 완성 챕터의 최소 분량 비율(0 < ratio <= 1)"), "0.5")
  .option("--llm-base-url <url>", uiText("Override LLM base URL", "LLM 기본 URL을 지정합니다"))
  .option("--model <model>", uiText("Fallback model for all short stages", "모든 단편 단계에 쓸 기본 모델"))
  .option("--planner-model <model>", uiText("Model for outline creation", "개요 작성에 쓸 모델"))
  .option("--writer-model <model>", uiText("Model for first full draft", "첫 전체 초안 작성에 쓸 모델"))
  .option("--draft-review-model <model>", uiText("Model for draft review", "초안 검토에 쓸 모델"))
  .option("--package-model <model>", uiText("Model for synopsis and cover prompt packaging", "줄거리 요약과 표지 프롬프트 작성에 쓸 모델"))
  .option("--cover-base-url <url>", uiText("Image API base URL; defaults to the project cover service", "이미지 API 기본 URL(기본값은 프로젝트의 표지 서비스)"))
  .option("--cover-endpoint <url>", uiText("Exact image endpoint; overrides --cover-base-url", "이미지 엔드포인트 전체 URL. --cover-base-url보다 우선합니다"))
  .option("--cover-model <model>", uiText("Image model; defaults to the project cover model", "이미지 모델(기본값은 프로젝트의 표지 모델)"))
  .option("--cover-size <size>", uiText("Cover image size", "표지 이미지 크기"), "1024x1360")
  .option("--cover-api-key-env <name>", uiText("Env var containing cover API key", "표지 API 키를 담은 환경 변수"), "INKOS_COVER_API_KEY")
  .option("--no-cover", uiText("Skip cover image generation", "표지 이미지 생성을 건너뜁니다"))
  .option("--json", uiText("Output JSON", "JSON으로 출력합니다"))
  .action(async (opts: ShortRunOptions) => {
    try {
      const root = findProjectRoot();
      const language = parseShortFictionLanguage(opts.lang);
      const chapterCount = parsePositiveInteger(
        opts.chapters,
        SHORT_FICTION_DEFAULT_CHAPTERS,
        "chapters",
      );
      const charsPerChapter = opts.chars === undefined
        ? undefined
        : parsePositiveInteger(
            opts.chars,
            language === "en" ? SHORT_FICTION_EN_DEFAULT_WORDS_PER_CHAPTER : SHORT_FICTION_DEFAULT_CHARS_PER_CHAPTER,
            "chars",
          );
      const reference = opts.reference ? await readReference(root, opts.reference) : undefined;
      const models = resolveShortRunModels(opts);
      const configuredSkills = await loadAvailableAgentSkills({ projectRoot: root });
      const activatedSkills = resolveProfileSkillActivations(
        configuredSkills.skills,
        createBuiltInWorkProfileRegistry().require("short-fiction"),
      );

      const config = await loadConfig({ projectRoot: root });
      if (opts.llmBaseUrl) config.llm.baseUrl = opts.llmBaseUrl;
      if (opts.model) config.llm.model = opts.model;
      const modelOverrides = { ...(config.modelOverrides ?? {}) };
      const stageModels = {
        "short-outline": models.planner,
        "short-writer": models.writer,
        "short-draft-review": models.draftReview,
        "short-package": models.package,
      };
      for (const [stage, model] of Object.entries(stageModels)) {
        if (model) modelOverrides[stage] = model;
      }
      config.modelOverrides = modelOverrides;
      const pipeline = new PipelineRunner(buildPipelineConfig(config, root, { quiet: Boolean(opts.json) }));
      const action = await executeExplicitCapabilityTool({
        projectRoot: root,
        binding: { capabilityId: "short-fiction", actionId: "short_fiction_run", profileId: "short-fiction", risk: "recoverable-write" },
        tool: createShortFictionRunTool(pipeline, root, { language, defaultSkills: activatedSkills }),
        parameters: {
          direction: opts.direction,
          reference: reference?.text,
          storyId: opts.storyId,
          chapters: chapterCount,
          charsPerChapter,
          minChapterLengthRatio: Number(opts.minChapterLengthRatio),
          language,
          cover: opts.cover,
          coverBaseUrl: opts.coverBaseUrl,
          coverEndpoint: opts.coverEndpoint,
          coverModel: opts.coverModel,
          coverSize: opts.coverSize,
          coverApiKeyEnv: opts.coverApiKeyEnv,
        },
        onUpdate: opts.json ? undefined : (update) => {
          const text = (update as { content?: Array<{ type?: string; text?: string }> }).content
            ?.filter((item) => item.type === "text")
            .map((item) => item.text ?? "")
            .join("\n")
            .trim();
          if (text) log(text);
        },
      });
      const result = action.data as {
        storyId: string;
        finalMarkdownPath: string;
        salesPackagePath: string;
        coverImagePath?: string;
        coverError?: string;
      };

      const payload = {
        ...result,
        models,
      };

      if (opts.json) {
        log(JSON.stringify(payload, null, 2));
      } else {
        log(uiText(`Skills: ${activatedSkillIds(activatedSkills).join(", ")}`, `스킬: ${activatedSkillIds(activatedSkills).join(", ")}`));
        log(uiText(`Short run complete: ${result.storyId}`, `단편 제작을 마쳤습니다: ${result.storyId}`));
        log(uiText(`Final: ${payload.finalMarkdownPath}`, `완성본: ${payload.finalMarkdownPath}`));
        log(uiText(`Sales package: ${payload.salesPackagePath}`, `판매용 패키지: ${payload.salesPackagePath}`));
        log(formatCoverStatus(payload.coverImagePath, payload.coverError));
      }
    } catch (e) {
      logCommandError("Short run failed", "단편 제작에 실패했습니다", e, opts.json);
    }
  });

interface ShortRunOptions {
  readonly direction: string;
  readonly reference?: string;
  readonly storyId?: string;
  readonly lang: string;
  readonly chapters?: string;
  readonly chars?: string;
  readonly minChapterLengthRatio?: string;
  readonly llmBaseUrl?: string;
  readonly model?: string;
  readonly plannerModel?: string;
  readonly writerModel?: string;
  readonly draftReviewModel?: string;
  readonly packageModel?: string;
  readonly coverBaseUrl?: string;
  readonly coverEndpoint?: string;
  readonly coverModel?: string;
  readonly coverSize?: string;
  readonly coverApiKeyEnv?: string;
  readonly cover?: boolean;
  readonly json?: boolean;
}

function parseShortFictionLanguage(value: string): ShortFictionLanguage {
  if (value === "zh" || value === "en") return value;
  throw new Error(uiText("lang must be zh or en.", "lang은 zh 또는 en이어야 합니다."));
}

interface ShortRunModels {
  readonly planner?: string;
  readonly writer?: string;
  readonly draftReview?: string;
  readonly package?: string;
}

function resolveShortRunModels(options: ShortRunOptions): ShortRunModels {
  return {
    planner: options.plannerModel || options.model,
    writer: options.writerModel || options.model,
    draftReview: options.draftReviewModel || options.model,
    package: options.packageModel || options.model,
  };
}

async function readReference(root: string, path: string): Promise<ShortFictionReference> {
  const resolved = resolve(root, path);
  return {
    path,
    text: await readFile(resolved, "utf-8"),
  };
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  const parsed = value ? Number.parseInt(value, 10) : fallback;
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(uiText(`${name} must be a positive integer.`, `${name}은(는) 양의 정수여야 합니다.`));
  }
  return parsed;
}

function formatCoverStatus(coverImagePath?: string, coverError?: string): string {
  if (coverImagePath) return uiText(`Cover: ${coverImagePath}`, `표지: ${coverImagePath}`);
  if (coverError) return uiText(`Cover: skipped (${coverError})`, `표지: 건너뜀 (${coverError})`);
  return uiText("Cover: skipped", "표지: 건너뜀");
}

function logCommandError(prefix: string, koPrefix: string, error: unknown, json?: boolean): void {
  if (json) {
    const details=error&&typeof error==="object"?error as Record<string,unknown>:{};
    log(JSON.stringify({ error: `${prefix}: ${String(error)}`,code:details.code,stopReason:details.stopReason,resultTool:details.resultTool,lastToolError:details.lastToolError,lastAssistantText:details.lastAssistantText }, null, 2));
    return;
  }
  logError(`${uiText(prefix, koPrefix)}: ${String(error)}`);
}
