import { Command } from "commander";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import {
  createFanficBookTool,
  createRefreshFanficCanonTool,
  deriveBookIdFromTitle,
  executeExplicitCapabilityTool,
  PlatformSchema,
  PipelineRunner,
  type BookConfig,
  type FanficMode,
} from "@actalk/inkos-core";
import { loadConfig, buildPipelineConfig, findProjectRoot, resolveBookId, log, logError, resolveCliProfileSkills } from "../utils.js";
import {
  formatFanficCanonMissingError,
  formatFanficSourceDirEmptyError,
  resolveCliLanguage,
  resolveWritingLanguageOption,
  resolveChapterLengthOption,
} from "../localization.js";
import { uiText } from "../ui-locale.js";

export const fanficCommand = new Command("fanfic")
  .description(uiText("Fan fiction writing tools", "팬픽 집필 도구"));

fanficCommand
  .command("init")
  .description(uiText("Create a fanfic book from external source material", "외부 원작 자료로 팬픽 책을 만듭니다"))
  .requiredOption("--title <title>", uiText("Book title", "책 제목"))
  .requiredOption("--from <path>", uiText("Source file or directory (novel text, wiki, character docs)", "원작 파일 또는 디렉터리(소설 본문, 위키, 등장인물 문서)"))
  .option("--mode <mode>", uiText("Fanfiction boundary or mode in natural language", "팬픽의 범위 또는 방식(자연어로 지정)"), "canon")
  .option("--genre <genre>", uiText("Genre", "장르"), "other")
  .option("--platform <platform>", uiText("Target platform", "연재 플랫폼"), "other")
  .option("--target-chapters <n>", uiText("Target chapter count", "목표 챕터 수"), "100")
  .option("--chapter-words <n>", uiText("Length per chapter in the book's unit (default 3000; 5000 Korean characters incl. spaces for ko)", "챕터당 분량(책 단위 기준, 기본값 3000. ko는 공백 포함 5000자)"))
  .option("--lang <language>", uiText("Writing language: zh, en or ko. Defaults from the project.", "집필 언어: zh, en 또는 ko. 지정하지 않으면 프로젝트 설정을 따릅니다."))
  .option("--json", uiText("Output JSON", "JSON으로 출력합니다"))
  .action(async (opts) => {
    try {
      const config = await loadConfig();
      const root = findProjectRoot();

      const mode = opts.mode as FanficMode;

      // Read source material
      const sourcePath = resolve(opts.from);
      const sourceText = await readSourceMaterial(sourcePath);
      const sourceName = basename(sourcePath);

      if (!sourceText.trim()) throw new Error(uiText("Fanfic source material is empty.", "팬픽 원작 자료가 비어 있습니다."));

      const bookId = deriveBookIdFromTitle(opts.title) || `book-${Date.now().toString(36)}`;

      const now = new Date().toISOString();
      const writingLanguage = resolveWritingLanguageOption(opts.lang, config.language);
      const book: BookConfig = {
        id: bookId,
        title: opts.title,
        platform: PlatformSchema.parse(opts.platform ?? "other"),
        genre: opts.genre,
        status: "outlining",
        targetChapters: parseInt(opts.targetChapters, 10),
        chapterWordCount: resolveChapterLengthOption(opts.chapterWords, writingLanguage),
        language: writingLanguage,
        createdAt: now,
        updatedAt: now,
        fanficMode: mode,
      };

      if (!opts.json) log(uiText(
        `Creating fanfic "${book.title}" (${mode} mode, ${book.genre})...`,
        `팬픽 "${book.title}" 만드는 중(${mode} 방식, ${book.genre})...`,
      ));
      if (!opts.json) log(uiText(`  Source: ${sourceName} (${sourceText.length} chars)`, `  원작: ${sourceName} (${sourceText.length}자)`));

      const pipeline = new PipelineRunner(buildPipelineConfig(config, root));
      const activatedSkills = await resolveCliProfileSkills(root, "longform-novel", {
        extraSkillIds: ["inkos-story-import"],
      });
      await executeExplicitCapabilityTool({
        projectRoot: root,
        binding: { capabilityId: "adaptation", actionId: "fanfic_create", profileId: "workspace-default", risk: "recoverable-write" },
        tool: createFanficBookTool(pipeline, root, { defaultSkills: activatedSkills }),
        parameters: {
          title: book.title,
          sourceText,
          sourceName,
          mode,
          genre: book.genre,
          platform: book.platform,
          language: book.language,
          targetChapters: book.targetChapters,
          chapterWordCount: book.chapterWordCount,
        },
      });

      if (opts.json) {
        log(JSON.stringify({
          bookId,
          title: book.title,
          genre: book.genre,
          fanficMode: mode,
          source: sourceName,
          location: `works/${bookId}/source/`,
          nextStep: `inkos write next ${bookId}`,
        }, null, 2));
      } else {
        log(uiText(`Fanfic created: ${bookId}`, `팬픽을 만들었습니다: ${bookId}`));
        log(uiText(`  Mode: ${mode}`, `  방식: ${mode}`));
        log(uiText(`  Location: works/${bookId}/source/`, `  위치: works/${bookId}/source/`));
        log(uiText(`  fanfic_canon.md + foundation generated.`, `  fanfic_canon.md와 기본 설정을 생성했습니다.`));
        log("");
        log(uiText(`Next: inkos write next ${bookId}`, `다음 단계: inkos write next ${bookId}`));
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(uiText(`Failed to create fanfic: ${e}`, `팬픽을 만들지 못했습니다: ${e}`));
      }
      process.exit(1);
    }
  });

