import { Command } from "commander";
import {
  FORECAST_DEFAULT_BRANCHES,
  FORECAST_DEFAULT_HORIZON,
  PipelineRunner,
  createNarrativeForecast,
  getNarrativeForecast,
  selectNarrativeBranch,
  type NarrativeForecast,
} from "@actalk/inkos-core";
import { buildPipelineConfig, findProjectRoot, loadConfig, log, logError, resolveBookId, resolveCliProfileSkills } from "../utils.js";
import { uiText } from "../ui-locale.js";

// CLI surface for RFC #342: create / show / select. All three operate only on
// story/runtime/narrative-forecasts/ artifacts; canonical files stay untouched.

export const forecastCommand = new Command("forecast")
  .description(uiText("Narrative forecast: compare non-canonical future branches before writing", "전개 예측: 집필 전에 정식 설정에 반영되지 않는 미래 분기를 비교합니다"));

forecastCommand
  .command("create")
  .description(uiText("Create isolated candidate future branches from the current canon", "현재 정식 설정에서 서로 독립된 미래 분기 후보를 만듭니다"))
  .argument("[book-id]", uiText("Book ID (auto-detected if only one book)", "책 ID(책이 하나뿐이면 자동으로 찾습니다)"))
  .requiredOption("--divergence <text>", uiText("Divergence point to branch on, e.g. \"主角是否接受对手的合作提议\"", "분기를 나눌 갈림길, 예: \"주인공이 라이벌의 협력 제안을 받아들이는가\""))
  .option("--branches <n>", uiText("Number of isolated candidate branches", "독립된 분기 후보 수"), String(FORECAST_DEFAULT_BRANCHES))
  .option("--horizon <n>", uiText("Future chapters each branch covers", "분기마다 내다볼 이후 챕터 수"), String(FORECAST_DEFAULT_HORIZON))
  .option("--model <model>", uiText("Override the forecast model", "전개 예측에 쓸 모델을 지정합니다"))
  .option("--llm-base-url <url>", uiText("Override LLM base URL", "LLM 기본 URL을 지정합니다"))
  .option("--json", uiText("Output JSON", "JSON으로 출력합니다"))
  .action(async (bookIdArg: string | undefined, opts: ForecastCreateOptions) => {
    try {
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const branchCount = parsePositiveInteger(opts.branches, FORECAST_DEFAULT_BRANCHES, "branches");
      const horizon = parsePositiveInteger(opts.horizon, FORECAST_DEFAULT_HORIZON, "horizon");

      const config = await loadConfig({ projectRoot: root });
      if (opts.llmBaseUrl) config.llm.baseUrl = opts.llmBaseUrl;
      if (opts.model) config.llm.model = opts.model;
      const pipeline = new PipelineRunner(buildPipelineConfig(config, root, { quiet: Boolean(opts.json) }));
      const activatedSkills = await resolveCliProfileSkills(root, "longform-novel");

      const result = await pipeline.runWithAgentContext({ activatedSkills }, () => createNarrativeForecast({
          projectRoot: root,
          bookId,
          divergence: opts.divergence,
          branchCount,
          horizon,
          runtime: pipeline.createAgentContext("forecast", bookId),
          onProgress: opts.json ? undefined : (message) => log(message),
        }));

      if (opts.json) {
        log(JSON.stringify({
          forecast: result.forecast,
          forecastJsonPath: result.forecastJsonPath,
          comparisonPath: result.comparisonPath,
        }, null, 2));
        return;
      }
      log(uiText(
        `Forecast created: ${result.forecast.forecastId} (base chapter ${result.forecast.baseChapter})`,
        `전개 예측을 만들었습니다: ${result.forecast.forecastId} (기준 챕터 ${result.forecast.baseChapter})`,
      ));
      for (const line of formatBranchLines(result.forecast)) log(line);
      log(uiText(`Comparison: ${result.comparisonPath}`, `비교 문서: ${result.comparisonPath}`));
      log(uiText(
        `Select a branch with: inkos forecast select ${bookId} ${result.forecast.forecastId} <branch-id>`,
        `분기를 선택하려면: inkos forecast select ${bookId} ${result.forecast.forecastId} <branch-id>`,
      ));
    } catch (e) {
      failForecastCommand("Forecast create failed", "전개 예측을 만들지 못했습니다", e, opts.json);
    }
  });

