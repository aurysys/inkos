import { DEFAULT_CHAPTER_LENGTH_KO, formatLengthCount, isWritingLanguage, resolveLengthCountingMode, type LengthCountingMode, type Observation, type WritingLanguage } from "@actalk/inkos-core";
import { isKoreanUi, uiText } from "./ui-locale.js";

export type CliLanguage = "zh" | "en";

type WriteResultShape = {
  readonly chapterNumber: number;
  readonly title: string;
  readonly wordCount: number;
  readonly observations: ReadonlyArray<Observation>;
  /** The book's length unit; defaults to the CLI language's unit. */
  readonly countingMode?: LengthCountingMode;
};

type ImportResultShape = {
  readonly importedCount: number;
  readonly totalWords: number;
  readonly nextChapter: number;
  readonly continueBookId: string;
  /** The book's length unit; defaults to the CLI language's unit. */
  readonly countingMode?: LengthCountingMode;
};

function localize(language: CliLanguage, messages: { zh: string; en: string; ko?: string }): string {
  if (isKoreanUi()) return messages.ko ?? messages.en;
  return language === "en" ? messages.en : messages.zh;
}

function normalizeCliLanguageTag(value: string | undefined): CliLanguage | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("en")) {
    return "en";
  }
  if (normalized.startsWith("zh")) {
    return "zh";
  }
  return undefined;
}

/**
 * Book writing language from --lang or the project default. Unlike the CLI
 * display language (zh/en), ko is a valid writing language.
 */
export function resolveWritingLanguageOption(value: string | undefined, fallback: string | undefined): WritingLanguage {
  const requested = value?.trim().toLowerCase();
  if (requested) {
    if (isWritingLanguage(requested)) return requested;
    throw new Error(uiText(
      `Unsupported writing language "${value}". Use zh, en or ko.`,
      `지원하지 않는 집필 언어입니다: "${value}". zh, en, ko 중 하나를 쓰세요.`,
    ));
  }
  return isWritingLanguage(fallback) ? fallback : resolveCliLanguage(fallback);
}

/** --chapter-words when given; otherwise the historical CLI default, or 5000 for Korean (spaces included). */
export function resolveChapterLengthOption(value: string | undefined, language: WritingLanguage): number {
  if (value !== undefined) return parseInt(value, 10);
  return language === "ko" ? DEFAULT_CHAPTER_LENGTH_KO : 3000;
}

export function resolveCliLanguage(
  language?: string,
  env: NodeJS.ProcessEnv = process.env,
): CliLanguage {
  const explicit = normalizeCliLanguageTag(language);
  if (explicit) {
    return explicit;
  }

  const requested = normalizeCliLanguageTag(env.INKOS_LOCALE);
  if (requested) {
    return requested;
  }

  const detected = normalizeCliLanguageTag(env.LC_ALL ?? env.LC_MESSAGES ?? env.LANG);
  return detected ?? "zh";
}

export function formatBookCreateCreating(
  language: CliLanguage,
  title: string,
  genre: string,
  platform: string,
): string {
  return localize(language, {
    zh: `创建书籍 "${title}"（${genre} / ${platform}）...`,
    en: `Creating book "${title}" (${genre} / ${platform})...`,
    ko: `책 "${title}" 생성 중(${genre} / ${platform})...`,
  });
}

export function formatBookCreateCreated(language: CliLanguage, bookId: string): string {
  return localize(language, {
    zh: `已创建书籍：${bookId}`,
    en: `Book created: ${bookId}`,
    ko: `책을 생성했습니다: ${bookId}`,
  });
}

export function formatBookCreateLocation(language: CliLanguage, bookId: string): string {
  return localize(language, {
    zh: `  位置：works/${bookId}/source/`,
    en: `  Location: works/${bookId}/source/`,
    ko: `  위치: works/${bookId}/source/`,
  });
}

export function formatBookCreateFoundationReady(language: CliLanguage): string {
  return localize(language, {
    zh: "  故事圣经、大纲和书籍规则已生成。",
    en: "  Story bible, outline, book rules generated.",
    ko: "  스토리 바이블, 개요, 책 규칙을 생성했습니다.",
  });
}

export function formatBookCreateNextStep(language: CliLanguage, bookId: string): string {
  return localize(language, {
    zh: `下一步：inkos write next ${bookId}`,
    en: `Next: inkos write next ${bookId}`,
    ko: `다음 단계: inkos write next ${bookId}`,
  });
}

