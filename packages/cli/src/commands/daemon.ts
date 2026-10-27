import { Command } from "commander";
import { Scheduler } from "@actalk/inkos-core";
import { loadConfig, findProjectRoot, buildPipelineConfig, log, logError } from "../utils.js";
import { createWriteStream, type WriteStream } from "node:fs";
import { writeFile, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { uiText } from "../ui-locale.js";

const PID_FILE = "inkos.pid";

export const upCommand = new Command("up")
  .description(uiText("Start the InkOS daemon (autonomous mode)", "InkOS 데몬을 시작합니다(자율 모드)"))
  .option("-q, --quiet", uiText("Suppress console output", "콘솔 출력을 숨깁니다"))
  .action(async (opts) => {
    let logStream: WriteStream | undefined;
    let pidPath: string | undefined;
    try {
      const config = await loadConfig();
      const root = findProjectRoot();

      // Check if already running
      pidPath = join(root, PID_FILE);
      try {
        const existingPid = await readFile(pidPath, "utf-8");
        logError(uiText(
          `Daemon already running (PID: ${existingPid.trim()}). Run 'inkos down' first.`,
          `데몬이 이미 실행 중입니다(PID: ${existingPid.trim()}). 먼저 'inkos down'을 실행하세요.`,
        ));
        process.exit(1);
      } catch {
        // No PID file, good
      }

      log(uiText("Starting InkOS daemon...", "InkOS 데몬을 시작하는 중..."));
      log(uiText(`  Write cycle: ${config.daemon.schedule.writeCron}`, `  집필 주기: ${config.daemon.schedule.writeCron}`));
      log(uiText(`  Radar scan: ${config.daemon.schedule.radarCron}`, `  레이더 스캔: ${config.daemon.schedule.radarCron}`));
      log(uiText(`  Max concurrent books: ${config.daemon.maxConcurrentBooks}`, `  동시 처리 최대 책 수: ${config.daemon.maxConcurrentBooks}`));
      log("");

      // Write PID file
      await writeFile(pidPath, String(process.pid), "utf-8");

      // File logging for daemon
      const logPath = join(root, "inkos.log");
      logStream = createWriteStream(logPath, { flags: "a" });

      const scheduler = new Scheduler({
        ...buildPipelineConfig(config, root, { logFile: logStream, quiet: opts.quiet }),
        radarCron: config.daemon.schedule.radarCron,
        writeCron: config.daemon.schedule.writeCron,
        maxConcurrentBooks: config.daemon.maxConcurrentBooks,
        chaptersPerCycle: config.daemon.chaptersPerCycle,
        retryDelayMs: config.daemon.retryDelayMs,
        cooldownAfterChapterMs: config.daemon.cooldownAfterChapterMs,
        maxChaptersPerDay: config.daemon.maxChaptersPerDay,
        onChapterComplete: (bookId, chapter) => {
          log(uiText(`  [+] ${bookId} Ch.${chapter}`, `  [+] ${bookId} ${chapter}장`));
        },
        onError: (bookId, error) => {
          logError(`${bookId}: ${error.message}`);
        },
      });

      // Handle shutdown
      const shutdown = async () => {
        log(uiText("\nShutting down daemon...", "\n데몬을 종료하는 중..."));
        scheduler.stop();
        logStream?.end();
        const currentPidPath = pidPath;
        if (currentPidPath !== undefined) {
          try {
            await unlink(currentPidPath);
          } catch {
            // ignore
          }
        }
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      await scheduler.start();
      log(uiText("Daemon running. Press Ctrl+C to stop.", "데몬이 실행 중입니다. 멈추려면 Ctrl+C를 누르세요."));

      // Keep process alive
      await new Promise(() => {});
    } catch (e) {
      logStream?.end();
      if (pidPath !== undefined) {
        try {
          await unlink(pidPath);
        } catch {
          // ignore
        }
      }
      logError(uiText(`Failed to start daemon: ${e}`, `데몬을 시작하지 못했습니다: ${e}`));
      process.exit(1);
    }
  });

export const downCommand = new Command("down")
  .description(uiText("Stop the InkOS daemon", "InkOS 데몬을 멈춥니다"))
  .action(async () => {
    const root = findProjectRoot();
    const pidPath = join(root, PID_FILE);

    try {
      const pid = (await readFile(pidPath, "utf-8")).trim();
      try {
        process.kill(parseInt(pid, 10), "SIGTERM");
        log(uiText(`Daemon (PID: ${pid}) stopped.`, `데몬(PID: ${pid})을 멈췄습니다.`));
      } catch {
        log(uiText(`Daemon (PID: ${pid}) not found. Cleaning up.`, `데몬(PID: ${pid})을 찾을 수 없습니다. 남은 파일을 정리합니다.`));
      }
      try { await unlink(pidPath); } catch { /* already cleaned up by daemon */ }
    } catch {
      log(uiText("No daemon running.", "실행 중인 데몬이 없습니다."));
    }
  });
