/**
 * Writing (book/project) languages.
 *
 * Korean books reuse the English prompt set — every agent prompt exists in
 * zh and en only — and get an explicit output-language contract so the model
 * still writes the Work in Korean. Length is counted in Korean characters
 * including spaces, the usual unit on Korean web-novel platforms.
 */
export const WRITING_LANGUAGES = ["zh", "en", "ko"] as const;

export type WritingLanguage = typeof WRITING_LANGUAGES[number];

/** Language of the instruction text InkOS sends to models. */
export type PromptLanguage = "zh" | "en";

export function isWritingLanguage(value: unknown): value is WritingLanguage {
  return typeof value === "string" && (WRITING_LANGUAGES as readonly string[]).includes(value);
}

export function toPromptLanguage(language: string | undefined | null): PromptLanguage {
  return language === "en" || language === "ko" ? "en" : "zh";
}

/** English name of the prose language, for English-prompt sentences such as "Write everything in …". */
export function proseLanguageName(language: string | undefined | null): "Chinese" | "English" | "Korean" {
  if (language === "ko") return "Korean";
  return language === "en" ? "English" : "Chinese";
}

/**
 * Output-language contract for a Work whose prose language differs from the
 * prompt language. Empty for zh/en, whose prompts already set the language.
 */
export function writingLanguageDirective(language: string | undefined | null): string {
  if (language !== "ko") return "";
  return [
    "## Output language",
    "This Work is written in Korean (한국어). Write every piece of reader-facing or author-facing text — prose, dialogue, chapter titles, summaries, outlines, character and world notes, hooks, review notes — in natural, fluent Korean.",
    "Keep JSON keys, enum values, ids, hook ids, file names, Markdown structure and code identifiers exactly as specified. Instructions below may be in English; that does not change the output language.",
  ].join("\n");
}
