import { Command } from "commander";
import { launchTui } from "../tui/app.js";
import { uiText } from "../ui-locale.js";

export interface TuiCommandHooks {
  readonly launchTui?: (projectRoot: string) => Promise<void> | void;
}

export function createTuiCommand(hooks: TuiCommandHooks = {}): Command {
  return new Command("tui")
    .description(uiText("Open the InkOS project workspace TUI", "InkOS 프로젝트 작업 공간 TUI를 엽니다"))
    .action(async () => {
      if (hooks.launchTui) {
        await hooks.launchTui(process.cwd());
        return;
      }
      await launchTui(process.cwd());
    });
}