export function formatWriteNextProgress(
  language: CliLanguage,
  current: number,
  total: number,
  bookId: string,
): string {
  return localize(language, {
    zh: `[${current}/${total}] 为「${bookId}」撰写章节...`,
    en: `[${current}/${total}] Writing chapter for "${bookId}"...`,
    ko: `[${current}/${total}] "${bookId}" 챕터 작성 중...`,
  });
}

export function formatWriteNextResultLines(
  language: CliLanguage,
  result: WriteResultShape,
): string[] {
  const lengthLabel = formatLengthCount(result.wordCount, result.countingMode ?? resolveLengthCountingMode(language));
  const lines = [
    localize(language, {
      zh: `  第${result.chapterNumber}章：${result.title}`,
      en: `  Chapter ${result.chapterNumber}: ${result.title}`,
      ko: `  ${result.chapterNumber}장: ${result.title}`,
    }),
    localize(language, {
      zh: `  字数：${lengthLabel}`,
      en: `  Length: ${lengthLabel}`,
      ko: `  글자 수: ${lengthLabel}`,
    }),
    localize(language, {
      zh: `  审查观察：${result.observations.length}`,
      en: `  Review observations: ${result.observations.length}`,
      ko: `  검토 의견: ${result.observations.length}`,
    }),
  ];

  if (result.observations.length > 0) {
    lines.push(localize(language, {
      zh: "  问题：",
      en: "  Issues:",
      ko: "  문제:",
    }));
    for (const observation of result.observations) {
      lines.push(`    ${observation.code}: ${observation.summary}`);
    }
  }

  return lines;
}

export function formatWriteNextComplete(language: CliLanguage): string {
  return localize(language, {
    zh: "完成。",
    en: "Done.",
    ko: "완료했습니다.",
  });
}

export function formatAutoWriteStart(
  language: CliLanguage,
  bookId: string,
  startChapter: number,
  targetChapter: number,
): string {
  return localize(language, {
    zh: `自动写作「${bookId}」：从第${startChapter}章连续写到第${targetChapter}章...`,
    en: `Auto-writing "${bookId}": chapter ${startChapter} through chapter ${targetChapter}...`,
    ko: `"${bookId}" 자동 연속 집필: ${startChapter}장부터 ${targetChapter}장까지 작성 중...`,
  });
}

export function formatAutoWriteAlreadyComplete(
  language: CliLanguage,
  bookId: string,
  writtenChapters: number,
  targetChapter: number,
): string {
  return localize(language, {
    zh: `「${bookId}」已写到第${writtenChapters}章（目标第${targetChapter}章），无需继续。`,
    en: `"${bookId}" already has ${writtenChapters} chapter(s) written (target: chapter ${targetChapter}). Nothing to do.`,
    ko: `"${bookId}"은(는) 이미 ${writtenChapters}장까지 작성되어 있습니다(목표: ${targetChapter}장). 더 진행할 작업이 없습니다.`,
  });
}

export type NotifyCommandAction = "write-next" | "write-rewrite" | "revise" | "audit" | "auto";

const NOTIFY_ACTION_LABELS: Record<NotifyCommandAction, { zh: string; en: string; ko: string }> = {
  "write-next": { zh: "写作", en: "Write", ko: "집필" },
  "write-rewrite": { zh: "重写", en: "Rewrite", ko: "다시 쓰기" },
  revise: { zh: "修订", en: "Revise", ko: "수정" },
  audit: { zh: "审计", en: "Audit", ko: "검토" },
  auto: { zh: "自动连写", en: "Auto-write", ko: "자동 연속 집필" },
};

export function formatNotifyCommandTitle(
  language: CliLanguage,
  action: NotifyCommandAction,
  bookName: string | undefined,
  succeeded: boolean,
): string {
  const label = localize(language, NOTIFY_ACTION_LABELS[action]);
  const book = bookName === undefined
    ? ""
    : localize(language, { zh: `《${bookName}》`, en: `: ${bookName}`, ko: `: ${bookName}` });
  return succeeded
    ? localize(language, { zh: `✅ ${label}完成${book}`, en: `✅ ${label} complete${book}`, ko: `✅ ${label} 완료${book}` })
    : localize(language, { zh: `❌ ${label}失败${book}`, en: `❌ ${label} failed${book}`, ko: `❌ ${label} 실패${book}` });
}

