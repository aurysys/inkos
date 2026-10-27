import { Command } from "commander";
import {
  PipelineRunner,
  StateManager,
  createResyncChapterStateTool,
  createWriteChaptersTool,
  executeExplicitCapabilityTool,
  type Observation,
} from "@actalk/inkos-core";
import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { loadConfig, buildPipelineConfig, findProjectRoot, resolveContext, resolveBookId, log, logError, resolveCliProfileSkills } from "../utils.js";
import {
  formatNotifyBatchWriteBody,
  formatNotifyCommandTitle,
  formatNotifyFailureBody,
  formatWriteNextComplete,
  formatWriteNextProgress,
  formatWriteNextResultLines,
  resolveCliLanguage,
  type CliLanguage,
} from "../localization.js";
import { sendCommandNotification } from "../notify-helper.js";
import { uiText } from "../ui-locale.js";

export const writeCommand = new Command("write")
  .description(uiText("Write chapters", "챕터를 씁니다"));

writeCommand
  .command("next")
  .description(uiText("Write the next chapter for a book", "책의 다음 챕터를 씁니다"))
  .argument("[book-id]", uiText("Book ID (auto-detected if only one book)", "책 ID(책이 하나뿐이면 자동으로 찾습니다)"))
  .option("--count <n>", uiText("Number of chapters to write", "쓸 챕터 수"), "1")
  .option("--words <n>", uiText("Words per chapter (overrides book config)", "챕터당 글자 수(책 설정보다 우선합니다)"))
  .option("--context <text>", uiText("Creative guidance (natural language)", "창작 지시(자연어)"))
  .option("--context-file <path>", uiText("Read guidance from file", "파일에서 창작 지시를 읽습니다"))
  .option("--json", uiText("Output JSON", "JSON으로 출력합니다"))
  .option("-q, --quiet", uiText("Suppress console output", "콘솔 출력을 숨깁니다"))
  .option("--notify", uiText("Send a notification to configured notify channels when the command finishes", "명령이 끝나면 설정된 알림 채널로 알림을 보냅니다"))
  .action(async (bookIdArg: string | undefined, opts) => {
    let notifyLanguage: CliLanguage = "zh";
    let notifyBookName: string | undefined;
    try {
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const context = await resolveContext(opts);
      const state = new StateManager(root);
      const book = await state.loadBookConfig(bookId);
      const language = resolveCliLanguage(book.language);
      notifyLanguage = language;
      notifyBookName = book.title ?? bookId;
      const config = await loadConfig();

      const pipeline = new PipelineRunner(buildPipelineConfig(config, root, {
        externalContext: context,
        quiet: opts.quiet,
      }));
      const activatedSkills = await resolveCliProfileSkills(root, "longform-novel");

      const count = parseInt(opts.count, 10);
      const wordCount = opts.words ? parseInt(opts.words, 10) : undefined;

      if (!opts.json) log(formatWriteNextProgress(language, 1, count, bookId));
      const startChapterNumber = await state.getNextChapterNumber(bookId);
      const action = await executeExplicitCapabilityTool({
        projectRoot: root,
        binding: { capabilityId: "longform", actionId: "write_chapters", profileId: "longform-novel", risk: "recoverable-write" },
        tool: createWriteChaptersTool(pipeline, bookId, { activeSkills: () => activatedSkills }),
        workId: bookId,
        parameters: {
          instruction: context || "Write the requested consecutive chapters for the active Work.",
          bookId,
          startChapterNumber,
          chapterCount: count,
          ...(wordCount ? { chapterWordCount: wordCount } : {}),
        },
      });
      const actionData = action.data as {
        readonly chapters?: ReadonlyArray<{
          readonly chapterNumber: number;
          readonly title: string;
          readonly wordCount: number;
          readonly observations: ReadonlyArray<Observation>;
        }>;
      } | undefined;
      const results = [...(actionData?.chapters ?? [])];

      if (!opts.json) {
        for (const result of results) {
          for (const line of formatWriteNextResultLines(language, result)) log(line);
          log("");
        }
      }

      if (opts.json) {
        log(JSON.stringify(results, null, 2));
      } else {
        log(formatWriteNextComplete(language));
      }

      // The pipeline itself already sends one notification per completed
      // chapter whenever notify channels are configured (runner.ts, end of
      // writeNextChapter). A single-chapter run would therefore duplicate that
      // exact notification — only send a command-level batch summary when this
      // run wrote more than one chapter.
      if (opts.notify && results.length > 1) {
        await sendCommandNotification({
          title: formatNotifyCommandTitle(language, "write-next", notifyBookName, true),
          body: formatNotifyBatchWriteBody(language, results.map((r) => ({
            chapterNumber: r.chapterNumber,
            title: r.title,
            wordCount: r.wordCount,
            observationCount: r.observations.length,
          }))),
        }, config);
      }
    } catch (e) {
      if (opts.notify) {
        await sendCommandNotification({
          title: formatNotifyCommandTitle(notifyLanguage, "write-next", notifyBookName, false),
          body: formatNotifyFailureBody(notifyLanguage, e),
        });
      }
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(uiText(`Failed to write chapter: ${e}`, `챕터를 쓰지 못했습니다: ${e}`));
      }
      process.exit(1);
    }
  });

