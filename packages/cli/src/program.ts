import { createRequire } from "node:module";
import { recoverAtomicFileSets } from "@actalk/inkos-core";
import { findProjectRoot } from "./utils.js";
import { Command, Help, type Argument, type Option } from "commander";
import { isKoreanUi, uiText } from "./ui-locale.js";
import { initCommand } from "./commands/init.js";
import { configCommand } from "./commands/config.js";
import { bookCommand } from "./commands/book.js";
import { chapterCommand } from "./commands/chapter.js";
import { writeCommand } from "./commands/write.js";
import { autoCommand } from "./commands/auto.js";
import { reviewCommand } from "./commands/review.js";
import { statusCommand } from "./commands/status.js";
import { radarCommand } from "./commands/radar.js";
import { upCommand, downCommand } from "./commands/daemon.js";
import { doctorCommand } from "./commands/doctor.js";
import { exportCommand } from "./commands/export.js";
import { reviseCommand } from "./commands/revise.js";
import { agentCommand } from "./commands/agent.js";
import { updateCommand } from "./commands/update.js";
import { detectCommand } from "./commands/detect.js";
import { styleCommand } from "./commands/style.js";
import { analyticsCommand } from "./commands/analytics.js";
import { importCommand } from "./commands/import.js";
import { fanficCommand } from "./commands/fanfic.js";
import { shortCommand } from "./commands/short-fiction.js";
import { forecastCommand } from "./commands/forecast.js";
import { translateCommand } from "./commands/translate.js";
import { createStudioCommand, launchStudioEntry } from "./commands/studio.js";
import { createInteractCommand, type InteractCommandHooks } from "./commands/interact.js";
import { createTuiCommand } from "./commands/tui.js";
import { launchTui } from "./tui/app.js";
import { workCommand } from "./commands/work.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

// Commander's built-in help copy (commander 13). Only swapped on a Korean UI;
// with INKOS_UI_LOCALE=follow the stock English text is left untouched.
const COMMANDER_HELP_DESCRIPTION = "display help for command";
const KOREAN_HELP_DESCRIPTION = "명령 도움말을 표시합니다";
const KOREAN_HELP_TITLES: Readonly<Record<string, string>> = {
  "Usage:": "사용법:",
  "Arguments:": "인수:",
  "Options:": "옵션:",
  "Global Options:": "전역 옵션:",
  "Commands:": "명령:",
};
const KOREAN_HELP_EXTRA_LABELS: Readonly<Record<string, string>> = {
  default: "기본값",
  choices: "선택지",
  preset: "생략 시 값",
  env: "환경 변수",
};