export function formatNotifyBatchWriteBody(
  language: CliLanguage,
  chapters: ReadonlyArray<{
    readonly chapterNumber: number;
    readonly title: string;
    readonly wordCount: number;
    readonly observationCount: number;
    readonly countingMode?: LengthCountingMode;
  }>,
): string {
  const first = chapters[0]!;
  const last = chapters[chapters.length - 1]!;
  const lines = [
    localize(language, {
      zh: `本次完成 ${chapters.length} 章（第${first.chapterNumber}章到第${last.chapterNumber}章）`,
      en: `${chapters.length} chapter(s) written (chapter ${first.chapterNumber} to ${last.chapterNumber})`,
      ko: `이번에 ${chapters.length}개 챕터를 작성했습니다(${first.chapterNumber}장~${last.chapterNumber}장)`,
    }),
    ...chapters.map((ch) => {
      const lengthLabel = formatLengthCount(ch.wordCount, ch.countingMode ?? resolveLengthCountingMode(language));
      return localize(language, {
        zh: `第${ch.chapterNumber}章 ${ch.title} | ${lengthLabel} | ${ch.observationCount} 条观察`,
        en: `Chapter ${ch.chapterNumber} ${ch.title} | ${lengthLabel} | ${ch.observationCount} observation(s)`,
        ko: `${ch.chapterNumber}장 ${ch.title} | ${lengthLabel} | 검토 의견 ${ch.observationCount}건`,
      });
    }),
  ];
  return lines.join("\n");
}

export function formatNotifyAuditBody(
  language: CliLanguage,
  result: {
    readonly chapterNumber: number;
    readonly issueCount: number;
    readonly summary: string;
  },
): string {
  const head = localize(language, {
    zh: `第${result.chapterNumber}章审查完成（${result.issueCount} 条观察）`,
    en: `Chapter ${result.chapterNumber} review completed (${result.issueCount} observation(s))`,
    ko: `${result.chapterNumber}장 검토 완료(검토 의견 ${result.issueCount}건)`,
  });
  return result.summary ? `${head}\n${result.summary}` : head;
}

export function formatNotifyReviseBody(
  language: CliLanguage,
  result: {
    readonly chapterNumber: number;
    readonly changed: boolean;
    readonly wordCount: number;
    readonly observationCount: number;
    readonly countingMode?: LengthCountingMode;
  },
): string {
  if (!result.changed) {
    return localize(language, {
      zh: `第${result.chapterNumber}章没有可执行修改`,
      en: `Chapter ${result.chapterNumber} had no actionable change`,
      ko: `${result.chapterNumber}장에 적용할 수정 사항이 없습니다`,
    });
  }
  const lengthLabel = formatLengthCount(result.wordCount, result.countingMode ?? resolveLengthCountingMode(language));
  return localize(language, {
    zh: `第${result.chapterNumber}章已修订 | ${lengthLabel} | 复审观察 ${result.observationCount} 条`,
    en: `Chapter ${result.chapterNumber} revised | ${lengthLabel} | ${result.observationCount} review observation(s)`,
    ko: `${result.chapterNumber}장 수정 완료 | ${lengthLabel} | 재검토 의견 ${result.observationCount}건`,
  });
}

export function formatNotifyFailureBody(language: CliLanguage, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return localize(language, {
    zh: `错误：${detail}`,
    en: `Error: ${detail}`,
    ko: `오류: ${detail}`,
  });
}

export function formatImportChaptersDiscovery(
  language: CliLanguage,
  chapterCount: number,
  bookId: string,
): string {
  return localize(language, {
    zh: `发现 ${chapterCount} 章，准备导入到「${bookId}」。`,
    en: `Found ${chapterCount} chapters to import into "${bookId}".`,
    ko: `챕터 ${chapterCount}개를 찾았습니다. "${bookId}"(으)로 가져옵니다.`,
  });
}

export function formatImportChaptersResume(
  language: CliLanguage,
  resumeFrom: number,
): string {
  return localize(language, {
    zh: `从第 ${resumeFrom} 章继续导入。`,
    en: `Resuming from chapter ${resumeFrom}.`,
    ko: `${resumeFrom}장부터 이어서 가져옵니다.`,
  });
}

