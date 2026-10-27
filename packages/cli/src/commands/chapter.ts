import { Command } from "commander";
import { createInterface } from "node:readline";
import { deleteLatestChapter, StateManager, syncChapterWordCounts } from "@actalk/inkos-core";
import {
  formatChapterDeleteCancelled,
  formatChapterDeleteConfirm,
  formatChapterDeleteDone,
  formatChapterSyncChange,
  formatChapterSyncMissingFiles,
  formatChapterSyncNoChanges,
  formatChapterSyncSummary,
  resolveCliLanguage,
} from "../localization.js";
import { findProjectRoot, log, logError, resolveBookId } from "../utils.js";
import { uiText } from "../ui-locale.js";

export const chapterCommand = new Command("chapter")
  .description(uiText("Manage chapters", "챕터를 관리합니다"));

chapterCommand
  .command("sync")
  .description(uiText("Recount chapter word counts from chapter files and update chapters/index.json", "챕터 파일에서 글자 수를 다시 세어 chapters/index.json을 갱신합니다"))
  .argument("[book-id]", uiText("Book ID (auto-detected if only one book)", "책 ID(책이 하나뿐이면 자동으로 찾습니다)"))
  .option("--json", uiText("Output JSON", "JSON으로 출력합니다"))
  .action(async (bookIdArg: string | undefined, opts) => {
    try {
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const state = new StateManager(root);
      const book = await state.loadBookConfig(bookId);
      const language = resolveCliLanguage(book.language);

      const result = await syncChapterWordCounts(state, bookId);

      if (opts.json) {
        log(JSON.stringify(result, null, 2));
        return;
      }

      if (result.changes.length === 0) {
        log(formatChapterSyncNoChanges(language, result.checkedChapters));
      } else {
        for (const change of result.changes) {
          log(formatChapterSyncChange(language, change, result.countingMode));
        }
        log(formatChapterSyncSummary(language, result.changes.length, result.checkedChapters));
      }
      if (result.missingChapterFiles.length > 0) {
        log(formatChapterSyncMissingFiles(language, result.missingChapterFiles));
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(uiText(`Failed to sync chapter word counts: ${e}`, `챕터 글자 수를 동기화하지 못했습니다: ${e}`));
      }
      process.exit(1);
    }
  });

chapterCommand
  .command("delete")
  .description(uiText("Delete the latest chapter: move its file to chapters/.trash/ and roll the index and story state back", "최신 챕터를 삭제합니다: 파일을 chapters/.trash/로 옮기고 인덱스와 이야기 상태를 되돌립니다"))
  .argument("<book-id>", uiText("Book ID", "책 ID"))
  .option("--chapter <n>", uiText("Chapter number to delete (must be the latest chapter; defaults to it)", "삭제할 챕터 번호(최신 챕터여야 하며, 생략하면 최신 챕터)"))
  .option("--force", uiText("Skip confirmation prompt", "확인 질문을 건너뜁니다"))
  .option("--json", uiText("Output JSON", "JSON으로 출력합니다"))
  .action(async (bookIdArg: string, opts) => {
    try {
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const state = new StateManager(root);
      const book = await state.loadBookConfig(bookId);
      const language = resolveCliLanguage(book.language);
      const requestedChapter = opts.chapter === undefined ? undefined : parseInt(opts.chapter, 10);

      if (!opts.force) {
        const index = await state.loadChapterIndex(bookId);
        const latest = index.reduce((max, chapter) => Math.max(max, chapter.number), 0);
        const target = requestedChapter ?? latest;
        const title = index.find((chapter) => chapter.number === target)?.title ?? "";
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>((resolve) => {
          rl.question(
            formatChapterDeleteConfirm(language, { bookTitle: book.title, bookId, number: target, title }),
            resolve,
          );
        });
        rl.close();
        if (answer.toLowerCase() !== "y") {
          log(formatChapterDeleteCancelled(language));
          return;
        }
      }

      const result = await deleteLatestChapter(state, bookId, {
        ...(requestedChapter === undefined ? {} : { chapterNumber: requestedChapter }),
      });

      if (opts.json) {
        log(JSON.stringify(result, null, 2));
      } else {
        log(formatChapterDeleteDone(language, {
          number: result.deletedChapter,
          title: result.title,
          trashedFiles: result.trashedFiles,
          rolledBackTo: result.rolledBackTo,
        }));
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(uiText(`Failed to delete chapter: ${e}`, `챕터를 삭제하지 못했습니다: ${e}`));
      }
      process.exit(1);
    }
  });
