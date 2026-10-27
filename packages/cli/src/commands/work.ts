import { Command } from "commander";
import {
  CreativeEpisodeStore,
  listWorkManifests,
  loadWorkManifest,
  migrateLegacyWorks,
} from "@actalk/inkos-core";
import { join } from "node:path";
import { findProjectRoot, log, logError } from "../utils.js";
import { uiText } from "../ui-locale.js";

export const workCommand = new Command("work")
  .description(uiText("Inspect creative Works, artifacts, revisions, and Episodes", "창작 작품과 산출물, 리비전, 에피소드를 살펴봅니다"));

workCommand.command("migrate")
  .description(uiText("Preview or copy legacy projects into the Work library", "기존(레거시) 프로젝트를 작품 라이브러리로 옮길 내용을 미리 보거나 복사합니다"))
  .option("--apply", uiText("Apply the migration, retaining original directories", "원래 디렉터리는 남겨 두고 마이그레이션을 적용합니다"))
  .option("--source <path>", uiText("Migrate one legacy directory, for example books/my-book", "레거시 디렉터리 하나만 옮깁니다(예: books/my-book)"))
  .option("--json", uiText("Output JSON", "JSON으로 출력합니다"))
  .action(async (opts: { apply?: boolean; source?: string; json?: boolean }) => {
    try {
      const results = await migrateLegacyWorks(findProjectRoot(), opts);
      if (opts.json) log(JSON.stringify({ applied: opts.apply === true, results }, null, 2));
      else for (const item of results) log(uiText(
        `${item.source} | ${item.status} | ${item.fileCount ?? 0} files${item.error ? ` | ${item.error}` : ""}`,
        `${item.source} | ${item.status} | 파일 ${item.fileCount ?? 0}개${item.error ? ` | ${item.error}` : ""}`,
      ));
      if (results.some((item) => item.status === "invalid" || item.status === "conflict")) process.exitCode = 1;
    } catch (error) { logError(String(error)); process.exitCode = 1; }
  });

workCommand
  .command("list")
  .description(uiText("List every creative Work across all content types", "모든 콘텐츠 유형의 창작 작품을 나열합니다"))
  .option("--profile <profileId>", uiText("Filter by Work profile", "작품 프로필로 거릅니다"))
  .option("--json", uiText("Output JSON", "JSON으로 출력합니다"))
  .action(async (opts: { profile?: string; json?: boolean }) => {
    try {
      const root = findProjectRoot();
      const works = await listWorkManifests(root, opts.profile?.trim() || undefined);
      const output = works.map((work) => ({
        id: work.id,
        title: work.title,
        profileId: work.profileId,
        language: work.language,
        status: work.status,
        artifacts: work.artifacts.length,
        updatedAt: work.updatedAt,
      }));
      if (opts.json) {
        log(JSON.stringify({ works: output }, null, 2));
        return;
      }
      if (output.length === 0) {
        log(uiText("No creative Works found.", "창작 작품이 없습니다."));
        return;
      }
      for (const work of output) {
        log(uiText(
          `${work.id} | ${work.profileId} | ${work.title} | ${work.artifacts} artifacts | ${work.status}`,
          `${work.id} | ${work.profileId} | ${work.title} | 산출물 ${work.artifacts}개 | ${work.status}`,
        ));
      }
    } catch (error) {
      if (opts.json) log(JSON.stringify({ error: String(error) }));
      else logError(uiText(`Failed to list Works: ${error}`, `작품 목록을 불러오지 못했습니다: ${error}`));
      process.exitCode = 1;
    }
  });

workCommand
  .command("show")
  .description(uiText("Show one Work with artifact revisions and recent Episodes", "작품 하나의 산출물 리비전과 최근 에피소드를 보여 줍니다"))
  .argument("<work-id>", uiText("Work ID", "작품 ID"))
  .option("--json", uiText("Output JSON", "JSON으로 출력합니다"))
  .action(async (workId: string, opts: { json?: boolean }) => {
    let episodes: CreativeEpisodeStore | undefined;
    try {
      const root = findProjectRoot();
      const work = await loadWorkManifest(root, workId);
      episodes = new CreativeEpisodeStore(join(root, ".inkos", "harness.sqlite"));
      const recentEpisodes = episodes.listEpisodes({ workId, limit: 50 });
      if (opts.json) {
        log(JSON.stringify({ work, episodes: recentEpisodes }, null, 2));
        return;
      }
      log(`${work.title} (${work.id})`);
      log(uiText(
        `Profile: ${work.profileId} | Language: ${work.language} | Status: ${work.status}`,
        `프로필: ${work.profileId} | 언어: ${work.language} | 상태: ${work.status}`,
      ));
      log(uiText(
        `Artifacts: ${work.artifacts.length} | Episodes: ${recentEpisodes.length}`,
        `산출물: ${work.artifacts.length} | 에피소드: ${recentEpisodes.length}`,
      ));
      for (const artifact of work.artifacts) {
        const current = artifact.revisions.find((revision) => revision.id === artifact.currentRevisionId);
        log(uiText(
          `  ${artifact.kind} | ${current?.path ?? "(no accepted revision)"} | ${artifact.revisions.length} revision(s)`,
          `  ${artifact.kind} | ${current?.path ?? "(승인된 리비전 없음)"} | 리비전 ${artifact.revisions.length}개`,
        ));
      }
      for (const episode of recentEpisodes.slice(0, 10)) {
        log(uiText(
          `  episode ${episode.id} | ${episode.status} | ${episode.startedAt}`,
          `  에피소드 ${episode.id} | ${episode.status} | ${episode.startedAt}`,
        ));
      }
    } catch (error) {
      if (opts.json) log(JSON.stringify({ error: String(error) }));
      else logError(uiText(`Failed to inspect Work: ${error}`, `작품 정보를 불러오지 못했습니다: ${error}`));
      process.exitCode = 1;
    } finally {
      episodes?.close();
    }
  });
