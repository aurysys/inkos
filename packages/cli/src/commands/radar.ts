import { Command } from "commander";
import { PipelineRunner } from "@actalk/inkos-core";
import { loadConfig, buildPipelineConfig, findProjectRoot, log, logError } from "../utils.js";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { uiText } from "../ui-locale.js";

export const radarCommand = new Command("radar")
  .description(uiText("Market intelligence", "시장 동향 분석"));

radarCommand
  .command("scan")
  .description(uiText("Scan market for opportunities", "시장을 스캔해 기회를 찾습니다"))
  .option("--json", uiText("Output JSON", "JSON으로 출력합니다"))
  .action(async (opts) => {
    try {
      const config = await loadConfig();
      const root = findProjectRoot();

      const pipeline = new PipelineRunner(buildPipelineConfig(config, root));

      if (!opts.json) log(uiText("Scanning market...", "시장을 스캔하는 중..."));

      const result = await pipeline.runRadar();

      // Save radar result
      const radarDir = join(root, "radar");
      await mkdir(radarDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filePath = join(radarDir, `scan-${timestamp}.json`);
      await writeFile(
        filePath,
        JSON.stringify(result, null, 2),
        "utf-8",
      );

      if (opts.json) {
        log(JSON.stringify({ ...result, savedTo: filePath }, null, 2));
      } else {
        log(uiText(`\nMarket Summary:\n${result.marketSummary}\n`, `\n시장 요약:\n${result.marketSummary}\n`));
        log(uiText("Recommendations:", "추천:"));

        for (const rec of result.recommendations) {
          log(`  ${rec.platform}/${rec.genre}`);
          log(uiText(`    Concept: ${rec.concept}`, `    콘셉트: ${rec.concept}`));
          log(uiText(`    Reasoning: ${rec.reasoning}`, `    근거: ${rec.reasoning}`));
          log(uiText(`    Benchmarks: ${rec.benchmarkTitles.join(", ")}`, `    참고 작품: ${rec.benchmarkTitles.join(", ")}`));
          log("");
        }

        log(uiText(`Radar result saved to radar/scan-${timestamp}.json`, `레이더 결과를 radar/scan-${timestamp}.json에 저장했습니다`));
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(uiText(`Radar scan failed: ${e}`, `레이더 스캔에 실패했습니다: ${e}`));
      }
      process.exit(1);
    }
  });
