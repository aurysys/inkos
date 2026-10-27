import { dispatchNotification, type ProjectConfig } from "@actalk/inkos-core";
import { loadConfig, logError } from "./utils.js";
import { uiText } from "./ui-locale.js";

export interface CliNotifyMessage {
  readonly title: string;
  readonly body: string;
}

/**
 * Send a command-level notification (--notify) to the project's configured
 * notify channels. Callers guard with the --notify flag before invoking so
 * message strings are only assembled when a notification will be attempted.
 *
 * - Uses the caller's already-loaded project config when provided; otherwise
 *   loads it here (failure paths may fail before the command loaded it).
 * - Never throws: notification delivery must not change the command's exit
 *   code, so every failure is written to stderr as a warning instead.
 */
export async function sendCommandNotification(
  message: CliNotifyMessage,
  config?: ProjectConfig,
): Promise<void> {
  try {
    const resolved = config ?? (await loadConfig());
    const channels = resolved.notify ?? [];
    if (channels.length === 0) {
      logError(uiText(
        "--notify: no notify channels configured in project config (notify: []), skipping notification",
        "--notify: 프로젝트 설정에 알림 채널이 없어(notify: []) 알림을 건너뜁니다",
      ));
      return;
    }
    await dispatchNotification(channels, message);
  } catch (e) {
    logError(uiText(`--notify: failed to send notification: ${e}`, `--notify: 알림을 보내지 못했습니다: ${e}`));
  }
}
