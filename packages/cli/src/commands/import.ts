import { Command } from "commander";
import {
  PipelineRunner,
  StateManager,
  createImportCanonTool,
  createImportChaptersTool,
  executeExplicitCapabilityTool,
} from "@actalk/inkos-core";
import { resolve } from "node:path";
import { loadConfig, buildPipelineConfig, findProjectRoot, resolveBookId, log, logError, resolveCliProfileSkills } from "../utils.js";
import {
  formatImportCanonComplete,
  formatImportCanonStart,
  formatImportChaptersComplete,
  formatImportChaptersResume,
  resolveCliLanguage,
} from "../localization.js";
import { isKoreanUi, uiText } from "../ui-locale.js";

export const importCommand = new Command("import")
  .description(uiText("Import external data into a book", "외부 데이터를 책으로 가져옵니다"));

importCommand
  .command("canon")
  .description(uiText("Import parent book's canon for spinoff writing", "외전을 쓰기 위해 원작 책의 정식 설정을 가져옵니다"))
  .argument("[target-book-id]", uiText("Target book ID (auto-detected if only one book)", "대상 책 ID(책이 하나뿐이면 자동으로 찾습니다)"))
  .requiredOption("--from <parent-book-id>", uiText("Parent book ID to import canon from", "정식 설정을 가져올 원작 책 ID"))
  .option("--json", uiText("Output JSON", "JSON으로 출력합니다"))
  .action(async (targetBookIdArg: string | undefined, opts) => {
    try {
      const root = findProjectRoot();
      const targetBookId = await resolveBookId(targetBookIdArg, root);
      const config = await loadConfig();
      const state = new StateManager(root);
      const targetBook = await state.loadBookConfig(targetBookId);
      const language = resolveCliLanguage(targetBook.language);

      const pipeline = new PipelineRunner(buildPipelineConfig(config, root));

      if (!opts.json) log(formatImportCanonStart(language, opts.from, targetBookId));

      await executeExplicitCapabilityTool({
        projectRoot: root,
        binding: { capabilityId: "longform", actionId: "import_canon", profileId: "longform-novel", risk: "recoverable-write" },
        tool: createImportCanonTool(pipeline, targetBookId),
        workId: targetBookId,
        parameters: { parentBookId: opts.from },
      });

      if (opts.json) {
        log(JSON.stringify({
          targetBookId,
          parentBookId: opts.from,
          output: "story/parent_canon.md",
        }, null, 2));
      } else {
        for (const line of formatImportCanonComplete(language)) {
          log(line);
        }
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(uiText(`Canon import failed: ${e}`, `정식 설정을 가져오지 못했습니다: ${e}`));
      }
      process.exit(1);
    }
  });

importCommand
  .command("chapters")
  .description(uiText("Import existing chapters for continuation writing. Reverse-engineers all truth files.", "이어쓰기를 위해 기존 챕터를 가져옵니다. 모든 설정 파일을 본문에서 역으로 추출합니다."))
  .argument("[book-id]", uiText("Target book ID (auto-detected if only one book)", "대상 책 ID(책이 하나뿐이면 자동으로 찾습니다)"))
  .requiredOption("--from <path>", uiText("Path to a text file (auto-split) or directory of .md/.txt files", "텍스트 파일(자동 분할) 또는 .md/.txt 파일이 든 디렉터리 경로"))
  .option("--split <regex>", uiText("Custom regex for chapter splitting (single-file mode)", "챕터 분할에 쓸 사용자 정규식(단일 파일 모드)"))
  .option("--resume-from <n>", uiText("Resume from chapter N (for interrupted imports)", "N장부터 이어서 가져옵니다(중단된 가져오기용)"), parseInt)
  .option("--series", uiText("Treat as a new series (shared universe, independent story) instead of direct continuation", "바로 이어지는 속편이 아닌 새 시리즈(세계관 공유, 독립된 이야기)로 취급합니다"))
  .option("--json", uiText("Output JSON", "JSON으로 출력합니다"))
  .action(async (bookIdArg: string | undefined, opts) => {
    try {
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const config = await loadConfig();

      const state = new StateManager(root);
      const book = await state.loadBookConfig(bookId);
      const language = resolveCliLanguage(book.language);
      const existingChapterCount = (await state.getNextChapterNumber(bookId)) - 1;
      if (existingChapterCount > 0 && !opts.resumeFrom) {
        throw new Error(uiText(
          `Book "${bookId}" already has ${existingChapterCount} chapter(s). ` +
          `Use --resume-from <n> to append, or delete existing chapters first.`,
          `책 "${bookId}"에 이미 챕터 ${existingChapterCount}개가 있습니다. ` +
          `--resume-from <n>으로 이어 붙이거나 기존 챕터를 먼저 삭제하세요.`,
        ));
      }

      const fromPath = resolve(opts.from);
      if (!opts.json) {
        log(isKoreanUi()
          ? `"${fromPath}"에서 챕터를 읽어 "${bookId}"(으)로 가져오는 중입니다.`
          : language === "en"
            ? `Reading chapters from "${fromPath}" for import into "${bookId}".`
            : `正在读取「${fromPath}」，准备导入到「${bookId}」。`);
        if (opts.resumeFrom) {
          log(formatImportChaptersResume(language, opts.resumeFrom));
        }
      }

      const pipeline = new PipelineRunner(buildPipelineConfig(config, root));

      const activatedSkills = await resolveCliProfileSkills(root, "longform-novel", {
        extraSkillIds: ["inkos-story-import"],
      });
      const action = await executeExplicitCapabilityTool({
        projectRoot: root,
        binding: { capabilityId: "longform", actionId: "import_chapters", profileId: "longform-novel", risk: "recoverable-write" },
        tool: createImportChaptersTool(pipeline, bookId, root, { defaultSkills: activatedSkills }),
        workId: bookId,
        parameters: {
          bookId,
          sourcePath: fromPath,
          ...(opts.split ? { splitPattern: opts.split } : {}),
          ...(opts.resumeFrom ? { resumeFrom: opts.resumeFrom } : {}),
          importMode: opts.series ? "series" : "continuation",
        },
      });
      const result = action.data as {
        readonly importedCount: number;
        readonly totalWords: number;
        readonly nextChapter: number;
      };

      if (opts.json) {
        log(JSON.stringify(result, null, 2));
      } else {
        for (const line of formatImportChaptersComplete(language, {
          importedCount: result.importedCount,
          totalWords: result.totalWords,
          nextChapter: result.nextChapter,
          continueBookId: bookId,
        })) {
          log(line);
        }
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(uiText(`Chapter import failed: ${e}`, `챕터를 가져오지 못했습니다: ${e}`));
      }
      process.exit(1);
    }
  });