/** Translate the "(default: …, choices: …)" suffix Commander appends to descriptions. */
function localizeHelpExtraInfo(text: string, description: string): string {
  if (!text.startsWith(description)) return text;
  const suffix = text.slice(description.length).replace(
    /(^ ?\(|, )(default|choices|preset|env): /g,
    (_match, lead: string, label: string) => `${lead}${KOREAN_HELP_EXTRA_LABELS[label] ?? label}: `,
  );
  return `${description}${suffix}`;
}

// Hangul/CJK glyphs take two terminal columns; Commander counts them as one,
// which makes wrapped Korean help lines overflow the terminal width.
const WIDE_CHAR_PATTERN = /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA960-\uA97F\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/g;

function koreanDisplayWidth(this: Help, str: string): number {
  return Help.prototype.displayWidth.call(this, str) + (str.match(WIDE_CHAR_PATTERN)?.length ?? 0);
}

function koreanOptionDescription(this: Help, option: Option): string {
  return localizeHelpExtraInfo(Help.prototype.optionDescription.call(this, option), option.description);
}

function koreanArgumentDescription(this: Help, argument: Argument): string {
  return localizeHelpExtraInfo(Help.prototype.argumentDescription.call(this, argument), argument.description);
}

function koreanSubcommandDescription(this: Help, command: Command): string {
  const description = Help.prototype.subcommandDescription.call(this, command);
  // The implicit `help [command]` subcommand is created lazily by Commander with this stock text.
  return command.name() === "help" && description === COMMANDER_HELP_DESCRIPTION
    ? KOREAN_HELP_DESCRIPTION
    : description;
}

/**
 * Commands are built with `new Command()` + `addCommand()`, which does not copy
 * help settings from the parent, so walk the whole tree and configure each one.
 */
function applyKoreanCommanderHelp(command: Command): void {
  command.helpOption("-h, --help", KOREAN_HELP_DESCRIPTION);
  command.configureHelp({
    styleTitle: (title: string) => KOREAN_HELP_TITLES[title] ?? title,
    displayWidth: koreanDisplayWidth,
    optionDescription: koreanOptionDescription,
    argumentDescription: koreanArgumentDescription,
    subcommandDescription: koreanSubcommandDescription,
  });
  for (const subcommand of command.commands) {
    applyKoreanCommanderHelp(subcommand);
  }
}

export interface ProgramHooks {
  readonly launchTui?: (projectRoot: string) => Promise<void> | void;
  readonly launchStudio?: (projectRoot: string, port: string) => Promise<void> | void;
  readonly studioRecentProjectPath?: string;
  readonly readInteractionInput?: InteractCommandHooks["readInput"];
}

export function createProgram(hooks: ProgramHooks = {}): Command {
  const program = new Command();

  program
    .name("inkos")
    .description(uiText("InkOS — Multi-agent novel production system", "InkOS — 멀티 에이전트 소설 제작 시스템"))
    .version(version, "-V, --version", uiText("output the version number", "버전 번호를 출력합니다"))
    .enablePositionalOptions()
    .option("--service <service>", uiText("Override LLM service for this CLI run", "이번 CLI 실행에 쓸 LLM 서비스를 지정합니다"))
    .option("--model <model>", uiText("Override LLM model for this CLI run", "이번 CLI 실행에 쓸 LLM 모델을 지정합니다"))
    .option("--api-key-env <envVar>", uiText("Read LLM API key from this environment variable for this CLI run", "이번 CLI 실행에서 이 환경 변수의 LLM API 키를 읽습니다"))
    .option("--base-url <url>", uiText("Override LLM base URL for this CLI run", "이번 CLI 실행에 쓸 LLM 기본 URL을 지정합니다"))
    .option("--api-format <chat|responses|anthropic>", uiText("Override LLM API format for this CLI run", "이번 CLI 실행에 쓸 LLM API 형식을 지정합니다"))
    .option("--stream", uiText("Force streaming LLM responses for this CLI run", "이번 CLI 실행에서 LLM 응답을 스트리밍으로 받습니다"))
    .option("--no-stream", uiText("Force non-streaming LLM responses for this CLI run", "이번 CLI 실행에서 LLM 응답을 스트리밍 없이 받습니다"))
    .action(async () => {
      await launchStudioEntry(process.cwd(), "4567", {
        launchStudio: hooks.launchStudio,
        recentProjectPath: hooks.studioRecentProjectPath,
      });
    });

  program.addCommand(initCommand);
  program.addCommand(configCommand);
  program.addCommand(bookCommand);
  program.addCommand(workCommand);
  program.addCommand(chapterCommand);
  program.addCommand(writeCommand);
  program.addCommand(autoCommand);
  program.addCommand(reviewCommand);
  program.addCommand(statusCommand);
  program.addCommand(radarCommand);
  program.addCommand(upCommand);
  program.addCommand(downCommand);
  program.addCommand(doctorCommand);
  program.addCommand(exportCommand);
  program.addCommand(reviseCommand);
  program.addCommand(agentCommand);
  program.addCommand(updateCommand);
  program.addCommand(detectCommand);
  program.addCommand(styleCommand);
  program.addCommand(analyticsCommand);
  program.addCommand(importCommand);
  program.addCommand(fanficCommand);
  program.addCommand(shortCommand);
  program.addCommand(forecastCommand);
  program.addCommand(translateCommand);
  program.addCommand(createStudioCommand({
    launchStudio: hooks.launchStudio,
    recentProjectPath: hooks.studioRecentProjectPath,
  }));
  program.addCommand(createInteractCommand({
    readInput: hooks.readInteractionInput,
  }));
  program.addCommand(createTuiCommand({ launchTui: hooks.launchTui }));

  if (isKoreanUi()) applyKoreanCommanderHelp(program);

  return program;
}

export async function runProgram(
  argv: string[] = process.argv,
  hooks: ProgramHooks = {},
): Promise<void> {
  const program = createProgram(hooks);
  program.hook("preAction", async () => {
    let root: string;
    try { root = findProjectRoot(); }
    catch { return; } // init and help may run outside a project.
    await recoverAtomicFileSets(root, true);
  });
  await program.parseAsync(argv);
}
