import { Command } from "commander";
import { loadWorkManifest, PipelineRunner, runAgentSession } from "@actalk/inkos-core";
import { buildPipelineConfig, loadConfig, createClient, findProjectRoot, resolveBookId, resolveContext, log, logError } from "../utils.js";
import { uiText } from "../ui-locale.js";

export const agentCommand = new Command("agent")
  .description(uiText("Natural language agent mode (LLM orchestrates via tool-use)", "자연어 에이전트 모드(LLM이 도구를 호출해 작업을 조율합니다)"))
  .argument("<instruction>", uiText("Natural language instruction", "자연어 지시"))
  .option("--book <bookId>", uiText("Bind this request to an existing book", "이 요청을 기존 책에 연결합니다"))
  .option("--work <workId>", uiText("Bind this request to any existing creative Work", "이 요청을 기존 창작 작품에 연결합니다"))
  .option("--session <sessionId>", uiText("Reuse an agent session id", "기존 에이전트 세션 ID를 재사용합니다"))
  .option("--context <text>", uiText("Additional context (natural language)", "추가 맥락(자연어)"))
  .option("--context-file <path>", uiText("Read additional context from file", "파일에서 추가 맥락을 읽습니다"))
  .option("--json", uiText("Output JSON (suppress progress messages)", "JSON으로 출력합니다(진행 메시지 숨김)"))
  .option("--quiet", uiText("Suppress non-JSON console output", "JSON 이외의 콘솔 출력을 숨깁니다"))
  .action(async (instruction: string, opts) => {
    try {
      const config = await loadConfig();
      const client = createClient(config);
      const root = findProjectRoot();
      const context = await resolveContext(opts);

      const fullInstruction = context
        ? `${instruction}\n\n补充信息：${context}`
        : instruction;

      const bookId = opts.book ? await resolveBookId(opts.book, root) : null;
      if (opts.book && opts.work) throw new Error(uiText("Use either --book or --work, not both.", "--book과 --work 중 하나만 지정하세요."));
      const work = opts.work ? await loadWorkManifest(root, String(opts.work).trim()) : null;
      const trimmed = fullInstruction.trim();
      const actionSource = trimmed.startsWith("/") ? "slash" : "free-text";
      const requestedIntent = bookId && trimmed === "/write"
        ? "write_next"
        : !bookId && trimmed === "/create"
          ? "create_book"
          : undefined;
      const sessionKind = work
        ? "work"
        : bookId
        ? "book"
        : requestedIntent === "create_book"
          ? "book-create"
          : "chat";
      const sessionId = opts.session?.trim() || `cli-agent-${Date.now().toString(36)}`;
      const pipeline = new PipelineRunner(buildPipelineConfig(config, root, {
        externalContext: context,
        quiet: opts.quiet || opts.json,
      }));

      const result = await runAgentSession(
        {
          sessionId,
          bookId,
          sessionKind,
          ...(work ? { profileId: work.profileId, workId: work.id } : {}),
          actionSource,
          requestedIntent,
          language: config.language ?? "zh",
          pipeline,
          projectRoot: root,
          model: client._piModel
            ? client._piModel
            : { provider: config.llm.provider ?? "openai", modelId: config.llm.model },
          apiKey: client._apiKey,
          stream: client.stream,
          proxyUrl: client.proxyUrl,
        },
        fullInstruction,
      );

      const failure = result.errorMessage ?? (result.completion?.status === "blocked" ? result.completion.message : undefined);
      if (opts.json) {
        log(JSON.stringify({ result }));
      } else if (failure) {
        logError(failure);
      } else if (!opts.quiet && result.responseText.trim()) {
        log(result.responseText);
      }
      if (failure) process.exitCode = 1;
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(uiText(`Agent failed: ${e}`, `에이전트 실행에 실패했습니다: ${e}`));
      }
      process.exit(1);
    }
  });