export function formatImportChaptersComplete(
  language: CliLanguage,
  result: ImportResultShape,
): string[] {
  const lengthLabel = formatLengthCount(result.totalWords, result.countingMode ?? resolveLengthCountingMode(language));
  return [
    localize(language, {
      zh: "导入完成：",
      en: "Import complete:",
      ko: "가져오기 완료:",
    }),
    localize(language, {
      zh: `  已导入章节：${result.importedCount}`,
      en: `  Chapters imported: ${result.importedCount}`,
      ko: `  가져온 챕터: ${result.importedCount}`,
    }),
    localize(language, {
      zh: `  总长度：${lengthLabel}`,
      en: `  Total length: ${lengthLabel}`,
      ko: `  총 글자 수: ${lengthLabel}`,
    }),
    localize(language, {
      zh: `  下一章编号：${result.nextChapter}`,
      en: `  Next chapter number: ${result.nextChapter}`,
      ko: `  다음 챕터 번호: ${result.nextChapter}`,
    }),
    "",
    localize(language, {
      zh: `运行 "inkos write next ${result.continueBookId}" 继续写作。`,
      en: `Run "inkos write next ${result.continueBookId}" to continue writing.`,
      ko: `"inkos write next ${result.continueBookId}"을(를) 실행해 이어서 작성하세요.`,
    }),
  ];
}

export function formatImportCanonStart(
  language: CliLanguage,
  parentBookId: string,
  targetBookId: string,
): string {
  return localize(language, {
    zh: `把 "${parentBookId}" 的正典导入到 "${targetBookId}"...`,
    en: `Importing canon from "${parentBookId}" into "${targetBookId}"...`,
    ko: `"${parentBookId}"의 원작 설정을 "${targetBookId}"(으)로 가져오는 중...`,
  });
}

export function formatImportCanonComplete(language: CliLanguage): string[] {
  return [
    localize(language, {
      zh: "正典已导入：story/parent_canon.md",
      en: "Canon imported: story/parent_canon.md",
      ko: "원작 설정을 가져왔습니다: story/parent_canon.md",
    }),
    localize(language, {
      zh: "Writer 和 auditor 会在番外模式下自动识别这个文件。",
      en: "Writer and auditor will auto-detect this file for spinoff mode.",
      ko: "외전 모드에서 작성 에이전트와 검토 에이전트가 이 파일을 자동으로 인식합니다.",
    }),
  ];
}

export function formatListModelsEmpty(language: CliLanguage, service: string): string {
  return localize(language, {
    zh: `${service} 没有可用模型（可能需要 --api-key 和 --base-url）`,
    en: `No models available for ${service} (you may need --api-key and --base-url)`,
    ko: `${service}에서 사용할 수 있는 모델이 없습니다(--api-key와 --base-url이 필요할 수 있습니다)`,
  });
}

export function formatListModelsHeader(
  language: CliLanguage,
  service: string,
  count: number,
): string {
  return localize(language, {
    zh: `${service}：${count} 个模型`,
    en: `${service}: ${count} model(s)`,
    ko: `${service}: 모델 ${count}개`,
  });
}

export function formatDoctorHintQuota(language: CliLanguage): string {
  return localize(language, {
    zh: "检查 API Key 是否正确、模型是否可用，以及账号余额或配额是否足够。",
    en: "Check that the API key is valid, the model is available, and the account has enough balance or quota.",
    ko: "API 키가 올바른지, 모델을 사용할 수 있는지, 계정 잔액이나 할당량이 충분한지 확인하세요.",
  });
}

export function formatDoctorHintOpenAiProbeExhausted(language: CliLanguage): string {
  return localize(language, {
    zh: "当前已自动尝试 chat/responses 与流式开关组合；如果仍失败，问题更可能在模型名、baseUrl 路径或服务商兼容性本身。",
    en: "All chat/responses and stream on/off combinations were already probed; if it still fails, the problem is more likely the model name, the baseUrl path, or provider compatibility itself.",
    ko: "chat/responses와 스트리밍 켜기/끄기 조합을 이미 모두 자동으로 시도했습니다. 그래도 실패한다면 모델명, baseUrl 경로 또는 서비스 호환성 자체의 문제일 가능성이 큽니다.",
  });
}

