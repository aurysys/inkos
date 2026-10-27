import { getUiLocale } from "./app-language";

const KNOWN_RUNTIME_REPLACEMENTS: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly replacement: string;
  readonly ko: string;
}> = [
  {
    pattern: /Studio LLM API key not set\. Open Studio services and save an API key for the selected service\./g,
    replacement: "Studio 模型 API Key 未设置。请打开“模型配置”，为当前服务保存 API Key。",
    ko: "Studio 모델 API 키가 설정되지 않았습니다. “모델 설정”을 열고 현재 서비스의 API 키를 저장하세요.",
  },
  {
    pattern: /INKOS_LLM_API_KEY not set\. Run 'inkos config set-global' or add it to project \.env file\./g,
    replacement: "INKOS_LLM_API_KEY 未设置。请运行 `inkos config set-global`，或在项目 .env 文件中添加它。",
    ko: "INKOS_LLM_API_KEY가 설정되지 않았습니다. `inkos config set-global`을 실행하거나 프로젝트 .env 파일에 추가하세요.",
  },
  // Codex CLI login errors (core/src/llm/codex-auth.ts).
  {
    pattern: /Codex CLI is not logged in \(([^)]*) not found\)\. Run `codex login` and sign in with ChatGPT\./g,
    replacement: "未检测到 Codex CLI 登录（找不到 $1）。请运行 `codex login` 并使用 ChatGPT 登录。",
    ko: "Codex CLI에 로그인되어 있지 않습니다($1 없음). `codex login`을 실행해 ChatGPT로 로그인하세요.",
  },
  {
    pattern: /Codex CLI has no ChatGPT login in ([^.]*\.json)\. Run `codex login` and choose "Sign in with ChatGPT"\./g,
    replacement: "$1 中没有 ChatGPT 登录信息。请运行 `codex login` 并选择 ChatGPT 登录。",
    ko: "$1에 ChatGPT 로그인 정보가 없습니다. `codex login`을 실행해 “Sign in with ChatGPT”를 선택하세요.",
  },
  {
    pattern: /Codex token refresh failed \(HTTP (\d+)\)\. Run `codex login` again\./g,
    replacement: "Codex 令牌刷新失败（HTTP $1）。请重新运行 `codex login`。",
    ko: "Codex 토큰 갱신에 실패했습니다(HTTP $1). `codex login`을 다시 실행하세요.",
  },
];

export function localizeKnownRuntimeMessage(message: string): string {
  // Runtime messages arrive in English; in English mode show them as-is.
  const locale = getUiLocale();
  if (locale === "en") return message;
  let localized = message;
  for (const entry of KNOWN_RUNTIME_REPLACEMENTS) {
    localized = localized.replace(entry.pattern, locale === "ko" ? entry.ko : entry.replacement);
  }
  return localized;
}
