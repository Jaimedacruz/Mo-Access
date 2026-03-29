import type { ExtensionPageContext } from "../../../../shared/index";
import { env } from "../config";
import { getOpenAiClient } from "../lib/openai";

export async function summarizePageContext(request: string, pageContext: ExtensionPageContext) {
  const openai = getOpenAiClient();
  const pageSummaryInput = `
User request: ${request}

Page title: ${pageContext.title}
Page URL: ${pageContext.url}

Visible text sample:
${pageContext.textBlocks
  .slice(0, 24)
  .map((block) => `- [${block.tag}] ${block.text}`)
  .join("\n")}

Interactive elements sample:
${pageContext.interactiveElements
  .slice(0, 20)
  .map((element) => `- [${element.role}] ${element.text ?? element.label ?? element.placeholder ?? element.name ?? "unnamed"}`)
  .join("\n")}
`.trim();

  const response = await openai.responses.create({
    model: env.OPENAI_REASONING_MODEL,
    instructions:
      "You summarize the current webpage for an accessibility assistant. Reply in 2 or 3 short sentences, plain language only. Focus on what the page appears to be and the main interactive options visible.",
    input: pageSummaryInput,
    store: false
  });

  return response.output_text.trim();
}
