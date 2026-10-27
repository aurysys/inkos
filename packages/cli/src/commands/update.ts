import { Command } from "commander";
import { execSync } from "node:child_process";
import { log, logError } from "../utils.js";
import { uiText } from "../ui-locale.js";

export const updateCommand = new Command("update")
  .description(uiText("Update InkOS to the latest version", "InkOS를 최신 버전으로 업데이트합니다"))
  .action(async () => {
    try {
      const { createRequire } = await import("node:module");
      const require = createRequire(import.meta.url);
      const { version: currentVersion } = require("../../package.json") as { version: string };

      log(uiText(`Current version: ${currentVersion}`, `현재 버전: ${currentVersion}`));
      log(uiText("Checking npm registry...", "npm 레지스트리를 확인하는 중..."));

      const remoteVersion = execSync("npm view @actalk/inkos version", {
        encoding: "utf-8",
      }).trim();

      if (currentVersion === remoteVersion) {
        log(uiText(`Already up to date (${currentVersion}).`, `이미 최신 버전입니다(${currentVersion}).`));
        return;
      }

      // Don't downgrade development versions
      const current = currentVersion.split(".").map(Number);
      const remote = remoteVersion.split(".").map(Number);
      const isNewer = current[0]! > remote[0]! ||
        (current[0] === remote[0] && current[1]! > remote[1]!) ||
        (current[0] === remote[0] && current[1] === remote[1] && current[2]! > remote[2]!);

      if (isNewer) {
        log(uiText(
          `You're running a newer development version (${currentVersion} > ${remoteVersion}). Skipping.`,
          `더 새로운 개발 버전을 사용 중입니다(${currentVersion} > ${remoteVersion}). 업데이트를 건너뜁니다.`,
        ));
        return;
      }

      log(uiText(`Updating: ${currentVersion} → ${remoteVersion}`, `업데이트 중: ${currentVersion} → ${remoteVersion}`));
      execSync("npm install -g @actalk/inkos@latest", { stdio: "inherit" });
      log(uiText(`Updated to ${remoteVersion}.`, `${remoteVersion}(으)로 업데이트했습니다.`));
    } catch (e) {
      logError(uiText(`Update failed: ${e}`, `업데이트에 실패했습니다: ${e}`));
      log(uiText("You can also update manually: npm install -g @actalk/inkos@latest", "직접 업데이트할 수도 있습니다: npm install -g @actalk/inkos@latest"));
      process.exit(1);
    }
  });
