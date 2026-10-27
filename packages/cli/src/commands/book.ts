import { Command } from "commander";
import { access, readFile, rm } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";
import {
  createBookFoundationTool,
  deriveBookIdFromTitle,
  executeExplicitCapabilityTool,
  PlatformSchema,
  PipelineRunner,
  StateManager,
  workDirectory,
  type BookConfig,
} from "@actalk/inkos-core";
import {
  formatBookBackupCreated,
  formatBookBackupListEmpty,
  formatBookCreateCreated,
  formatBookCreateCreating,
  formatBookCreateFoundationReady,
  formatBookCreateLocation,
  formatBookCreateNextStep,
  formatBookRestoreDone,
  resolveCliLanguage,
} from "../localization.js";
import { createBookBackup, listBookBackups, restoreBookBackup } from "../book-backup.js";
import { loadConfig, buildPipelineConfig, findProjectRoot, resolveBookId, log, logError, resolveCliProfileSkills } from "../utils.js";
import { uiText } from "../ui-locale.js";

export const bookCommand = new Command("book")
  .description(uiText("Manage books", "책을 관리합니다"));

bookCommand
  .command("create")
  .description(uiText("Create a new book with AI-generated foundation", "AI가 기본 설정을 생성해 새 책을 만듭니다"))
  .requiredOption("--title <title>", uiText("Book title", "책 제목"))
  .option("--genre <genre>", uiText("Genre", "장르"), "xuanhuan")
  .option("--platform <platform>", uiText("Target platform", "연재 플랫폼"), "tomato")
  .option("--target-chapters <n>", uiText("Target chapter count", "목표 챕터 수"), "200")
  .option("--chapter-words <n>", uiText("Words per chapter", "챕터당 글자 수"), "3000")
  .option("--brief <path>", uiText("Path to creative brief file (.md/.txt) — Architect builds from your ideas instead of generating from scratch", "창작 지시문 파일 경로(.md/.txt) — 처음부터 생성하지 않고 작성한 아이디어를 바탕으로 설계합니다"))
  .option("--lang <language>", uiText("Writing language: zh (Chinese) or en (English). Defaults from genre.", "집필 언어: zh(중국어) 또는 en(영어). 지정하지 않으면 장르에 맞춰 정합니다."))
  .option("--json", uiText("Output JSON", "JSON으로 출력합니다"))
  .action(async (opts) => {
    try {
      const root = findProjectRoot();

      const bookId = deriveBookIdFromTitle(opts.title) || `book-${Date.now().toString(36)}`;

      const workDir = workDirectory(root, bookId);
      const bookDir = join(workDir, "source");
      try {
        await access(bookDir);
        const state = new StateManager(root);
        if (await state.isCompleteBookDirectory(bookDir)) {
          throw new Error(uiText(
            `Book "${bookId}" already exists as a Work. Use a different title or delete the existing book first.`,
            `책 "${bookId}"이(가) 이미 작품으로 존재합니다. 다른 제목을 쓰거나 기존 책을 먼저 삭제하세요.`,
          ));
        }
        await rm(workDir, { recursive: true, force: true });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }

      const config = await loadConfig();
      const now = new Date().toISOString();
      const book: BookConfig = {
        id: bookId,
        title: opts.title,
        platform: PlatformSchema.parse(opts.platform ?? "other"),
        genre: opts.genre,
        status: "outlining",
        targetChapters: parseInt(opts.targetChapters, 10),
        chapterWordCount: parseInt(opts.chapterWords, 10),
        language: resolveCliLanguage(opts.lang ?? config.language),
        createdAt: now,
        updatedAt: now,
      };
      const language = resolveCliLanguage(book.language);

      if (!opts.json) log(formatBookCreateCreating(language, book.title, book.genre, book.platform));

      const brief = opts.brief
        ? await readFile(resolve(opts.brief), "utf-8")
        : undefined;

      const pipeline = new PipelineRunner(buildPipelineConfig(config, root, { externalContext: brief }));
      const activatedSkills = await resolveCliProfileSkills(root, "longform-novel");

      await executeExplicitCapabilityTool({
        projectRoot: root,
        binding: { capabilityId: "longform", actionId: "create_book", profileId: "longform-novel", risk: "recoverable-write" },
        tool: createBookFoundationTool(pipeline, {
          language: book.language,
          actionPayload: {
            createBook: {
              title: book.title,
              genre: book.genre,
              platform: book.platform,
              language: book.language,
              targetChapters: book.targetChapters,
              chapterWordCount: book.chapterWordCount,
            },
          },
          workerSkills: () => activatedSkills,
        }),
        parameters: {
          instruction: brief?.trim() || `Create ${book.title}`,
          title: book.title,
          genre: book.genre,
          platform: book.platform,
          language: book.language,
          targetChapters: book.targetChapters,
          chapterWordCount: book.chapterWordCount,
        },
      });

      if (opts.json) {
        log(JSON.stringify({
          bookId,
          title: book.title,
          genre: book.genre,
          platform: book.platform,
          location: `works/${bookId}/source/`,
          nextStep: `inkos write next ${bookId}`,
        }, null, 2));
      } else {
        log(formatBookCreateCreated(language, bookId));
        log(formatBookCreateLocation(language, bookId));
        log(formatBookCreateFoundationReady(language));
        log("");
        log(formatBookCreateNextStep(language, bookId));
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(uiText(`Failed to create book: ${e}`, `책을 만들지 못했습니다: ${e}`));
      }
      process.exit(1);
    }
  });

