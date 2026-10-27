import { Command } from "commander";
import {
  PipelineRunner,
  StateManager,
  createWriteChaptersTool,
  executeExplicitCapabilityTool,
  type Observation,
  resolveLengthCountingMode,
} from "@actalk/inkos-core";
import { loadConfig, buildPipelineConfig, findProjectRoot, resolveBookId, log, logError, resolveCliProfileSkills } from "../utils.js";
import {
  formatAutoWriteAlreadyComplete,
  formatAutoWriteStart,
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

export const autoCommand = new Command("auto")
  .description(uiText("Auto-write chapters until the book reaches a target chapter number: auto [book-id] <target-chapter>", "목표 챕터 번호에 이를 때까지 챕터를 자동으로 씁니다: auto [book-id] <target-chapter>"))
  .argument("<args...>", uiText("Book ID (optional, auto-detected if only one book) and target chapter number", "책 ID(선택, 책이 하나뿐이면 자동으로 찾습니다)와 목표 챕터 번호"))
  .option("--words <n>", uiText("Words per chapter (overrides book config)", "챕터당 글자 수(책 설정보다 우선합니다)"))
  .option("--json", uiText("Output JSON", "JSON으로 출력합니다"))
  .option("-q, --quiet", uiText("Suppress console output", "콘솔 출력을 숨깁니다"))
  .option("--notify", uiText("Send a notification to configured notify channels when the command finishes", "명령이 끝나면 설정된 알림 채널로 알림을 보냅니다"))
  .action(async (args: ReadonlyArray<string>, opts) => {
    let notifyLanguage: CliLanguage = "zh";
    let notifyBookName: string | undefined;
    try {
      const root = findProjectRoot();

      let bookId: string;
      let targetChapter: number;
      if (args.length === 1) {
        targetChapter = parseInt(args[0]!, 10);
        if (isNaN(targetChapter)) throw new Error(uiText(`Expected target chapter number, got "${args[0]}"`, `목표 챕터 번호가 필요하지만 "${args[0]}"이(가) 입력되었습니다`));
        bookId = await resolveBookId(undefined, root);
      } else if (args.length === 2) {
        targetChapter = parseInt(args[1]!, 10);
        if (isNaN(targetChapter)) throw new Error(uiText(`Expected target chapter number, got "${args[1]}"`, `목표 챕터 번호가 필요하지만 "${args[1]}"이(가) 입력되었습니다`));
        bookId = await resolveBookId(args[0], root);
      } else {
        throw new Error(uiText("Usage: inkos auto [book-id] <target-chapter>", "사용법: inkos auto [book-id] <target-chapter>"));
      }
      if (targetChapter < 1) {
        throw new Error(uiText(`Target chapter must be >= 1, got ${targetChapter}`, `목표 챕터는 1 이상이어야 합니다(입력값: ${targetChapter})`));
      }

      const state = new StateManager(root);
      const book = await state.loadBookConfig(bookId);
      const language = resolveCliLanguage(book.language);
      notifyLanguage = language;
      notifyBookName = book.title ?? bookId;

      const startChapter = await state.getNextChapterNumber(bookId);
      if (startChapter > targetChapter) {
        if (opts.json) {
          log(JSON.stringify([], null, 2));
        } else {
          log(formatAutoWriteAlreadyComplete(language, bookId, startChapter - 1, targetChapter));
        }
        return;
      }

      const config = await loadConfig();
      const pipeline = new PipelineRunner(buildPipelineConfig(config, root, {
        quiet: opts.quiet,
      }));
      const activatedSkills = await resolveCliProfileSkills(root, "longform-novel");

      if (!opts.json) log(formatAutoWriteStart(language, bookId, startChapter, targetChapter));

      const wordCount = opts.words ? parseInt(opts.words, 10) : undefined;

      const count = targetChapter - startChapter + 1;
      if (!opts.json) log(formatWriteNextProgress(language, startChapter, targetChapter, bookId));
      const action = await executeExplicitCapabilityTool({
        projectRoot: root,
        binding: { capabilityId: "longform", actionId: "write_chapters", profileId: "longform-novel", risk: "recoverable-write" },
        tool: createWriteChaptersTool(pipeline, bookId, { activeSkills: () => activatedSkills }),
        workId: bookId,
        parameters: {
          instruction: `Write consecutive chapters through chapter ${targetChapter}.`,
          bookId,
          startChapterNumber: startChapter,
          chapterCount: count,
          ...(wordCount ? { chapterWordCount: wordCount } : {}),
        },
      });
      const results = [...((action.data as {
        readonly chapters?: ReadonlyArray<{
          readonly chapterNumber: number;
          readonly title: string;
          readonly wordCount: number;
          readonly observations: ReadonlyArray<Observation>;
        }>;
      } | undefined)?.chapters ?? [])];

      if (!opts.json) {
        for (const result of results) {
          for (const line of formatWriteNextResultLines(language, { ...result, countingMode: resolveLengthCountingMode(book.language) })) log(line);
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
          title: formatNotifyCommandTitle(language, "auto", notifyBookName, true),
          body: formatNotifyBatchWriteBody(language, results.map((r) => ({
            chapterNumber: r.chapterNumber,
            title: r.title,
            wordCount: r.wordCount,
            observationCount: r.observations.length,
            countingMode: resolveLengthCountingMode(book.language),
          }))),
        }, config);
      }
    } catch (e) {
      if (opts.notify) {
        await sendCommandNotification({
          title: formatNotifyCommandTitle(notifyLanguage, "auto", notifyBookName, false),
          body: formatNotifyFailureBody(notifyLanguage, e),
        });
      }
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(uiText(`Auto-write failed: ${e}`, `자동 집필에 실패했습니다: ${e}`));
      }
      process.exit(1);
    }
  });
