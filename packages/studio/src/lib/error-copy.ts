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