bookCommand
  .command("update")
  .description(uiText("Update book settings", "책 설정을 변경합니다"))
  .argument("[book-id]", uiText("Book ID (auto-detected if only one book)", "책 ID(책이 하나뿐이면 자동으로 찾습니다)"))
  .option("--chapter-words <n>", uiText("Words per chapter", "챕터당 글자 수"))
  .option("--target-chapters <n>", uiText("Target chapter count", "목표 챕터 수"))
  .option("--status <status>", uiText("Book status (outlining/active/paused/completed)", "책 상태(outlining/active/paused/completed)"))
  .option("--lang <language>", uiText("Writing language: zh or en", "집필 언어: zh 또는 en"))
  .option("--json", uiText("Output JSON", "JSON으로 출력합니다"))
  .action(async (bookIdArg: string | undefined, opts) => {
    try {
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const state = new StateManager(root);
      const book = await state.loadBookConfig(bookId);

      const updates: Record<string, unknown> = {};
      if (opts.chapterWords) updates.chapterWordCount = parseInt(opts.chapterWords, 10);
      if (opts.targetChapters) updates.targetChapters = parseInt(opts.targetChapters, 10);
      if (opts.status) updates.status = opts.status;
      if (opts.lang) updates.language = opts.lang;

      if (Object.keys(updates).length === 0) {
        if (opts.json) {
          log(JSON.stringify(book, null, 2));
        } else {
          log(uiText(`Book: ${book.title} (${bookId})`, `책: ${book.title} (${bookId})`));
          log(uiText(`  Words/chapter: ${book.chapterWordCount}`, `  챕터당 글자 수: ${book.chapterWordCount}`));
          log(uiText(`  Target chapters: ${book.targetChapters}`, `  목표 챕터 수: ${book.targetChapters}`));
          log(uiText(`  Status: ${book.status}`, `  상태: ${book.status}`));
          log(uiText(`  Genre: ${book.genre} | Platform: ${book.platform}`, `  장르: ${book.genre} | 플랫폼: ${book.platform}`));
        }
        return;
      }

      const updated: BookConfig = {
        ...book,
        ...updates,
        updatedAt: new Date().toISOString(),
      };
      await state.saveBookConfig(bookId, updated);

      if (opts.json) {
        log(JSON.stringify(updated, null, 2));
      } else {
        for (const [key, value] of Object.entries(updates)) {
          log(`  ${key}: ${(book as Record<string, unknown>)[key]} → ${value}`);
        }
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(uiText(`Failed to update book: ${e}`, `책 설정을 변경하지 못했습니다: ${e}`));
      }
      process.exit(1);
    }
  });

bookCommand
  .command("list")
  .description(uiText("List all books", "모든 책을 나열합니다"))
  .option("--json", uiText("Output JSON", "JSON으로 출력합니다"))
  .action(async (opts) => {
    try {
      const root = findProjectRoot();
      const state = new StateManager(root);
      const bookIds = await state.listBooks();

      if (bookIds.length === 0) {
        if (opts.json) {
          log(JSON.stringify({ books: [] }));
        } else {
          log(uiText("No books found. Create one with: inkos book create --title '...'", "책이 없습니다. 다음 명령으로 만드세요: inkos book create --title '...'"));
        }
        return;
      }

      const books = [];
      for (const id of bookIds) {
        const book = await state.loadBookConfig(id);
        const nextChapter = await state.getNextChapterNumber(id);
        const info = {
          id,
          title: book.title,
          genre: book.genre,
          platform: book.platform,
          status: book.status,
          chapters: nextChapter - 1,
        };
        books.push(info);
        if (!opts.json) {
          log(uiText(
            `  ${id} | ${book.title} | ${book.genre}/${book.platform} | ${book.status} | chapters: ${nextChapter - 1}`,
            `  ${id} | ${book.title} | ${book.genre}/${book.platform} | ${book.status} | 챕터: ${nextChapter - 1}`,
          ));
        }
      }

      if (opts.json) {
        log(JSON.stringify({ books }, null, 2));
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(uiText(`Failed to list books: ${e}`, `책 목록을 불러오지 못했습니다: ${e}`));
      }
      process.exit(1);
    }
  });

