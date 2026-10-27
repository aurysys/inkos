// 全局应用语言：非 React 模块（store slice、parts-builder、error-copy 等）无法用
// useI18n hook，从这里读取。App.tsx 在项目配置加载/切换语言时调用 setAppLanguage 同步。
export type AppLanguage = "zh" | "en";

// 项目/书籍写作语言。ko 书籍使用英文提示词集，并额外约束正文为韩语。
export type WritingLanguage = "zh" | "en" | "ko";

export function isWritingLanguage(value: unknown): value is WritingLanguage {
  return value === "zh" || value === "en" || value === "ko";
}

// 界面语言：与项目写作语言（AppLanguage）分离。"ko" 时界面固定为韩语，
// 写作语言仍由项目配置决定；"follow" 时界面跟随项目写作语言（原有行为）。
export type UiLocale = "ko" | AppLanguage;
export type UiLocalePreference = "ko" | "follow";

const UI_LOCALE_STORAGE_KEY = "inkos.uiLocale";

let current: AppLanguage = "zh";
let projectWritingLanguage: WritingLanguage = "zh";
let uiLocalePreference: UiLocalePreference = readStoredUiLocalePreference();

function getUiLocaleStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 浏览器里默认韩语界面；无 window（Node 测试）时保持跟随项目语言。 */
function readStoredUiLocalePreference(): UiLocalePreference {
  if (typeof window === "undefined") {
    return "follow";
  }
  try {
    const stored = getUiLocaleStorage()?.getItem(UI_LOCALE_STORAGE_KEY);
    return stored === "follow" ? "follow" : "ko";
  } catch {
    return "ko";
  }
}

/** Sync the project writing language; copy uses zh/en (ko projects read English copy unless the UI is Korean). */
export function setAppLanguage(lang: WritingLanguage): void {
  projectWritingLanguage = lang;
  current = lang === "zh" ? "zh" : "en";
}

export function getProjectWritingLanguage(): WritingLanguage {
  return projectWritingLanguage;
}

export function getAppLanguage(): AppLanguage {
  return current;
}

export function getUiLocalePreference(): UiLocalePreference {
  return uiLocalePreference;
}

export function setUiLocalePreference(preference: UiLocalePreference): void {
  uiLocalePreference = preference;
  try {
    getUiLocaleStorage()?.setItem(UI_LOCALE_STORAGE_KEY, preference);
  } catch {
    // Storage may be unavailable (private mode); the in-memory preference still applies.
  }
}

export function getUiLocale(): UiLocale {
  // Following a Korean-writing project also means a Korean UI.
  if (uiLocalePreference === "ko" || projectWritingLanguage === "ko") return "ko";
  return current;
}

/**
 * 内联多语：tr("中文", "English", "한국어")。默认中文，保持既有测试与默认体验不变。
 * 韩语界面缺少译文时回退到英文。
 */
export function tr(zh: string, en: string, ko?: string): string {
  const locale = getUiLocale();
  if (locale === "ko") return ko ?? en;
  return locale === "en" ? en : zh;
}

/**
 * 按项目写作语言挑选的“内容”文案（发给 Agent 的消息、写入作品的默认文本），
 * 不受界面语言影响。
 */
export function trContent(zh: string, en: string): string {
  return current === "en" ? en : zh;
}