export function formatDoctorHintBaseUrl(language: CliLanguage): string {
  return localize(language, {
    zh: "baseUrl 可能不正确，检查 INKOS_LLM_BASE_URL 是否包含完整路径（如 /v1）",
    en: "The baseUrl may be wrong. Check that INKOS_LLM_BASE_URL includes the full path (e.g. /v1).",
    ko: "baseUrl이 잘못되었을 수 있습니다. INKOS_LLM_BASE_URL에 전체 경로(예: /v1)가 포함되어 있는지 확인하세요.",
  });
}

export function formatDoctorHintStreamRequirement(language: CliLanguage): string {
  return localize(language, {
    zh: "检查提供方文档，确认该接口要求 stream=true、stream=false，还是根本不支持 stream",
    en: "Check the provider docs to confirm whether the endpoint requires stream=true, stream=false, or does not support streaming at all.",
    ko: "서비스 문서에서 해당 엔드포인트가 stream=true와 stream=false 중 무엇을 요구하는지, 아니면 스트리밍을 아예 지원하지 않는지 확인하세요.",
  });
}

export function formatDoctorHintModelName(language: CliLanguage): string {
  return localize(language, {
    zh: "检查模型名称是否正确（INKOS_LLM_MODEL）",
    en: "Check that the model name is correct (INKOS_LLM_MODEL).",
    ko: "모델명이 올바른지 확인하세요(INKOS_LLM_MODEL).",
  });
}

export function formatDoctorHintInvalidApiKey(language: CliLanguage): string {
  return localize(language, {
    zh: "API Key 无效，检查 INKOS_LLM_API_KEY",
    en: "The API key is invalid. Check INKOS_LLM_API_KEY.",
    ko: "API 키가 올바르지 않습니다. INKOS_LLM_API_KEY를 확인하세요.",
  });
}

// Fanfic errors are intentionally bilingual in a single string: they can surface
// through `--json` output or be rethrown before any book language is known.
export function formatFanficCanonMissingError(): string {
  return "No fanfic canon found for this book. Create one with `inkos fanfic init`（该书没有同人正典文件，用 inkos fanfic init 创建同人书）";
}

export function formatFanficSourceDirEmptyError(sourcePath: string): string {
  return `No .txt or .md files found in ${sourcePath}（目录 ${sourcePath} 中没有 .txt 或 .md 文件）`;
}

export function formatChapterSyncNoChanges(language: CliLanguage, checked: number): string {
  return localize(language, {
    zh: `已核对 ${checked} 章，index.json 字数无需修正。`,
    en: `Checked ${checked} chapter(s); index.json word counts already match the files.`,
    ko: `챕터 ${checked}개를 확인했습니다. index.json의 글자 수가 이미 파일과 일치합니다.`,
  });
}

export function formatChapterSyncChange(
  language: CliLanguage,
  change: { number: number; title: string; previousWordCount: number; wordCount: number },
  countingMode: "zh_chars" | "en_words" | "ko_chars",
): string {
  const from = formatLengthCount(change.previousWordCount, countingMode);
  const to = formatLengthCount(change.wordCount, countingMode);
  return localize(language, {
    zh: `  第${change.number}章 ${change.title}：${from} → ${to}`,
    en: `  Chapter ${change.number} ${change.title}: ${from} → ${to}`,
    ko: `  ${change.number}장 ${change.title}: ${from} → ${to}`,
  });
}

export function formatChapterSyncSummary(language: CliLanguage, changed: number, checked: number): string {
  return localize(language, {
    zh: `已核对 ${checked} 章，修正了 ${changed} 章的 index.json 字数。`,
    en: `Checked ${checked} chapter(s); corrected ${changed} index.json word count(s).`,
    ko: `챕터 ${checked}개를 확인하고 index.json의 글자 수 ${changed}건을 수정했습니다.`,
  });
}

export function formatChapterSyncMissingFiles(language: CliLanguage, numbers: ReadonlyArray<number>): string {
  return localize(language, {
    zh: `警告：index.json 中的第 ${numbers.join("、")} 章找不到对应的章节文件，已跳过。`,
    en: `Warning: chapter(s) ${numbers.join(", ")} exist in index.json but have no chapter file on disk; skipped.`,
    ko: `경고: index.json의 ${numbers.join(", ")}장에 해당하는 챕터 파일이 없어 건너뛰었습니다.`,
  });
}