bookCommand
  .command("delete")
  .description(uiText("Delete a book and all its chapters, truth files, and snapshots", "책과 모든 챕터, 설정 파일, 스냅숏을 삭제합니다"))
  .argument("<book-id>", uiText("Book ID to delete", "삭제할 책 ID"))
  .option("--force", uiText("Skip confirmation prompt", "확인 질문을 건너뜁니다"))
  .option("--json", uiText("Output JSON", "JSON으로 출력합니다"))
  .action(async (bookId: string, opts) => {
    try {
      const root = findProjectRoot();
      const state = new StateManager(root);

      const allBooks = await state.listBooks();
      if (!allBooks.includes(bookId)) {
        throw new Error(uiText(
          `Book "${bookId}" not found. Available: ${allBooks.join(", ") || "(none)"}`,
          `책 "${bookId}"을(를) 찾을 수 없습니다. 사용 가능한 책: ${allBooks.join(", ") || "(없음)"}`,
        ));
      }

      const book = await state.loadBookConfig(bookId);
      const index = await state.loadChapterIndex(bookId);

      if (!opts.force) {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>((resolve) => {
          rl.question(
            uiText(
              `Delete "${book.title}" (${bookId})? This will remove ${index.length} chapter(s) and all data. (y/N) `,
              `"${book.title}" (${bookId})을(를) 삭제할까요? 챕터 ${index.length}개와 모든 데이터가 제거됩니다. (y/N) `,
            ),
            resolve,
          );
        });
        rl.close();
        if (answer.toLowerCase() !== "y") {
          log(uiText("Cancelled.", "취소했습니다."));
          return;
        }
      }

      await rm(workDirectory(root, bookId), { recursive: true, force: true });

      if (opts.json) {
        log(JSON.stringify({ deleted: bookId, chapters: index.length }));
      } else {
        log(uiText(
          `Deleted "${book.title}" (${bookId}): ${index.length} chapter(s) removed.`,
          `"${book.title}" (${bookId})을(를) 삭제했습니다: 챕터 ${index.length}개를 제거했습니다.`,
        ));
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(uiText(`Failed to delete book: ${e}`, `책을 삭제하지 못했습니다: ${e}`));
      }
      process.exit(1);
    }
  });

bookCommand
  .command("backup")
  .description(uiText("Snapshot the whole book directory into .inkos/backups/<book-id>/ (or list backups with --list)", "책 디렉터리 전체를 .inkos/backups/<book-id>/에 스냅숏으로 저장합니다(--list로 백업 목록 보기)"))
  .argument("<book-id>", uiText("Book ID", "책 ID"))
  .option("--list", uiText("List existing backups instead of creating one", "백업을 만들지 않고 기존 백업 목록을 보여 줍니다"))
  .option("--json", uiText("Output JSON", "JSON으로 출력합니다"))
  .action(async (bookId: string, opts) => {
    try {
      const root = findProjectRoot();
      // Backups must also work on broken books (e.g. corrupted book.json),
      // so the output language follows the environment, not the book config.
      const language = resolveCliLanguage();

      if (opts.list) {
        const backups = await listBookBackups(root, bookId);
        if (opts.json) {
          log(JSON.stringify({ bookId, backups }, null, 2));
        } else if (backups.length === 0) {
          log(formatBookBackupListEmpty(language, bookId));
        } else {
          for (const backup of backups) {
            log(`  ${backup.id}  ${backup.createdAt}`);
          }
        }
        return;
      }

      const result = await createBookBackup(root, bookId);
      if (opts.json) {
        log(JSON.stringify({ bookId, backupId: result.backupId }, null, 2));
      } else {
        log(formatBookBackupCreated(language, bookId, result.backupId));
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(uiText(`Failed to back up book: ${e}`, `책을 백업하지 못했습니다: ${e}`));
      }
      process.exit(1);
    }
  });

bookCommand
  .command("restore")
  .description(uiText("Restore a whole-book backup (the current book state is automatically backed up first)", "책 전체 백업을 복원합니다(현재 상태를 먼저 자동으로 백업합니다)"))
  .argument("<book-id>", uiText("Book ID", "책 ID"))
  .argument("<backup-id>", uiText("Backup ID, see `inkos book backup <book-id> --list`", "백업 ID(`inkos book backup <book-id> --list`로 확인)"))
  .option("--json", uiText("Output JSON", "JSON으로 출력합니다"))
  .action(async (bookId: string, backupId: string, opts) => {
    try {
      const root = findProjectRoot();
      const language = resolveCliLanguage();

      const result = await restoreBookBackup(root, bookId, backupId);

      if (opts.json) {
        log(JSON.stringify(result, null, 2));
      } else {
        log(formatBookRestoreDone(language, {
          bookId,
          backupId: result.restoredFrom,
          preRestoreBackupId: result.preRestoreBackupId,
        }));
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(uiText(`Failed to restore book: ${e}`, `책을 복원하지 못했습니다: ${e}`));
      }
      process.exit(1);
    }
  });
