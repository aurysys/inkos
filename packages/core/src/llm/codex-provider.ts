import {
  createAssistantMessageEventStream,
  registerApiProvider,
  streamOpenAICodexResponses,
  streamSimpleOpenAICodexResponses,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
} from "@mariozechner/pi-ai";
import { resolveCodexAccessToken } from "./codex-auth.js";

/**
 * Re-registers pi-ai's "openai-codex-responses" API with Codex CLI auth:
 * - the bearer token comes from the Codex CLI login at call time (callers pass no API key);
 * - `temperature` is dropped because the ChatGPT Codex backend rejects it
 *   ("Unsupported parameter: temperature") while InkOS sends it on every call.
 * Importing this module is enough; it overrides pi-ai's built-in registration.
 */

type CodexStream<TOptions> = (
  model: Model<"openai-codex-responses">,
  context: Context,
  options?: TOptions,
) => AssistantMessageEventStream;

function codexErrorMessage(model: Model<"openai-codex-responses">, error: unknown): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "error",
    errorMessage: error instanceof Error ? error.message : String(error),
    timestamp: Date.now(),
  };
}

function withCodexCliAuth<TOptions extends { apiKey?: string; temperature?: number }>(
  inner: CodexStream<TOptions>,
): CodexStream<TOptions> {
  return (model, context, options) => {
    const output = createAssistantMessageEventStream();
    void (async () => {
      try {
        const apiKey = await resolveCodexAccessToken();
        const { temperature: _unsupported, ...rest } = (options ?? {}) as TOptions;
        const upstream = inner(model, context, { ...rest, apiKey } as TOptions);
        for await (const event of upstream) output.push(event);
        output.end();
      } catch (error) {
        output.push({ type: "error", reason: "error", error: codexErrorMessage(model, error) });
        output.end();
      }
    })();
    return output;
  };
}

registerApiProvider(
  {
    api: "openai-codex-responses",
    stream: withCodexCliAuth(streamOpenAICodexResponses),
    streamSimple: withCodexCliAuth(streamSimpleOpenAICodexResponses),
  },
  "inkos-codex-cli",
);