writeCommand
  .command("rewrite")
  .description(uiText("Re-generate a specific chapter: rewrite [book-id] <chapter>", "특정 챕터를 다시 생성합니다: rewrite [book-id] <chapter>"))
  .argument("<args...>", uiText("Book ID (optional) and chapter number", "책 ID(선택)와 챕터 번호"))
  .option("--force", uiText("Skip confirmation prompt", "확인 질문을 건너뜁니다"))
  .option("--words <n>", uiText("Words per chapter (overrides book config)", "챕터당 글자 수(책 설정보다 우선합니다)"))
  .option("--brief <text>", uiText("One-off creative guidance for this rewrite only", "이번 다시 쓰기에만 적용할 일회성 창작 지시"))
  .option("--json", uiText("Output JSON", "JSON으로 출력합니다"))
  .option("--notify", uiText("Send a notification to configured notify channels when the command finishes", "명령이 끝나면 설정된 알림 채널로 알림을 보냅니다"))
  .action(async (args: ReadonlyArray<string>, opts) => {
    let notifyLanguage: CliLanguage = "zh";
    let notifyBookName: string | undefined;
    try {
      const root = findProjectRoot();

      let bookId: string;
      let chapter: number;
      if (args.length === 1) {
        chapter = parseInt(args[0]!, 10);
        if (isNaN(chapter)) throw new Error(uiText(`Expected chapter number, got "${args[0]}"`, `챕터 번호가 필요하지만 "${args[0]}"이(가) 입력되었습니다`));
        bookId = await resolveBookId(undefined, root);
      } else if (args.length === 2) {
        chapter = parseInt(args[1]!, 10);
        if (isNaN(chapter)) throw new Error(uiText(`Expected chapter number, got "${args[1]}"`, `챕터 번호가 필요하지만 "${args[1]}"이(가) 입력되었습니다`));
        bookId = await resolveBookId(args[0], root);
      } else {
        throw new Error(uiText("Usage: inkos write rewrite [book-id] <chapter>", "사용법: inkos write rewrite [book-id] <chapter>"));
      }

      if (!opts.force) {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>((resolve) => {
          rl.question(uiText(
            `Rewrite chapter ${chapter} of "${bookId}"? This will delete chapter ${chapter} and all later chapters. (y/N) `,
            `"${bookId}"의 ${chapter}장을 다시 쓸까요? ${chapter}장과 그 뒤의 모든 챕터가 삭제됩니다. (y/N) `,
          ), resolve);
        });
        rl.close();
        if (answer.toLowerCase() !== "y") {
          log(uiText("Cancelled.", "취소했습니다."));
          return;
        }
      }

      const state = new StateManager(root);
      const book = await state.loadBookConfig(bookId);
      notifyLanguage = resolveCliLanguage(book.language);
      notifyBookName = book.title ?? bookId;
      const bookDir = state.bookDir(bookId);
      const chaptersDir = join(bookDir, "chapters");
      const restoreFrom = chapter - 1;
      const restoreSnapshotDir = join(bookDir, "story", "snapshots", String(restoreFrom));
      await stat(restoreSnapshotDir).catch(() => {
        throw new Error(uiText(
          `Cannot rewrite chapter ${chapter}: missing snapshot for chapter ${restoreFrom}`,
          `${chapter}장을 다시 쓸 수 없습니다: ${restoreFrom}장의 스냅숏이 없습니다`,
        ));
      });

      // Remove existing chapter file
      const files = await readdir(chaptersDir);
      const paddedNum = String(chapter).padStart(4, "0");
      const existing = files.filter((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
      for (const f of existing) {
        await unlink(join(chaptersDir, f));
        if (!opts.json) log(uiText(`Removed: ${f}`, `삭제함: ${f}`));
      }

      // Remove from index (and all chapters after it)
      const index = await state.loadChapterIndex(bookId);
      const trimmed = index.filter((ch) => ch.number < chapter);
      await state.saveChapterIndex(bookId, trimmed);

      // Also remove later chapter files since state will be rolled back
      const laterFiles = files.filter((f) => {
        const num = parseInt(f.slice(0, 4), 10);
        return num > chapter && f.endsWith(".md");
      });
      for (const f of laterFiles) {
        await unlink(join(chaptersDir, f));
        if (!opts.json) log(uiText(`Removed later chapter: ${f}`, `뒤 챕터 삭제함: ${f}`));
      }

      // Restore state to previous chapter's end-state (chapter 1 uses snapshot-0 from initBook)
      const restored = await state.restoreState(bookId, restoreFrom);
      if (!restored) {
        throw new Error(uiText(
          `Cannot rewrite chapter ${chapter}: failed to restore snapshot for chapter ${restoreFrom}`,
          `${chapter}장을 다시 쓸 수 없습니다: ${restoreFrom}장의 스냅숏을 복원하지 못했습니다`,
        ));
      }
      if (!opts.json) log(uiText(`State restored from chapter ${restoreFrom} snapshot.`, `${restoreFrom}장 스냅숏에서 상태를 복원했습니다.`));

      const nextChapter = await state.getNextChapterNumber(bookId);
      if (nextChapter !== chapter) {
        throw new Error(uiText(
          `Cannot rewrite chapter ${chapter}: expected next chapter to be ${chapter}, but resolved to ${nextChapter}`,
          `${chapter}장을 다시 쓸 수 없습니다: 다음 챕터가 ${chapter}장이어야 하지만 ${nextChapter}장으로 확인되었습니다`,
        ));
      }

      if (!opts.json) log(uiText(`Regenerating chapter ${chapter}...`, `${chapter}장을 다시 생성하는 중...`));

      const wordCount = opts.words ? parseInt(opts.words, 10) : undefined;

      const config = await loadConfig();
      const pipeline = new PipelineRunner(buildPipelineConfig(config, root, {
        externalContext: opts.brief,
      }));
      const activatedSkills = await resolveCliProfileSkills(root, "longform-novel");

      const action = await executeExplicitCapabilityTool({
        projectRoot: root,
        binding: { capabilityId: "longform", actionId: "write_chapters", profileId: "longform-novel", risk: "recoverable-write" },
        tool: createWriteChaptersTool(pipeline, bookId, { activeSkills: () => activatedSkills }),
        workId: bookId,
        parameters: {
          instruction: opts.brief?.trim() || `Rewrite chapter ${chapter}.`,
          bookId,
          startChapterNumber: chapter,
          chapterCount: 1,
          ...(wordCount ? { chapterWordCount: wordCount } : {}),
        },
      });
      const result = (action.data as {
        readonly chapters?: ReadonlyArray<{
          readonly chapterNumber: number;
          readonly title: string;
          readonly wordCount: number;
          readonly observations: ReadonlyArray<Observation>;
        }>;
      } | undefined)?.chapters?.[0];
      if (!result) throw new Error(uiText("Rewrite action completed without a chapter artifact.", "다시 쓰기가 끝났지만 챕터 산출물이 없습니다."));
      const language = resolveCliLanguage(book.language);

      if (opts.json) {
        log(JSON.stringify(result, null, 2));
      } else {
        for (const line of formatWriteNextResultLines(language, {
          chapterNumber: result.chapterNumber,
          title: result.title,
          wordCount: result.wordCount,
          observations: result.observations,
        })) {
          log(line);
        }
      }

      // Success notification intentionally skipped: the pipeline already sent
      // the per-chapter notification for this exact chapter (runner.ts, end of
      // writeNextChapter) — a command-level one would be a duplicate. --notify
      // only adds the failure notification for this command.
    } catch (e) {
      if (opts.notify) {
        await sendCommandNotification({
          title: formatNotifyCommandTitle(notifyLanguage, "write-rewrite", notifyBookName, false),
          body: formatNotifyFailureBody(notifyLanguage, e),
        });
      }
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(uiText(`Failed to rewrite chapter: ${e}`, `챕터를 다시 쓰지 못했습니다: ${e}`));
      }
      process.exit(1);
    }
  });

writeCommand
  .command("sync")
  .description(uiText("Rebuild truth files and SQLite indexes from the latest edited chapter body", "최근 편집한 챕터 본문으로 설정 파일과 SQLite 인덱스를 다시 만듭니다"))
  .argument("<args...>", uiText("Book ID (optional) and chapter number", "책 ID(선택)와 챕터 번호"))
  .option("--brief <text>", uiText("One-off guidance for how to interpret the edited chapter while syncing", "동기화할 때 편집된 챕터를 어떻게 해석할지 알려 주는 일회성 지시"))
  .option("--json", uiText("Output JSON", "JSON으로 출력합니다"))
  .action(async (args: ReadonlyArray<string>, opts) => {
    try {
      const root = findProjectRoot();

      let bookId: string;
      let chapter: number;
      if (args.length === 1) {
        chapter = parseInt(args[0]!, 10);
        if (isNaN(chapter)) throw new Error(uiText(`Expected chapter number, got "${args[0]}"`, `챕터 번호가 필요하지만 "${args[0]}"이(가) 입력되었습니다`));
        bookId = await resolveBookId(undefined, root);
      } else if (args.length === 2) {
        chapter = parseInt(args[1]!, 10);
        if (isNaN(chapter)) throw new Error(uiText(`Expected chapter number, got "${args[1]}"`, `챕터 번호가 필요하지만 "${args[1]}"이(가) 입력되었습니다`));
        bookId = await resolveBookId(args[0], root);
      } else {
        throw new Error(uiText("Usage: inkos write sync [book-id] <chapter>", "사용법: inkos write sync [book-id] <chapter>"));
      }

      const state = new StateManager(root);
      const book = await state.loadBookConfig(bookId);
      const language = resolveCliLanguage(book.language);
      const config = await loadConfig();
      const pipeline = new PipelineRunner(buildPipelineConfig(config, root, {
        externalContext: opts.brief,
      }));
      const activatedSkills = await resolveCliProfileSkills(root, "longform-novel", { includeRecommended: true });
      const action = await executeExplicitCapabilityTool({
        projectRoot: root,
        binding: { capabilityId: "longform", actionId: "resync_chapter_state", profileId: "longform-novel", risk: "recoverable-write" },
        tool: createResyncChapterStateTool(pipeline, bookId, {
          defaultSkills: activatedSkills,
          language: book.language,
        }),
        workId: bookId,
        parameters: { bookId, chapterNumber: chapter },
      });
      const result = action.data as {
        readonly chapterNumber: number;
        readonly observations: ReadonlyArray<Observation>;
      };
      const chapterMeta = (await state.loadChapterIndex(bookId)).find((item) => item.number === result.chapterNumber);
      if (!chapterMeta) throw new Error(uiText(
        `Resync action completed without chapter ${result.chapterNumber}.`,
        `재동기화가 끝났지만 ${result.chapterNumber}장이 없습니다.`,
      ));

      if (opts.json) {
        log(JSON.stringify(result, null, 2));
      } else {
        for (const line of formatWriteNextResultLines(language, {
          chapterNumber: result.chapterNumber,
          title: chapterMeta.title,
          wordCount: chapterMeta.wordCount,
          observations: result.observations,
        })) {
          log(line);
        }
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(uiText(`Failed to sync chapter artifacts: ${e}`, `챕터 산출물을 동기화하지 못했습니다: ${e}`));
      }
      process.exit(1);
    }
  });
