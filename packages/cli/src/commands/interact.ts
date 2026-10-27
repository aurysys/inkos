import { Command } from "commander";
import {
  PipelineRunner,
  loadWorkManifest,
  runAgentSession,
} from "@actalk/inkos-core";
import { buildPipelineConfig, createClient, findProjectRoot, loadConfig } from "../utils.js";
import { uiText } from "../ui-locale.js";

export interface InteractCommandHooks {
  readonly readInput?: () => Promise<string>;
}

async function readInteractionInput(
  args: ReadonlyArray<string>,
  explicitMessage: string | undefined,
  readInput?: () => Promise<string>,
): Promise<string> {
  const explicit = explicitMessage?.trim();
  if (explicit) {
    return explicit;
  }

  const inline = args.join(" ").trim();
  if (inline) {
    return inline;
  }

  if (readInput) {
    const provided = (await readInput()).trim();
    if (provided) {
      return provided;
    }
  }

  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    const piped = Buffer.concat(chunks).toString("utf-8").trim();
    if (piped) {
      return piped;
    }
  }

  throw new Error(uiText(
    "Interaction message is required. Pass text arguments or pipe input via stdin.",
    "대화 메시지가 필요합니다. 텍스트 인수로 넘기거나 stdin으로 입력을 파이프하세요.",
  ));
}

export function createInteractCommand(hooks: InteractCommandHooks = {}): Command {
  return new Command("interact")
    .description(uiText("Run a natural-language agent interaction against the current project", "현재 프로젝트에서 자연어로 에이전트와 대화합니다"))
    .argument("[message...]", uiText("Natural-language message", "자연어 메시지"))
    .option("--message <text>", uiText("Explicit natural-language message", "명시적으로 전달할 자연어 메시지"))
    .option("--book <bookId>", uiText("Bind a specific active book for this interaction", "이 대화에 특정 책을 연결합니다"))
    .option("--work <workId>", uiText("Bind any existing creative Work for this interaction", "이 대화에 기존 창작 작품을 연결합니다"))
    .option("--session <sessionId>", uiText("Reuse an agent session id", "기존 에이전트 세션 ID를 재사용합니다"))
    .option("--json", uiText("Emit structured JSON for external agents", "외부 에이전트용 구조화된 JSON을 출력합니다"))
    .action(async (messageArgs: ReadonlyArray<string>, opts) => {
      const input = await readInteractionInput(messageArgs, opts.message, hooks.readInput);
      const projectRoot = findProjectRoot();
      const config = await loadConfig({ requireApiKey: false, projectRoot });
      const client = createClient(config);
      const bookId = typeof opts.book === "string" && opts.book.trim() ? opts.book.trim() : null;
      if (bookId && opts.work) throw new Error(uiText("Use either --book or --work, not both.", "--book과 --work 중 하나만 지정하세요."));
      const work = typeof opts.work === "string" && opts.work.trim()
        ? await loadWorkManifest(projectRoot, opts.work.trim())
        : null;
      const trimmed = input.trim();
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
      const sessionId = typeof opts.session === "string" && opts.session.trim()
        ? opts.session.trim()
        : `cli-interact-${Date.now().toString(36)}`;
      const pipeline = new PipelineRunner(buildPipelineConfig(config, projectRoot, {
        quiet: opts.json,
      }));

      const result = await runAgentSession({
        sessionId,
        bookId,
        sessionKind,
        ...(work ? { profileId: work.profileId, workId: work.id } : {}),
        actionSource,
        requestedIntent,
        language: config.language ?? "zh",
        pipeline,
        projectRoot,
        model: client._piModel
          ? client._piModel
          : { provider: config.llm.provider ?? "openai", modelId: config.llm.model },
        apiKey: client._apiKey,
        stream: client.stream,
        proxyUrl: client.proxyUrl,
      }, input);

      const failure = result.errorMessage ?? (result.completion?.status === "blocked" ? result.completion.message : undefined);
      const responseText = failure ?? result.responseText;
      if (failure) process.exitCode = 1;
      const session = {
        sessionId,
        sessionKind,
        profileId: result.profileId,
        workId: result.workId,
        activeBookId: bookId ?? undefined,
      };

      if (opts.json) {
        process.stdout.write(`${JSON.stringify({
          responseText,
          ...(failure ? { error: failure } : {}),
          session,
        }, null, 2)}\n`);
        return;
      }

      if (responseText) {
        process.stdout.write(`${responseText}\n`);
      }
    });
}
