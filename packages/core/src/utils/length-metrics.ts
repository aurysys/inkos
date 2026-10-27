import type { LengthCountingMode, LengthSpec } from "../models/length-governance.js";
import type { WritingLanguage } from "./writing-language.js";

export type LengthLanguage = WritingLanguage;

// Per-chapter length default in the book's native unit: Chinese counts characters (3000字),
// English counts words (~2000 ≈ a 3000-char chapter). One cross-language number would mis-scale —
// 3000 read as English words runs ~50% long, and the hard-range guard then force-expands correct chapters.
// Korean counts characters including spaces (Korean web-novel convention, ~5000자 per chapter).
export const DEFAULT_CHAPTER_LENGTH_ZH = 3000;
export const DEFAULT_CHAPTER_LENGTH_EN = 2000;
export const DEFAULT_CHAPTER_LENGTH_KO = 5000;

export function defaultChapterLength(language: LengthLanguage = "zh"): number {
  if (language === "ko") return DEFAULT_CHAPTER_LENGTH_KO;
  return language === "en" ? DEFAULT_CHAPTER_LENGTH_EN : DEFAULT_CHAPTER_LENGTH_ZH;
}

export function countChapterLength(
  content: string,
  countingMode: LengthCountingMode,
): number {
  const normalized = stripMarkdownMetadata(content);

  if (countingMode === "en_words") {
    const words = normalized.match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?/g);
    return words?.length ?? 0;
  }

  if (countingMode === "ko_chars") {
    // Spaces count, line breaks do not.
    return normalized.replace(/[\r\n]+/g, "").trim().length;
  }

  return normalized.replace(/\s+/g, "").length;
}

export function resolveLengthCountingMode(
  language: LengthLanguage = "zh",
): LengthCountingMode {
  if (language === "ko") return "ko_chars";
  return language === "en" ? "en_words" : "zh_chars";
}

export function formatLengthCount(
  count: number,
  countingMode: LengthCountingMode,
): string {
  if (countingMode === "ko_chars") return `${count}자`;
  return countingMode === "en_words" ? `${count} words` : `${count}字`;
}

/** Length unit phrase for model instructions, in the prompt language. */
export function describeLengthUnit(countingMode: LengthCountingMode, promptLanguage: "zh" | "en"): string {
  if (countingMode === "ko_chars") {
    return promptLanguage === "en" ? "Korean characters (spaces included)" : "个韩文字符（含空格）";
  }
  if (countingMode === "en_words") return promptLanguage === "en" ? "words" : "个英文单词";
  return promptLanguage === "en" ? "Chinese characters" : "字";
}

export function buildLengthSpec(
  target: number,
  language: LengthLanguage = "zh",
  bounds: { readonly minChapterLength?: number; readonly maxChapterLength?: number } = {},
): LengthSpec {
  return {
    target,
    countingMode: resolveLengthCountingMode(language),
    ...(bounds.minChapterLength!==undefined?{minChapterLength:bounds.minChapterLength}:{}),
    ...(bounds.maxChapterLength!==undefined?{maxChapterLength:bounds.maxChapterLength}:{}),
  };
}

/** Explicit author bounds are hard checks; an approximate target alone is not. */
export function chapterLengthDelivery(count: number, spec: LengthSpec) {
  if(spec.minChapterLength===undefined&&spec.maxChapterLength===undefined)return undefined;
  const issues: Array<{code:string;actual:number;minimum?:number;maximum?:number}>=[];
  if((spec.minChapterLength!==undefined&&count<spec.minChapterLength)
    ||(spec.maxChapterLength!==undefined&&count>spec.maxChapterLength))issues.push({
      code:"CHAPTER_LENGTH_OUT_OF_RANGE",actual:count,minimum:spec.minChapterLength,maximum:spec.maxChapterLength,
    });
  return {status:issues.length?"needs_revision" as const:"checks_passed" as const,
    measurements:{count,countingMode:spec.countingMode},target:spec,issues};
}

export function assertChapterLength(content: string, spec?: LengthSpec): void {
  if(!spec)return;
  const delivery=chapterLengthDelivery(countChapterLength(content,spec.countingMode),spec);
  if(delivery?.issues.length)throw Object.assign(new Error(JSON.stringify({
    code:"CHAPTER_LENGTH_OUT_OF_RANGE",...delivery,
    instruction:"Revise the complete chapter into the explicit length range, preserving core events and causal continuity.",
  })),{code:"CHAPTER_LENGTH_OUT_OF_RANGE",delivery});
}

function stripMarkdownMetadata(content: string): string {
  const lines = content.replace(/\r\n/g, "\n").replace(/^\uFEFF/, "").split("\n");
  const proseLines: string[] = [];
  let index = 0;

  if (lines[index]?.trim() === "---") {
    index += 1;
    while (index < lines.length && lines[index]?.trim() !== "---") {
      index += 1;
    }
    if (index < lines.length) {
      index += 1;
    }
  }

  let inFence = false;
  for (; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    if (/^#{1,6}\s+/.test(trimmed)) {
      continue;
    }
    if (trimmed === "---" || trimmed === "...") {
      continue;
    }

    proseLines.push(line);
  }

  return proseLines.join("\n");
}
