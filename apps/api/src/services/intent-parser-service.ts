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
    target: z.string().nullable(),
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
    "target",
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
    target: {
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

export async function parseIntent(transcript: string): Promise<Intent> {
  const openai = getOpenAiClient();
  const response = await openai.responses.create({
    model: env.OPENAI_REASONING_MODEL,
    instructions: intentParserSystemPrompt,
    input: `Transcript: ${transcript}`,
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
    target: parsed.target,
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
    requiresConfirmation: parsed.requiresConfirmation,
    safetyLevel: parsed.safetyLevel,
    confirmationMessage: parsed.confirmationMessage,
    notes: parsed.notes
  });
}
