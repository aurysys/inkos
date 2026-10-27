import { Command } from "commander";
import { StateManager, computeAnalytics } from "@actalk/inkos-core";
import { loadConfig, findProjectRoot, resolveBookId, log, logError } from "../utils.js";
import { uiText } from "../ui-locale.js";

export const analyticsCommand = new Command("analytics")
  .alias("stats")
  .description(uiText("Show analytics and token stats for a book", "책의 분석 결과와 토큰 통계를 보여 줍니다"))
  .argument("[book-id]", uiText("Book ID (auto-detected if only one book)", "책 ID(책이 하나뿐이면 자동으로 찾습니다)"))
  .option("--json", uiText("Output JSON", "JSON으로 출력합니다"))
  .action(async (bookIdArg: string | undefined, opts) => {
    try {
      await loadConfig();
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const state = new StateManager(root);
      const chapters = await state.loadChapterIndex(bookId);

      const analytics = computeAnalytics(bookId, chapters);

      if (opts.json) {
        log(JSON.stringify(analytics, null, 2));
      } else {
        log(uiText(`Analytics for "${bookId}":`, `"${bookId}" 분석:`));
        log("");
        log(uiText(`  Total chapters: ${analytics.totalChapters}`, `  전체 챕터: ${analytics.totalChapters}`));
        log(uiText(`  Total words: ${analytics.totalWords.toLocaleString()}`, `  전체 글자 수: ${analytics.totalWords.toLocaleString()}`));
        log(uiText(`  Avg words/chapter: ${analytics.avgWordsPerChapter.toLocaleString()}`, `  챕터당 평균 글자 수: ${analytics.avgWordsPerChapter.toLocaleString()}`));
        log(uiText(`  Review observations: ${analytics.observationCount}`, `  검토 지적 사항: ${analytics.observationCount}`));
        log(uiText(`  Chapters with observations: ${analytics.chaptersWithObservations}`, `  지적 사항이 있는 챕터: ${analytics.chaptersWithObservations}`));
        log("");

        if (analytics.tokenStats) {
          log(uiText("  Token usage:", "  토큰 사용량:"));
          log(uiText(`    Total tokens: ${analytics.tokenStats.totalTokens.toLocaleString()}`, `    전체 토큰: ${analytics.tokenStats.totalTokens.toLocaleString()}`));
          log(uiText(`    Prompt tokens: ${analytics.tokenStats.totalPromptTokens.toLocaleString()}`, `    프롬프트 토큰: ${analytics.tokenStats.totalPromptTokens.toLocaleString()}`));
          log(uiText(`    Completion tokens: ${analytics.tokenStats.totalCompletionTokens.toLocaleString()}`, `    응답 토큰: ${analytics.tokenStats.totalCompletionTokens.toLocaleString()}`));
          log(uiText(`    Avg tokens/chapter: ${analytics.tokenStats.avgTokensPerChapter.toLocaleString()}`, `    챕터당 평균 토큰: ${analytics.tokenStats.avgTokensPerChapter.toLocaleString()}`));
          if (analytics.tokenStats.recentTrend.length > 0) {
            log(uiText("    Recent trend:", "    최근 추이:"));
            for (const { chapter, totalTokens } of analytics.tokenStats.recentTrend) {
              log(uiText(`      Ch.${chapter}: ${totalTokens.toLocaleString()} tokens`, `      ${chapter}장: 토큰 ${totalTokens.toLocaleString()}개`));
            }
          }
          log("");
        }

      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(uiText(`Analytics failed: ${e}`, `분석에 실패했습니다: ${e}`));
      }
      process.exit(1);
    }
  });
