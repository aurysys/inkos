import { Command } from "commander";
import { StateManager, formatLengthCount, resolveLengthCountingMode } from "@actalk/inkos-core";
import { findProjectRoot, log, logError } from "../utils.js";
import { uiText } from "../ui-locale.js";

export const statusCommand = new Command("status")
  .description(uiText("Show project status", "프로젝트 상태를 보여 줍니다"))
  .argument("[book-id]", uiText("Book ID (optional, shows all if omitted)", "책 ID(선택, 생략하면 모든 책을 보여 줍니다)"))
  .option("--chapters", uiText("Show per-chapter status and observations", "챕터별 상태와 지적 사항을 보여 줍니다"))
  .option("--json", uiText("Output JSON", "JSON으로 출력합니다"))
  .action(async (bookIdArg: string | undefined, opts) => {
    try {
      const root = findProjectRoot();
      const state = new StateManager(root);

      const allBookIds = await state.listBooks();
      const bookIds = bookIdArg ? [bookIdArg] : allBookIds;

      if (bookIdArg && !allBookIds.includes(bookIdArg)) {
        throw new Error(uiText(
          `Book "${bookIdArg}" not found. Available: ${allBookIds.join(", ") || "(none)"}`,
          `책 "${bookIdArg}"을(를) 찾을 수 없습니다. 사용 가능한 책: ${allBookIds.join(", ") || "(없음)"}`,
        ));
      }

      const booksData = [];

      if (!opts.json) {
        log(uiText(`InkOS Project: ${root}`, `InkOS 프로젝트: ${root}`));
        log(uiText(`Books: ${allBookIds.length}`, `책: ${allBookIds.length}권`));
        log("");
      }

      for (const id of bookIds) {
        const book = await state.loadBookConfig(id);
        const index = await state.loadChapterIndex(id);
        const persistedChapterCount = await state.getPersistedChapterCount(id);
        const countingMode = resolveLengthCountingMode(book.language);

        const observationCount = index.reduce((sum, chapter) => sum + chapter.observations.length, 0);
        const chaptersWithObservations = index.filter((chapter) => chapter.observations.length > 0).length;
        const totalWords = index.reduce((sum, ch) => sum + ch.wordCount, 0);
        const avgWords = index.length > 0 ? Math.round(totalWords / index.length) : 0;

        booksData.push({
          id,
          title: book.title,
          status: book.status,
          genre: book.genre,
          platform: book.platform,
          chapters: index.length,
          chapterFiles: persistedChapterCount,
          targetChapters: book.targetChapters,
          totalWords,
          avgWordsPerChapter: avgWords,
          observationCount,
          chaptersWithObservations,
          ...(opts.chapters ? {
            chapterList: index.map((ch) => ({
              number: ch.number,
              title: ch.title,
              wordCount: ch.wordCount,
              provenance: ch.provenance,
              observations: ch.observations,
            })),
          } : {}),
        });

        if (!opts.json) {
          log(`  ${book.title} (${id})`);
          log(uiText(`    Status: ${book.status}`, `    상태: ${book.status}`));
          log(uiText(`    Platform: ${book.platform} | Genre: ${book.genre}`, `    플랫폼: ${book.platform} | 장르: ${book.genre}`));
          log(uiText(`    Chapters: ${index.length} / ${book.targetChapters}`, `    챕터: ${index.length} / ${book.targetChapters}`));
          if (persistedChapterCount !== index.length) log(uiText(
            `    Chapter files: ${persistedChapterCount}; the file count differs from the chapter index.`,
            `    챕터 파일: ${persistedChapterCount}개 — 파일 수가 챕터 인덱스와 다릅니다.`,
          ));
          log(uiText(
            `    Words: ${totalWords.toLocaleString()} (avg ${avgWords}/ch)`,
            `    글자 수: ${totalWords.toLocaleString()} (챕터당 평균 ${avgWords})`,
          ));
          log(uiText(
            `    Review observations: ${observationCount} across ${chaptersWithObservations} chapter(s)`,
            `    검토 지적 사항: 챕터 ${chaptersWithObservations}개에서 ${observationCount}건`,
          ));

          if (opts.chapters && index.length > 0) {
            log("");
            for (const ch of index) {
              const icon = ch.observations.length > 0 ? "!" : "+";
              log(uiText(
                `    [${icon}] Ch.${ch.number} "${ch.title}" | ${formatLengthCount(ch.wordCount, countingMode)} | ${ch.provenance}`,
                `    [${icon}] ${ch.number}장 "${ch.title}" | ${formatLengthCount(ch.wordCount, countingMode)} | ${ch.provenance}`,
              ));
              for (const observation of ch.observations) {
                log(`        ${observation.code}: ${observation.summary}`);
              }
            }
          }
          log("");
        }
      }

      if (opts.json) {
        log(JSON.stringify({ project: root, books: booksData }, null, 2));
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(uiText(`Failed to get status: ${e}`, `상태를 불러오지 못했습니다: ${e}`));
      }
      process.exit(1);
    }
  });
