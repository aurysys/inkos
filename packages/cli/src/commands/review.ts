import { Command } from "commander";
import { StateManager, formatLengthCount, resolveLengthCountingMode } from "@actalk/inkos-core";
import { findProjectRoot, log, logError } from "../utils.js";
import { uiText } from "../ui-locale.js";

export const reviewCommand = new Command("review")
  .description(uiText("Show persisted review observations", "저장된 검토 지적 사항을 보여 줍니다"))
  .argument("[book-id]", uiText("Book ID; omit to inspect all works", "책 ID(생략하면 모든 작품을 살펴봅니다)"))
  .option("--json", uiText("Output JSON", "JSON으로 출력합니다"))
  .action(async (bookId: string | undefined, opts) => {
    try {
      const root = findProjectRoot();
      const state = new StateManager(root);
      const rows: unknown[] = [];
      for (const id of bookId ? [bookId] : await state.listBooks()) {
        const [book, chapters] = await Promise.all([
          state.loadBookConfig(id),
          state.loadChapterIndex(id),
        ]);
        const countingMode = resolveLengthCountingMode(book.language);
        for (const chapter of chapters.filter((item) => item.observations.length > 0)) {
          const row = {
            bookId: id,
            chapter: chapter.number,
            title: chapter.title,
            wordCount: chapter.wordCount,
            observations: chapter.observations,
          };
          rows.push(row);
          if (!opts.json) {
            log(uiText(
              `\n${book.title} · Ch.${chapter.number} "${chapter.title}" · ${formatLengthCount(chapter.wordCount, countingMode)}`,
              `\n${book.title} · ${chapter.number}장 "${chapter.title}" · ${formatLengthCount(chapter.wordCount, countingMode)}`,
            ));
            for (const observation of chapter.observations) {
              log(`  ${observation.code}: ${observation.summary}`);
            }
          }
        }
      }
      if (opts.json) log(JSON.stringify({ observations: rows }, null, 2));
      else if (rows.length === 0) log(uiText("No review observations.", "검토 지적 사항이 없습니다."));
    } catch (error) {
      if (opts.json) log(JSON.stringify({ error: String(error) }));
      else logError(uiText(`Failed to load review observations: ${error}`, `검토 지적 사항을 불러오지 못했습니다: ${error}`));
      process.exit(1);
    }
  });
