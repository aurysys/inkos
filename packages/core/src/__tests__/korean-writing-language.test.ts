import { describe, expect, it } from "vitest";
import {
  isWritingLanguage,
  proseLanguageName,
  toPromptLanguage,
  writingLanguageDirective,
} from "../utils/writing-language.js";
import {
  buildLengthSpec,
  countChapterLength,
  defaultChapterLength,
  describeLengthUnit,
  formatLengthCount,
} from "../utils/length-metrics.js";
import { readChapterHeading, splitChapters } from "../utils/chapter-splitter.js";
import { chapterDocumentBody, renderChapterDocument } from "../utils/chapter-document.js";
import { BookConfigSchema } from "../models/book.js";
import { renderScriptSpec, renderStoryboardSpec } from "../agents/script-storyboard.js";

describe("Korean writing language", () => {
  it("runs Korean books on the English prompt set with a Korean output contract", () => {
    expect(isWritingLanguage("ko")).toBe(true);
    expect(toPromptLanguage("ko")).toBe("en");
    expect(toPromptLanguage("zh")).toBe("zh");
    expect(toPromptLanguage(undefined)).toBe("zh");
    expect(proseLanguageName("ko")).toBe("Korean");
    expect(writingLanguageDirective("ko")).toContain("Korean");
    expect(writingLanguageDirective("en")).toBe("");
    expect(writingLanguageDirective("zh")).toBe("");
  });

  it("accepts ko in book configs", () => {
    const book = BookConfigSchema.parse({
      id: "내-소설",
      title: "내 소설",
      platform: "munpia",
      genre: "fantasy",
      status: "outlining",
      targetChapters: 100,
      chapterWordCount: 5000,
      language: "ko",
      createdAt: "2026-10-27T00:00:00.000Z",
      updatedAt: "2026-10-27T00:00:00.000Z",
    });
    expect(book.language).toBe("ko");
  });

  it("counts Korean characters including spaces but not line breaks", () => {
    const spec = buildLengthSpec(5000, "ko");
    expect(spec.countingMode).toBe("ko_chars");
    expect(defaultChapterLength("ko")).toBe(5000);
    expect(countChapterLength("그는 문을 열었다.\n\n밖은 비가 왔다.", "ko_chars")).toBe(19);
    expect(formatLengthCount(19, "ko_chars")).toBe("19자");
    expect(describeLengthUnit("ko_chars", "en")).toBe("Korean characters (spaces included)");
  });

  it("recognizes Korean chapter headings without mistaking prose for one", () => {
    expect(readChapterHeading("제12장 귀환")).toEqual({ number: 12, title: "귀환", language: "ko" });
    expect(readChapterHeading("# 3화 - 첫 만남")).toEqual({ number: 3, title: "첫 만남", language: "ko" });
    expect(readChapterHeading("7장")).toEqual({ number: 7, title: "", language: "ko" });
    expect(readChapterHeading("10장 정도 되는 편지를 다 읽었다.")).toBeUndefined();
    expect(readChapterHeading("3장의 카드를 뒤집었다")).toBeUndefined();
    expect(readChapterHeading("第3章 归来")?.language).toBe("zh");
  });

  it("splits a Korean manuscript by its chapter headings", () => {
    const chapters = splitChapters("1화 시작\n첫 문단.\n\n2화 전환\n둘째 문단.\n10장 정도 되는 편지를 다 읽었다.");
    expect(chapters.map((chapter) => chapter.title)).toEqual(["시작", "전환"]);
    expect(chapters[1]?.content).toContain("10장 정도 되는 편지를");
  });

  it("renders Korean script and storyboard specs on the English layout, not the Chinese one", () => {
    const storyboard = renderStoryboardSpec({ title: "폐성당의 첫 보스", language: "ko", maxShots: 6 });
    const script = renderScriptSpec({ title: "폐성당의 첫 보스", language: "ko" });
    expect(storyboard).toContain("Storyboard Creation Spec");
    expect(script).toContain("Script Creation Spec");
    expect(`${storyboard}${script}`).not.toMatch(/[分镜剧本规格]/u);
  });

  it("renders Korean chapter documents with a 제N장 heading", () => {
    const document = renderChapterDocument(4, "새벽", "본문입니다.", "ko");
    expect(document.startsWith("# 제4장 새벽")).toBe(true);
    expect(chapterDocumentBody(document, 4, "새벽", "ko")).toBe("본문입니다.");
  });
});
