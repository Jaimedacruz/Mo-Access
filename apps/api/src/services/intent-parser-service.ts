import {
  intentSchema,
  intentTypeSchema,
  safetyLevelSchema,
  type Intent
} from "../../../../shared/index";
import { z } from "zod";
import { env } from "../config";
import { getOpenAiClient } from "../lib/openai";
import { intentParserSystemPrompt } from "../prompts/intent-parser-prompt";

const llmIntentSchema = z
  .object({
    type: intentTypeSchema,
    summary: z.string().min(1),
    page: z.string().nullable(),
    currentPage: z.boolean(),
    target: z.string().nullable(),
    actionTarget: z.string().nullable(),
    query: z.string().nullable(),
    fields: z
      .array(
        z
          .object({
            name: z.string().min(1),
            value: z.string().min(1)
          })
          .strict()
      )
      .default([]),
    messageRecipient: z.string().nullable(),
    messageSubject: z.string().nullable(),
    messageBody: z.string().nullable(),
    requiresConfirmation: z.boolean(),
    safetyLevel: safetyLevelSchema,
    confirmationMessage: z.string().nullable(),
    notes: z.array(z.string()).default([])
  })
  .strict();

const intentJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "type",
    "summary",
    "page",
    "currentPage",
    "target",
    "actionTarget",
    "query",
    "fields",
    "messageRecipient",
    "messageSubject",
    "messageBody",
    "requiresConfirmation",
    "safetyLevel",
    "confirmationMessage",
    "notes"
  ],
  properties: {
    type: {
      type: "string",
      enum: ["open_page", "fill_form", "read_page", "compose_message", "search_web"]
    },
    summary: {
      type: "string",
      minLength: 1
    },
    page: {
      type: ["string", "null"]
    },
    currentPage: {
      type: "boolean"
    },
    target: {
      type: ["string", "null"]
    },
    actionTarget: {
      type: ["string", "null"]
    },
    query: {
      type: ["string", "null"]
    },
    fields: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "value"],
        properties: {
          name: { type: "string" },
          value: { type: "string" }
        }
      }
    },
    messageRecipient: {
      type: ["string", "null"]
    },
    messageSubject: {
      type: ["string", "null"]
    },
    messageBody: {
      type: ["string", "null"]
    },
    requiresConfirmation: {
      type: "boolean"
    },
    safetyLevel: {
      type: "string",
      enum: ["low", "medium", "high"]
    },
    confirmationMessage: {
      type: ["string", "null"]
    },
    notes: {
      type: "array",
      items: {
        type: "string"
      }
    }
  }
} as const;

type ParseIntentContext = {
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  pendingConfirmation?: {
    summary: string;
    confirmationMessage: string | null;
    steps: string[];
  } | null;
  pageContextSummary?: string | null;
};

function maybeParseDeterministically(transcript: string): Intent | null {
  const trimmed = transcript.trim();

  const typeAndClickMatch = trimmed.match(
    /^type\s+["']?(.+?)["']?\s+(?:on|into|in)\s+(.+?)(?:\s+and\s+(?:then\s+)?(?:press|click)\s+(.+?))$/i
  );

  if (typeAndClickMatch) {
    const [, value, fieldHint, actionTarget] = typeAndClickMatch;

    return intentSchema.parse({
      type: "fill_form",
      summary: `Type '${value}' into ${fieldHint} and click ${actionTarget}.`,
      page: null,
      currentPage: true,
      target: null,
      actionTarget,
      query: null,
      fields: {
        [fieldHint]: value
      },
      message: null,
      requiresConfirmation: false,
      safetyLevel: "medium",
      confirmationMessage: null,
      notes: []
    });
  }

  if (/(read|summari[sz]e|overview|brief overview)/i.test(trimmed) && /(this page|this website|this site|current tab)/i.test(trimmed)) {
    return intentSchema.parse({
      type: "read_page",
      summary: "Read and summarize the current page.",
      page: null,
      currentPage: true,
      target: null,
      actionTarget: null,
      query: null,
      fields: {},
      message: null,
      requiresConfirmation: false,
      safetyLevel: "low",
      confirmationMessage: null,
      notes: []
    });
  }

  return null;
}

function buildModelInput(transcript: string, context?: ParseIntentContext) {
  const sections = [`Latest user request: ${transcript}`];

  if (context?.history?.length) {
    sections.push(
      `Recent conversation:\n${context.history
        .slice(-6)
        .map((entry) => `${entry.role}: ${entry.content}`)
        .join("\n")}`
    );
  }

  if (context?.pendingConfirmation) {
    sections.push(
      `Pending confirmation:\nSummary: ${context.pendingConfirmation.summary}\nConfirmation message: ${
        context.pendingConfirmation.confirmationMessage ?? "None"
      }\nPlanned steps:\n${context.pendingConfirmation.steps.map((step) => `- ${step}`).join("\n")}`
    );
  }

  if (context?.pageContextSummary) {
    sections.push(`Current page context:\n${context.pageContextSummary}`);
  }

  return sections.join("\n\n");
}

export async function parseIntent(transcript: string, context?: ParseIntentContext): Promise<Intent> {
  const deterministicIntent = maybeParseDeterministically(transcript);
  if (deterministicIntent) {
    return deterministicIntent;
  }

  const openai = getOpenAiClient();
  const response = await openai.responses.create({
    model: env.OPENAI_REASONING_MODEL,
    instructions: intentParserSystemPrompt,
    input: buildModelInput(transcript, context),
    text: {
      format: {
        type: "json_schema",
        name: "parsed_intent",
        strict: true,
        schema: intentJsonSchema
      }
    },
    store: false
  });

  const parsed = llmIntentSchema.parse(JSON.parse(response.output_text));

  return intentSchema.parse({
    type: parsed.type,
    summary: parsed.summary,
    page: parsed.page,
    currentPage: parsed.currentPage,
    target: parsed.target,
    actionTarget: parsed.actionTarget,
    query: parsed.query,
    fields: Object.fromEntries(parsed.fields.map((field) => [field.name, field.value])),
    message:
      parsed.messageRecipient || parsed.messageSubject || parsed.messageBody
        ? {
            recipient: parsed.messageRecipient,
            subject: parsed.messageSubject,
            body: parsed.messageBody
          }
        : null,
    requiresConfirmation: false,
    safetyLevel: parsed.safetyLevel,
    confirmationMessage: null,
    notes: parsed.notes
  });
}