export function formatChapterDeleteConfirm(
  language: CliLanguage,
  params: { bookTitle: string; bookId: string; number: number; title: string },
): string {
  return localize(language, {
    zh: `将删除《${params.bookTitle}》(${params.bookId}) 的最新章：第${params.number}章 ${params.title}。`
      + `章节文件会移入 chapters/.trash/，索引和故事状态回滚到第${params.number - 1}章。确认删除？(y/N) `,
    en: `Delete the latest chapter of "${params.bookTitle}" (${params.bookId}): chapter ${params.number} ${params.title}? `
      + `The chapter file moves to chapters/.trash/ and the index and story state roll back to chapter ${params.number - 1}. (y/N) `,
    ko: `"${params.bookTitle}"(${params.bookId})의 최신 챕터 ${params.number}장 ${params.title}을(를) 삭제합니다. `
      + `챕터 파일은 chapters/.trash/로 옮겨지고, 인덱스와 스토리 상태는 ${params.number - 1}장으로 되돌아갑니다. 삭제하시겠습니까? (y/N) `,
  });
}

export function formatChapterDeleteCancelled(language: CliLanguage): string {
  return localize(language, {
    zh: "已取消。",
    en: "Cancelled.",
    ko: "취소했습니다.",
  });
}

export function formatChapterDeleteDone(
  language: CliLanguage,
  params: { number: number; title: string; trashedFiles: ReadonlyArray<string>; rolledBackTo: number },
): string {
  const trashNote = params.trashedFiles.length > 0
    ? params.trashedFiles.join(", ")
    : localize(language, { zh: "（章节文件已不存在，未移动）", en: "(chapter file was already gone; nothing moved)", ko: "(챕터 파일이 이미 없어 옮기지 않았습니다)" });
  return localize(language, {
    zh: `已删除第${params.number}章 ${params.title}：章节文件保留在 ${trashNote}，索引和故事状态已回滚到第${params.rolledBackTo}章。`,
    en: `Deleted chapter ${params.number} ${params.title}: chapter file kept at ${trashNote}; index and story state rolled back to chapter ${params.rolledBackTo}.`,
    ko: `${params.number}장 ${params.title}을(를) 삭제했습니다. 챕터 파일은 ${trashNote}에 보관되며, 인덱스와 스토리 상태는 ${params.rolledBackTo}장으로 되돌렸습니다.`,
  });
}

export function formatBookBackupCreated(language: CliLanguage, bookId: string, backupId: string): string {
  return localize(language, {
    zh: `已备份 ${bookId} → .inkos/backups/${bookId}/${backupId}/`,
    en: `Backed up ${bookId} → .inkos/backups/${bookId}/${backupId}/`,
    ko: `${bookId} 백업 완료 → .inkos/backups/${bookId}/${backupId}/`,
  });
}

export function formatBookBackupListEmpty(language: CliLanguage, bookId: string): string {
  return localize(language, {
    zh: `${bookId} 还没有备份。用 inkos book backup ${bookId} 创建一份。`,
    en: `No backups for ${bookId} yet. Create one with: inkos book backup ${bookId}`,
    ko: `${bookId}에 아직 백업이 없습니다. 다음 명령으로 만드세요: inkos book backup ${bookId}`,
  });
}

export function formatBookRestoreDone(
  language: CliLanguage,
  params: { bookId: string; backupId: string; preRestoreBackupId: string | null },
): string {
  const preNote = params.preRestoreBackupId
    ? localize(language, {
        zh: `恢复前的状态已自动备份为 ${params.preRestoreBackupId}。`,
        en: `The pre-restore state was automatically backed up as ${params.preRestoreBackupId}.`,
        ko: `복원 전 상태를 ${params.preRestoreBackupId}(으)로 자동 백업했습니다.`,
      })
    : localize(language, {
        zh: "书目录当时不存在，未创建恢复前备份。",
        en: "The book directory did not exist, so no pre-restore backup was created.",
        ko: "책 디렉터리가 없어 복원 전 백업을 만들지 않았습니다.",
      });
  return localize(language, {
    zh: `已把 ${params.bookId} 恢复到备份 ${params.backupId}。${preNote}`,
    en: `Restored ${params.bookId} to backup ${params.backupId}. ${preNote}`,
    ko: `${params.bookId}을(를) 백업 ${params.backupId}(으)로 복원했습니다. ${preNote}`,
  });
}
