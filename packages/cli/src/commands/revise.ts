import { Command } from "commander";
import {
  DEFAULT_REVISE_MODE,
  PipelineRunner,
  StateManager,
  createReviseChapterTool,
  executeExplicitCapabilityTool,
  type ReviseMode,
} from "@actalk/inkos-core";
import { loadConfig, buildPipelineConfig, findProjectRoot, resolveBookId, log, logError, resolveCliProfileSkills } from "../utils.js";
import {
  formatNotifyCommandTitle,
  formatNotifyFailureBody,
  formatNotifyReviseBody,
  resolveCliLanguage,
  type CliLanguage,
} from "../localization.js";
import { sendCommandNotification } from "../notify-helper.js";
import { uiText } from "../ui-locale.js";

export const reviseCommand = new Command("revise")
  .description(uiText("Revise a chapter from user direction and review observations", "사용자 지시와 검토 지적 사항을 바탕으로 챕터를 수정합니다"))
  .argument("[book-id]", uiText("Book ID (auto-detected if only one book)", "책 ID(책이 하나뿐이면 자동으로 찾습니다)"))
  .argument("[chapter]", uiText("Chapter number (defaults to latest)", "챕터 번호(생략하면 최신 챕터)"))
  .option("--mode <mode>", uiText("Revise mode: spot-fix, polish, rewrite, rework, anti-detect", "수정 방식: spot-fix, polish, rewrite, rework, anti-detect"), DEFAULT_REVISE_MODE)
  .option("--brief <text>", uiText("One-off creative guidance for this revise/rewrite only", "이번 수정/다시 쓰기에만 적용할 일회성 창작 지시"))
  .option("--json", uiText("Output JSON", "JSON으로 출력합니다"))
  .option("--notify", uiText("Send a notification to configured notify channels when the command finishes", "명령이 끝나면 설정된 알림 채널로 알림을 보냅니다"))
  .action(async (bookIdArg: string | undefined, chapterStr: string | undefined, opts) => {
    let notifyLanguage: CliLanguage = "zh";
    let notifyBookName: string | undefined;
    try {
      const config = await loadConfig();
      const root = findProjectRoot();

      let bookId: string;
      let chapterNumber: number | undefined;
      if (bookIdArg && /^\d+$/.test(bookIdArg)) {
        bookId = await resolveBookId(undefined, root);
        chapterNumber = parseInt(bookIdArg, 10);
      } else {
        bookId = await resolveBookId(bookIdArg, root);
        chapterNumber = chapterStr ? parseInt(chapterStr, 10) : undefined;
      }

      const state = new StateManager(root);
      const book = await state.loadBookConfig(bookId);
      const language = resolveCliLanguage(book.language);
      notifyLanguage = language;
      notifyBookName = book.title ?? bookId;
      const pipeline = new PipelineRunner(buildPipelineConfig(config, root, {
        externalContext: opts.brief,
      }));

      const mode = opts.mode as ReviseMode;
      if (!opts.json) log(uiText(
        `Revising "${bookId}"${chapterNumber ? ` chapter ${chapterNumber}` : " (latest)"} [mode: ${mode}]...`,
        `"${bookId}"${chapterNumber ? ` ${chapterNumber}장` : " (최신 챕터)"} 수정 중 [방식: ${mode}]...`,
      ));

      const activatedSkills = await resolveCliProfileSkills(root, "longform-novel", { includeRecommended: true });
      const action = await executeExplicitCapabilityTool({
        projectRoot: root,
        binding: { capabilityId: "longform", actionId: "revise_chapter", profileId: "longform-novel", risk: "recoverable-write" },
        tool: createReviseChapterTool(pipeline, bookId, { activeSkills: () => activatedSkills }),
        workId: bookId,
        parameters: {
          instruction: opts.brief?.trim() || "Revise the chapter from its persisted observations and Work authority.",
          bookId,
          ...(chapterNumber ? { chapterNumber } : {}),
          mode,
        },
      });
      const result = action.data as {
        readonly chapterNumber: number;
        readonly wordCount: number;
        readonly changed: boolean;
        readonly observations: ReadonlyArray<unknown>;
      };

      if (opts.json) {
        log(JSON.stringify(result, null, 2));
      } else {
        log(result.changed
          ? uiText(`  Chapter ${result.chapterNumber} revised`, `  ${result.chapterNumber}장을 수정했습니다`)
          : uiText(`  Chapter ${result.chapterNumber}: no actionable change`, `  ${result.chapterNumber}장: 반영할 수정 사항이 없습니다`));
        log(uiText(`  Words: ${result.wordCount}`, `  글자 수: ${result.wordCount}`));
        log(uiText(`  Review observations: ${result.observations.length}`, `  검토 지적 사항: ${result.observations.length}`));
      }

      // Unlike write commands, the pipeline sends no notification for
      // reviseDraft, so --notify always sends the completion notification here.
      if (opts.notify) {
        await sendCommandNotification({
          title: formatNotifyCommandTitle(language, "revise", notifyBookName, true),
          body: formatNotifyReviseBody(language, {
            chapterNumber: result.chapterNumber,
            changed: result.changed,
            wordCount: result.wordCount,
            observationCount: result.observations.length,
          }),
        }, config);
      }
    } catch (e) {
      if (opts.notify) {
        await sendCommandNotification({
          title: formatNotifyCommandTitle(notifyLanguage, "revise", notifyBookName, false),
          body: formatNotifyFailureBody(notifyLanguage, e),
        });
      }
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(uiText(`Revise failed: ${e}`, `수정에 실패했습니다: ${e}`));
      }
      process.exit(1);
    }
  });
