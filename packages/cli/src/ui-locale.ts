/**
 * Display locale for CLI/TUI copy, independent of the project writing language.
 * INKOS_UI_LOCALE=follow restores the original zh/en behavior; anything else
 * (including unset) shows Korean copy, falling back to English where no
 * Korean text exists.
 */
export function isKoreanUi(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.INKOS_UI_LOCALE?.trim().toLowerCase() !== "follow";
}

/** Fixed English copy (command help, option descriptions) with its Korean translation. */
export function uiText(en: string, ko: string): string {
  return isKoreanUi() ? ko : en;
}
