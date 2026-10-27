import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { uiText } from "./ui-locale.js";

const require = createRequire(import.meta.url);

export const MIN_NODE_MAJOR = 22;
export const MIN_NODE_VERSION = "22.16.0";
export const NODE_PIN_VERSION = String(MIN_NODE_MAJOR);
export const NODE_PIN_FILES = [".nvmrc", ".node-version"] as const;

export interface NodeRuntimeSupportResult {
  readonly ok: boolean;
  readonly detail: string;
}

export interface NodeRuntimePinStatus {
  readonly ok: boolean;
  readonly detail: string;
  readonly missing: ReadonlyArray<string>;
}

export interface NodeRuntimePinRepairResult {
  readonly updated: boolean;
  readonly written: ReadonlyArray<string>;
}

export async function inspectNodeRuntimePinFiles(root: string): Promise<NodeRuntimePinStatus> {
  const missing: string[] = [];

  for (const file of NODE_PIN_FILES) {
    try {
      const content = await readFile(join(root, file), "utf-8");
      if (content.trim() !== NODE_PIN_VERSION) {
        missing.push(file);
      }
    } catch {
      missing.push(file);
    }
  }

  if (missing.length === 0) {
    return {
      ok: true,
      detail: uiText(
        `Pinned to Node ${NODE_PIN_VERSION} via ${NODE_PIN_FILES.join(", ")}.`,
        `${NODE_PIN_FILES.join(", ")} 파일에 Node ${NODE_PIN_VERSION} 버전이 고정되어 있습니다.`,
      ),
      missing,
    };
  }

  return {
    ok: false,
    detail: uiText(
      `Missing or outdated: ${missing.join(", ")}. Run 'inkos doctor --repair-node-runtime'.`,
      `없거나 오래된 파일: ${missing.join(", ")}. 'inkos doctor --repair-node-runtime'을 실행하세요.`,
    ),
    missing,
  };
}

export async function ensureNodeRuntimePinFiles(root: string): Promise<NodeRuntimePinRepairResult> {
  const written: string[] = [];

  for (const file of NODE_PIN_FILES) {
    const path = join(root, file);
    let content = "";
    try {
      content = await readFile(path, "utf-8");
    } catch {
      content = "";
    }

    if (content.trim() === NODE_PIN_VERSION) {
      continue;
    }

    await writeFile(path, `${NODE_PIN_VERSION}\n`, "utf-8");
    written.push(file);
  }

  return {
    updated: written.length > 0,
    written,
  };
}

export function parseNodeMajor(version: string): number {
  return parseInt(version.replace(/^v/i, "").split(".")[0] ?? "0", 10);
}

function hasNodeSqliteBuiltin(): boolean {
  try {
    return typeof require("node:sqlite").backup === "function";
  } catch {
    return false;
  }
}

export function evaluateNodeRuntimeSupport(options?: {
  readonly nodeVersion?: string;
  readonly hasNodeSqlite?: boolean;
}): NodeRuntimeSupportResult {
  const nodeVersion = options?.nodeVersion ?? process.version;
  const major = parseNodeMajor(nodeVersion);
  const minor = Number(nodeVersion.replace(/^v/i, "").split(".")[1] ?? 0);

  if (major < MIN_NODE_MAJOR || (major === MIN_NODE_MAJOR && minor < 16)) {
    return {
      ok: false,
      detail: uiText(
        `Unsupported runtime ${nodeVersion}. InkOS requires Node ${MIN_NODE_VERSION}+.`,
        `지원하지 않는 런타임입니다: ${nodeVersion}. InkOS에는 Node ${MIN_NODE_VERSION} 이상이 필요합니다.`,
      ),
    };
  }

  const hasNodeSqlite = options?.hasNodeSqlite ?? hasNodeSqliteBuiltin();
  if (!hasNodeSqlite) {
    return {
      ok: false,
      detail: uiText(
        `${nodeVersion} detected, but the required node:sqlite APIs are unavailable.`,
        `${nodeVersion}을(를) 감지했지만 필요한 node:sqlite API를 사용할 수 없습니다.`,
      ),
    };
  }

  return {
    ok: true,
    detail: uiText(`Available on ${nodeVersion}.`, `${nodeVersion}에서 사용할 수 있습니다.`),
  };
}
