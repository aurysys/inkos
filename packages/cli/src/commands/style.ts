import { Command } from "commander";
import {
  PipelineRunner,
  createGenerateStyleGuideTool,
  executeExplicitCapabilityTool,
} from "@actalk/inkos-core";
import { loadConfig, buildPipelineConfig, findProjectRoot, resolveBookId, log, logError, resolveCliProfileSkills } from "../utils.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { uiText } from "../ui-locale.js";

export const styleCommand = new Command("style")
  .description(uiText("Compile a reference text into an operational style guide", "참고 텍스트를 실제로 쓸 수 있는 문체 가이드로 정리합니다"));

styleCommand
  .command("import")
  .description(uiText("Generate and import a Skill-based style guide into a book", "스킬 기반 문체 가이드를 생성해 책으로 가져옵니다"))
  .argument("<file>", uiText("Reference text file", "참고 텍스트 파일"))
  .argument("[book-id]", uiText("Book ID (auto-detected if only one book)", "책 ID(책이 하나뿐이면 자동으로 찾습니다)"))
  .option("--name <name>", uiText("Source name", "출처 이름"))
  .option("--json", uiText("Output JSON", "JSON으로 출력합니다"))
  .action(async (file: string, bookIdArg: string | undefined, opts) => {
    try {
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const text = await readFile(resolve(file), "utf-8");
      const config = await loadConfig();
      const pipeline = new PipelineRunner(buildPipelineConfig(config, root));
      const activatedSkills = await resolveCliProfileSkills(root, "longform-novel", {
        extraSkillIds: ["inkos-long-story-analysis", "inkos-imitation-writing"],
      });
      await executeExplicitCapabilityTool({
        projectRoot: root,
        binding: { capabilityId: "longform", actionId: "generate_style_guide", profileId: "longform-novel", risk: "recoverable-write" },
        tool: createGenerateStyleGuideTool(pipeline, bookId, { activeSkills: () => activatedSkills }),
        workId: bookId,
        parameters: { referenceText: text, sourceName: opts.name ?? file },
      });
      const result = { bookId, file, styleGuide: "story/style_guide.md" };
      log(opts.json
        ? JSON.stringify(result, null, 2)
        : uiText(`Style guide imported to "${bookId}" from "${file}"`, `"${file}"에서 문체 가이드를 만들어 "${bookId}"(으)로 가져왔습니다`));
    } catch (error) {
      if (opts.json) log(JSON.stringify({ error: String(error) }));
      else logError(uiText(`Import failed: ${error}`, `가져오지 못했습니다: ${error}`));
      process.exit(1);
    }
  });
