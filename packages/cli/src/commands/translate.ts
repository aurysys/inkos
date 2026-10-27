import { Command } from "commander";
import {
  createTranslationCreateTool,
  createTranslationRunTool,
  createTranslationExportTool,
  createBuiltInWorkProfileRegistry,
  executeExplicitCapabilityTool,
  loadAvailableAgentSkills,
  PipelineRunner,
  resolveProfileSkillActivations,
} from "@actalk/inkos-core";
import { buildPipelineConfig, findProjectRoot, loadConfig, log, logError } from "../utils.js";
import { uiText } from "../ui-locale.js";

export const translateCommand = new Command("translate")
  .description(uiText("Translate and localize novels/scripts across languages", "소설/대본을 다른 언어로 번역하고 현지화합니다"));

translateCommand
  .command("init")
  .description(uiText("Create a translation project from EPUB/PDF/TXT/Markdown", "EPUB/PDF/TXT/Markdown 파일로 번역 프로젝트를 만듭니다"))
  .requiredOption("--from <path>", uiText("Source file path", "원본 파일 경로"))
  .requiredOption("--source <language>", uiText("Source language, e.g. ja, en, zh, ko, auto", "원본 언어(예: ja, en, zh, ko, auto)"))
  .requiredOption("--target <language>", uiText("Target language, e.g. zh, en, ja", "번역할 언어(예: zh, en, ja)"))
  .option("--title <title>", uiText("Override translation title", "번역본 제목을 지정합니다"))
  .option("--segment-max-chars <n>", uiText("Max chars per segment before splitting long paragraphs", "긴 문단을 나누기 전 세그먼트당 최대 글자 수"), parseInt)
  .option("--json", uiText("Output JSON", "JSON으로 출력합니다"))
  .action(async (opts) => {
    try {
      const root = findProjectRoot();
      const action = await executeExplicitCapabilityTool({
        projectRoot: root,
        binding: { capabilityId: "translation", actionId: "translation_create", profileId: "translation", risk: "recoverable-write" },
        tool: createTranslationCreateTool(root),
        parameters: {
          filePath: opts.from,
          sourceLanguage: opts.source,
          targetLanguage: opts.target,
          title: opts.title,
          segmentMaxChars: opts.segmentMaxChars,
        },
      });
      const result = action.data as {
        manifest: { id: string; title: string; chapters: ReadonlyArray<unknown> };
        manifestPath: string;
      };
      if (opts.json) {
        log(JSON.stringify(result, null, 2));
      } else {
        log(uiText(`Translation project created: ${result.manifest.id}`, `번역 프로젝트를 만들었습니다: ${result.manifest.id}`));
        log(uiText(`Title: ${result.manifest.title}`, `제목: ${result.manifest.title}`));
        log(uiText(`Chapters: ${result.manifest.chapters.length}`, `챕터: ${result.manifest.chapters.length}`));
        log(uiText(`Manifest: ${result.manifestPath}`, `매니페스트: ${result.manifestPath}`));
      }
    } catch (error) {
      fail(uiText("Failed to create translation project", "번역 프로젝트를 만들지 못했습니다"), error, opts.json);
    }
  });

translateCommand
  .command("run")
  .description(uiText("Translate pending segments and write a review report", "남은 세그먼트를 번역하고 검토 보고서를 씁니다"))
  .argument("<project-id>", uiText("Translation Work ID", "번역 작품 ID"))
  .option("--batch-size <n>", uiText("Segments per model call", "모델 호출 한 번에 보낼 세그먼트 수"), parseInt)
  .option("--max-tokens <n>", uiText("Max output tokens per translation batch", "번역 배치당 최대 출력 토큰"), parseInt)
  .option("--json", uiText("Output JSON", "JSON으로 출력합니다"))
  .action(async (projectId: string, opts) => {
    try {
      const root = findProjectRoot();
      const config = await loadConfig({ requireApiKey: true, projectRoot: root });
      const configuredSkills = await loadAvailableAgentSkills({ projectRoot: root });
      const activatedSkills = resolveProfileSkillActivations(
        configuredSkills.skills,
        createBuiltInWorkProfileRegistry().require("translation"),
      );
      const pipeline = new PipelineRunner(buildPipelineConfig(config, root, { quiet: Boolean(opts.json) }));
      const action = await executeExplicitCapabilityTool({
        projectRoot: root,
        binding: { capabilityId: "translation", actionId: "translation_run", profileId: "translation", risk: "recoverable-write" },
        tool: createTranslationRunTool(pipeline, root, projectId, { defaultSkills: activatedSkills }),
        workId: projectId,
        parameters: { batchSize: opts.batchSize, maxTokens: opts.maxTokens },
      });
      const result = action.data as {
        translatedSegments: number;
        reviewedChapters: number;
        reportPath: string;
        skillIds: ReadonlyArray<string>;
      };
      if (opts.json) {
        log(JSON.stringify(result, null, 2));
      } else {
        log(uiText(`Skills: ${result.skillIds.join(", ")}`, `스킬: ${result.skillIds.join(", ")}`));
        log(uiText(`Translated segments: ${result.translatedSegments}`, `번역한 세그먼트: ${result.translatedSegments}`));
        log(uiText(`Reviewed chapters: ${result.reviewedChapters}`, `검토한 챕터: ${result.reviewedChapters}`));
        log(uiText(`Report: ${result.reportPath}`, `보고서: ${result.reportPath}`));
      }
    } catch (error) {
      fail(uiText("Translation run failed", "번역에 실패했습니다"), error, opts.json);
    }
  });

translateCommand
  .command("export")
  .description(uiText("Export translated text to Markdown/TXT/EPUB", "번역문을 Markdown/TXT/EPUB으로 내보냅니다"))
  .argument("<project-id>", uiText("Translation Work ID", "번역 작품 ID"))
  .option("--format <format>", uiText("Output format: md, txt, epub", "출력 형식: md, txt, epub"), "md")
  .option("--output <path>", uiText("Output file path", "출력 파일 경로"))
  .option("--json", uiText("Output JSON", "JSON으로 출력합니다"))
  .action(async (projectId: string, opts) => {
    try {
      const root = findProjectRoot();
      const action = await executeExplicitCapabilityTool({
        projectRoot: root,
        binding: { capabilityId: "translation", actionId: "translation_export", profileId: "translation", risk: "recoverable-write" },
        tool: createTranslationExportTool(root, projectId),
        workId: projectId,
        parameters: { format: opts.format, outputPath: opts.output },
      });
      const result = action.data as { chaptersExported: number; outputPath: string };
      if (opts.json) {
        log(JSON.stringify(result, null, 2));
      } else {
        log(uiText(`Exported ${result.chaptersExported} chapter(s)`, `챕터 ${result.chaptersExported}개를 내보냈습니다`));
        log(uiText(`Output: ${result.outputPath}`, `출력 파일: ${result.outputPath}`));
      }
    } catch (error) {
      fail(uiText("Translation export failed", "번역문을 내보내지 못했습니다"), error, opts.json);
    }
  });

function fail(prefix: string, error: unknown, json: boolean): never {
  if (json) {
    log(JSON.stringify({ error: String(error) }));
  } else {
    logError(`${prefix}: ${error}`);
  }
  process.exit(1);
}