fanficCommand
  .command("show")
  .description(uiText("Display parsed fanfic canon", "분석된 팬픽 원작 설정을 보여 줍니다"))
  .argument("[book-id]", uiText("Book ID (auto-detected if only one book)", "책 ID(책이 하나뿐이면 자동으로 찾습니다)"))
  .option("--json", uiText("Output JSON", "JSON으로 출력합니다"))
  .action(async (bookIdArg: string | undefined, opts) => {
    try {
      await loadConfig();
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const { StateManager } = await import("@actalk/inkos-core");
      const state = new StateManager(root);
      const bookDir = state.bookDir(bookId);

      let canon: string;
      try {
        canon = await readFile(join(bookDir, "story/fanfic_canon.md"), "utf-8");
      } catch {
        throw new Error(formatFanficCanonMissingError());
      }

      if (opts.json) {
        log(JSON.stringify({ bookId, fanficCanon: canon }, null, 2));
      } else {
        log(uiText(`Fanfic Canon for "${bookId}":\n`, `"${bookId}"의 팬픽 원작 설정:\n`));
        log(canon);
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(String(e));
      }
      process.exit(1);
    }
  });

fanficCommand
  .command("refresh")
  .description(uiText("Re-import source material and regenerate fanfic canon", "원작 자료를 다시 가져와 팬픽 원작 설정을 다시 생성합니다"))
  .argument("[book-id]", uiText("Book ID (auto-detected if only one book)", "책 ID(책이 하나뿐이면 자동으로 찾습니다)"))
  .requiredOption("--from <path>", uiText("Source file or directory", "원작 파일 또는 디렉터리"))
  .option("--json", uiText("Output JSON", "JSON으로 출력합니다"))
  .action(async (bookIdArg: string | undefined, opts) => {
    try {
      const config = await loadConfig();
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const { StateManager } = await import("@actalk/inkos-core");
      const state = new StateManager(root);
      const book = await state.loadBookConfig(bookId);

      const mode = (book.fanficMode ?? "canon") as FanficMode;
      const sourcePath = resolve(opts.from);
      const sourceText = await readSourceMaterial(sourcePath);
      const sourceName = basename(sourcePath);

      if (!opts.json) log(uiText(
        `Refreshing fanfic canon for "${bookId}" from ${sourceName}...`,
        `${sourceName}에서 "${bookId}"의 팬픽 원작 설정을 갱신하는 중...`,
      ));

      const pipeline = new PipelineRunner(buildPipelineConfig(config, root));
      const activatedSkills = await resolveCliProfileSkills(root, "longform-novel", {
        extraSkillIds: ["inkos-story-import", "inkos-fanfic-writing"],
      });
      await executeExplicitCapabilityTool({
        projectRoot: root,
        binding: { capabilityId: "longform", actionId: "refresh_fanfic_canon", profileId: "longform-novel", risk: "recoverable-write" },
        tool: createRefreshFanficCanonTool(pipeline, root, bookId, { defaultSkills: activatedSkills }),
        workId: bookId,
        parameters: { sourceText, sourceName, mode },
      });

      if (opts.json) {
        log(JSON.stringify({ bookId, source: sourceName, refreshedAt: new Date().toISOString() }));
      } else {
        log(uiText(`Canon refreshed from "${sourceName}".`, `"${sourceName}"에서 원작 설정을 갱신했습니다.`));
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(uiText(`Failed to refresh canon: ${e}`, `원작 설정을 갱신하지 못했습니다: ${e}`));
      }
      process.exit(1);
    }
  });

async function readSourceMaterial(sourcePath: string): Promise<string> {
  const s = await stat(sourcePath);
  if (s.isDirectory()) {
    const files = await readdir(sourcePath);
    const textFiles = files.filter((f) => f.endsWith(".txt") || f.endsWith(".md"));
    if (textFiles.length === 0) {
      throw new Error(formatFanficSourceDirEmptyError(sourcePath));
    }
    const contents = await Promise.all(
      textFiles.sort().map((f) => readFile(join(sourcePath, f), "utf-8")),
    );
    return contents.join("\n\n---\n\n");
  }
  return readFile(sourcePath, "utf-8");
}
