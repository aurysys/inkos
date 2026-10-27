import { Command } from "commander";
import {
  StateManager,
  detectChapter,
  loadDetectionHistory,
  analyzeDetectionInsights,
  type DetectionConfig,
} from "@actalk/inkos-core";
import { loadConfig, findProjectRoot, resolveBookId, log, logError } from "../utils.js";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { uiText } from "../ui-locale.js";

export const detectCommand = new Command("detect")
  .description(uiText("Run AIGC detection on chapters", "챕터에 AIGC(AI 생성 텍스트) 탐지를 실행합니다"))
  .argument("[book-id]", uiText("Book ID (auto-detected if only one book)", "책 ID(책이 하나뿐이면 자동으로 찾습니다)"))
  .argument("[chapter]", uiText("Chapter number (defaults to latest)", "챕터 번호(생략하면 최신 챕터)"))
  .option("--all", uiText("Detect all chapters", "모든 챕터를 탐지합니다"))
  .option("--stats", uiText("Show detection statistics", "탐지 통계를 보여 줍니다"))
  .option("--json", uiText("Output JSON", "JSON으로 출력합니다"))
  .action(async (bookIdArg: string | undefined, chapterStr: string | undefined, opts) => {
    try {
      const config = await loadConfig();
      const root = findProjectRoot();

      if (!config.detection?.enabled) {
        logError(uiText("AIGC detection is not enabled. Add detection config to inkos.json.", "AIGC 탐지가 켜져 있지 않습니다. inkos.json에 detection 설정을 추가하세요."));
        process.exit(1);
      }

      // If first arg looks like a number, treat it as chapter
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
      const bookDir = state.bookDir(bookId);

      if (opts.stats) {
        const history = await loadDetectionHistory(bookDir);
        const stats = analyzeDetectionInsights(history);
        if (opts.json) {
          log(JSON.stringify(stats, null, 2));
        } else {
          log(uiText(`Detection Statistics:`, `탐지 통계:`));
          log(uiText(`  Observations: ${stats.totalObservations}`, `  탐지 기록: ${stats.totalObservations}`));
          log(uiText(`  Average latest score: ${stats.avgLatestScore.toFixed(3)}`, `  최신 점수 평균: ${stats.avgLatestScore.toFixed(3)}`));
          if (stats.chapterBreakdown.length > 0) {
            log(uiText(`  Chapters:`, `  챕터별:`));
            for (const ch of stats.chapterBreakdown) {
              log(uiText(
                `    Ch.${ch.chapterNumber}: ${ch.latestScore.toFixed(3)} (${ch.observationCount} observation(s))`,
                `    ${ch.chapterNumber}장: ${ch.latestScore.toFixed(3)} (기록 ${ch.observationCount}건)`,
              ));
            }
          }
        }
        return;
      }

      const detectionConfig = config.detection as DetectionConfig;

      if (opts.all) {
        const index = await state.loadChapterIndex(bookId);
        for (const ch of index) {
          const content = await readChapterContent(bookDir, ch.number);
          const result = await detectChapter(detectionConfig, content, ch.number, bookDir);
          printResult(result, opts.json);
        }
      } else {
        const targetChapter = chapterNumber ?? (await state.getNextChapterNumber(bookId)) - 1;
        if (targetChapter < 1) {
          logError(uiText("No chapters to detect.", "탐지할 챕터가 없습니다."));
          process.exit(1);
        }
        const content = await readChapterContent(bookDir, targetChapter);
        const result = await detectChapter(detectionConfig, content, targetChapter, bookDir);
        printResult(result, opts.json);
      }
    } catch (e) {
      logError(uiText(`Detection failed: ${e}`, `탐지에 실패했습니다: ${e}`));
      process.exit(1);
    }
  });

function printResult(
  result: { chapterNumber: number; detection: { score: number; provider: string } },
  json: boolean,
): void {
  if (json) {
    log(JSON.stringify(result, null, 2));
  } else {
    log(uiText(
      `  Chapter ${result.chapterNumber}: score=${result.detection.score.toFixed(3)} (${result.detection.provider})`,
      `  ${result.chapterNumber}장: 점수=${result.detection.score.toFixed(3)} (${result.detection.provider})`,
    ));
  }
}

async function readChapterContent(bookDir: string, chapterNumber: number): Promise<string> {
  const chaptersDir = join(bookDir, "chapters");
  const files = await readdir(chaptersDir);
  const paddedNum = String(chapterNumber).padStart(4, "0");
  const chapterFile = files.find((f) => f.startsWith(paddedNum) && f.endsWith(".md"));
  if (!chapterFile) {
    throw new Error(uiText(`Chapter ${chapterNumber} file not found`, `${chapterNumber}장 파일을 찾을 수 없습니다`));
  }
  const raw = await readFile(join(chaptersDir, chapterFile), "utf-8");
  const lines = raw.split("\n");
  const contentStart = lines.findIndex((l, i) => i > 0 && l.trim().length > 0);
  return contentStart >= 0 ? lines.slice(contentStart).join("\n") : raw;
}
