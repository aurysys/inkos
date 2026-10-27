import { Command } from "commander";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { readCodexAuthStatus } from "@actalk/inkos-core";
import { log, logError } from "../utils.js";
import { initializeProjectDirectory } from "../project-bootstrap.js";
import { uiText } from "../ui-locale.js";

export const initCommand = new Command("init")
  .description(uiText("Initialize an InkOS project (current directory by default)", "InkOS 프로젝트를 초기화합니다(기본값은 현재 디렉터리)"))
  .argument("[name]", uiText("Project name (creates subdirectory). Omit to init current directory.", "프로젝트 이름(하위 디렉터리를 만듭니다). 생략하면 현재 디렉터리를 초기화합니다."))
  .option("--lang <language>", uiText("Default writing language: zh (Chinese) or en (English)", "기본 집필 언어: zh(중국어) 또는 en(영어)"), "zh")
  .action(async (name: string | undefined, opts: { lang?: string }) => {
    const projectDir = name ? resolve(process.cwd(), name) : process.cwd();

    try {
      await mkdir(projectDir, { recursive: true });
      await initializeProjectDirectory(projectDir, {
        language: (opts.lang === "en" ? "en" : "zh"),
        overwriteSupportFiles: true,
      });

      log(uiText(`Project initialized at ${projectDir}`, `${projectDir}에 프로젝트를 초기화했습니다`));
      log("");
      const isEnglish = (opts.lang ?? "zh") === "en";
      const exampleCreateLines = isEnglish
        ? ["  inkos book create --title 'My Novel' --genre progression --platform royalroad --lang en"]
        : [
          "  inkos book create --title '我的小说' --genre xuanhuan --platform tomato",
          uiText("  # English project? Re-run with: inkos init --lang en", "  # 영어 프로젝트라면 다음으로 다시 실행하세요: inkos init --lang en"),
        ];
      // New projects use the Codex CLI service (see project-bootstrap.ts), so report its login state.
      const codex = await readCodexAuthStatus();
      if (codex.loggedIn) {
        log(uiText(
          "LLM: Codex CLI (ChatGPT login) — no API key needed. Ready to go!",
          "LLM: Codex CLI(ChatGPT 로그인)를 사용합니다 — API 키가 필요 없습니다. 바로 시작할 수 있습니다!",
        ));
      } else {
        log(uiText(
          "LLM: Codex CLI (ChatGPT login). Sign in first: run `codex login` and choose Sign in with ChatGPT.",
          "LLM: Codex CLI(ChatGPT 로그인)를 사용합니다. 먼저 `codex login`을 실행해 ChatGPT로 로그인하세요.",
        ));
      }
      log(uiText(
        "  To use another provider, open Studio (inkos studio) → Model Config.",
        "  다른 서비스를 쓰려면 Studio(inkos studio) → 모델 설정에서 바꾸세요.",
      ));
      log("");
      log(uiText("Next steps:", "다음 단계:"));
      if (name) log(`  cd ${name}`);
      for (const line of exampleCreateLines) log(line);
      log("  inkos write next <book-id>");
    } catch (e) {
      logError(uiText(`Failed to initialize project: ${e}`, `프로젝트를 초기화하지 못했습니다: ${e}`));
      process.exit(1);
    }
  });
