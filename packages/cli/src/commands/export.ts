import { Command } from "commander";
import { StateManager, writeExportArtifact, ChapterExportSourceError } from "@actalk/inkos-core";
import { join } from "node:path";
import { findProjectRoot, resolveBookId, log, logError } from "../utils.js";
import { uiText } from "../ui-locale.js";

export const exportCommand = new Command("export")
  .description(uiText("Export book chapters to a single file", "책의 챕터를 하나의 파일로 내보냅니다"))
  .argument("[book-id]", uiText("Book ID (auto-detected if only one book)", "책 ID(책이 하나뿐이면 자동으로 찾습니다)"))
  .option("--format <format>", uiText("Output format (txt, md, epub)", "출력 형식(txt, md, epub)"), "txt")
  .option("--output <path>", uiText("Output file path", "출력 파일 경로"))
  .option("--json", uiText("Output JSON metadata", "메타데이터를 JSON으로 출력합니다"))
  .action(async (bookIdArg: string | undefined, opts) => {
    try {
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const state = new StateManager(root);

      const result = await writeExportArtifact(state, bookId, {
        format: opts.format as "txt" | "md" | "epub",
        outputPath: opts.output ?? join(root, `${bookId}_export.${opts.format}`),
      });

      if (opts.json) {
        log(JSON.stringify({
          bookId,
          chaptersExported: result.chaptersExported,
          totalWords: result.totalWords,
          format: result.format,
          outputPath: result.outputPath,
        }, null, 2));
      } else {
        log(uiText(
          `Exported ${result.chaptersExported} chapters (${result.totalWords} words)`,
          `챕터 ${result.chaptersExported}개를 내보냈습니다(${result.totalWords}자)`,
        ));
        log(uiText(`Output: ${result.outputPath}`, `출력 파일: ${result.outputPath}`));
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e), ...(e instanceof ChapterExportSourceError ? {code:e.code,details:e.details} : {}) }));
      } else {
        logError(uiText(`Failed to export: ${e}`, `내보내지 못했습니다: ${e}`));
      }
      process.exit(1);
    }
  });