forecastCommand
  .command("show")
  .description(uiText("Show a narrative forecast and re-check it against the current canon (marks it stale when canon changed)", "전개 예측을 보여 주고 현재 정식 설정과 다시 대조합니다(설정이 바뀌었으면 오래됨으로 표시)"))
  .argument("<args...>", "[book-id] <forecast-id>")
  .option("--json", uiText("Output JSON", "JSON으로 출력합니다"))
  .action(async (args: string[], opts: ForecastReadOptions) => {
    try {
      const { bookIdArg, forecastId } = parseForecastShowArgs(args);
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);

      const result = await getNarrativeForecast({ projectRoot: root, bookId, forecastId });

      if (opts.json) {
        log(JSON.stringify({
          forecast: result.forecast,
          stale: result.stale,
          forecastJsonPath: result.forecastJsonPath,
          comparisonPath: result.comparisonPath,
        }, null, 2));
        return;
      }
      log(uiText(
        `Forecast ${result.forecast.forecastId} — status: ${result.stale ? "stale" : result.forecast.status}`,
        `전개 예측 ${result.forecast.forecastId} — 상태: ${result.stale ? "오래됨(stale)" : result.forecast.status}`,
      ));
      log(uiText(`Divergence: ${result.forecast.divergence}`, `갈림길: ${result.forecast.divergence}`));
      log(uiText(
        `Base chapter: ${result.forecast.baseChapter}, horizon: ~${result.forecast.horizon} chapters`,
        `기준 챕터: ${result.forecast.baseChapter}, 예측 범위: 약 ${result.forecast.horizon}챕터`,
      ));
      if (result.stale) {
        log(uiText(
          "WARNING: canon changed after this forecast was generated; regenerate before relying on it.",
          "경고: 이 전개 예측을 만든 뒤 정식 설정이 바뀌었습니다. 참고하기 전에 다시 생성하세요.",
        ));
      }
      for (const line of formatBranchLines(result.forecast)) log(line);
      log(uiText(`Comparison: ${result.comparisonPath}`, `비교 문서: ${result.comparisonPath}`));
    } catch (e) {
      failForecastCommand("Forecast show failed", "전개 예측을 보여 주지 못했습니다", e, opts.json);
    }
  });

forecastCommand
  .command("select")
  .description(uiText("Select a branch: writes only selected-branch-plan.md; canonical files are never modified", "분기를 선택합니다: selected-branch-plan.md만 쓰며 정식 설정 파일은 바꾸지 않습니다"))
  .argument("<args...>", "[book-id] <forecast-id> <branch-id>")
  .option("--json", uiText("Output JSON", "JSON으로 출력합니다"))
  .action(async (args: string[], opts: ForecastReadOptions) => {
    try {
      const { bookIdArg, forecastId, branchId } = parseForecastSelectArgs(args);
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);

      const result = await selectNarrativeBranch({ projectRoot: root, bookId, forecastId, branchId });

      if (opts.json) {
        log(JSON.stringify({
          forecastId: result.forecast.forecastId,
          branchId: result.branch.branchId,
          branchTitle: result.branch.title,
          stale: result.stale,
          planPath: result.planPath,
        }, null, 2));
        return;
      }
      log(uiText(
        `Selected ${result.branch.branchId} "${result.branch.title}" from ${result.forecast.forecastId}.`,
        `${result.forecast.forecastId}에서 ${result.branch.branchId} "${result.branch.title}"을(를) 선택했습니다.`,
      ));
      if (result.stale) {
        log(uiText(
          "WARNING: this forecast is stale; the plan includes a stale warning.",
          "경고: 이 전개 예측은 오래되었습니다. 계획서에 해당 경고가 포함됩니다.",
        ));
      }
      log(uiText(`Plan: ${result.planPath}`, `계획서: ${result.planPath}`));
      log(uiText(
        "Canonical files were not modified. Applying the plan to the outline is a separate, explicit step.",
        "정식 설정 파일은 바뀌지 않았습니다. 계획을 개요에 반영하는 일은 따로 명시적으로 진행해야 합니다.",
      ));
    } catch (e) {
      failForecastCommand("Forecast select failed", "분기를 선택하지 못했습니다", e, opts.json);
    }
  });

interface ForecastCreateOptions {
  readonly divergence: string;
  readonly branches?: string;
  readonly horizon?: string;
  readonly model?: string;
  readonly llmBaseUrl?: string;
  readonly json?: boolean;
}

interface ForecastReadOptions {
  readonly json?: boolean;
}

export function parseForecastShowArgs(args: ReadonlyArray<string>): {
  readonly bookIdArg?: string;
  readonly forecastId: string;
} {
  if (args.length === 1) return { forecastId: args[0]! };
  if (args.length === 2) return { bookIdArg: args[0]!, forecastId: args[1]! };
  throw new Error(uiText("Usage: inkos forecast show [book-id] <forecast-id>", "사용법: inkos forecast show [book-id] <forecast-id>"));
}

export function parseForecastSelectArgs(args: ReadonlyArray<string>): {
  readonly bookIdArg?: string;
  readonly forecastId: string;
  readonly branchId: string;
} {
  if (args.length === 2) return { forecastId: args[0]!, branchId: args[1]! };
  if (args.length === 3) return { bookIdArg: args[0]!, forecastId: args[1]!, branchId: args[2]! };
  throw new Error(uiText("Usage: inkos forecast select [book-id] <forecast-id> <branch-id>", "사용법: inkos forecast select [book-id] <forecast-id> <branch-id>"));
}

function formatBranchLines(forecast: NarrativeForecast): string[] {
  return forecast.branches.map((branch) =>
    uiText(
      `- ${branch.branchId} "${branch.title}" — ${branch.risks.length} risk(s)`,
      `- ${branch.branchId} "${branch.title}" — 위험 요소 ${branch.risks.length}개`,
    ));
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  const parsed = value ? Number.parseInt(value, 10) : fallback;
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(uiText(`${name} must be a positive integer.`, `${name}은(는) 양의 정수여야 합니다.`));
  }
  return parsed;
}

function failForecastCommand(prefix: string, koPrefix: string, error: unknown, json?: boolean): void {
  if (json) {
    log(JSON.stringify({ error: `${prefix}: ${String(error)}` }, null, 2));
  } else {
    logError(`${uiText(prefix, koPrefix)}: ${String(error)}`);
  }
  process.exitCode = 1;
}
