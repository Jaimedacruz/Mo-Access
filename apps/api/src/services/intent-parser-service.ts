import {
  type ActionPlan,
  type ExtensionCommandResult,
  type ExtensionPageContext,
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
  lastIntent?: Intent | null;
  lastPlan?: ActionPlan | null;
  lastExtensionResult?: ExtensionCommandResult | null;
  currentPageContext?: ExtensionPageContext | null;
  sessionStateSummary?: string | null;
  lastIntentSummary?: string | null;
  lastPlanSummary?: string | null;
  lastExtensionResultSummary?: string | null;
  currentPageContextSummary?: string | null;
};

function normalizeTranscript(transcript: string) {
  return transcript.trim().replace(/\s+/g, " ");
}

function isFollowUpRequest(transcript: string) {
  return /^(send|send it|submit|submit it|continue|finish|click send|read it|read it aloud|summari[sz]e it|what does it say|what is on it)$/i.test(
    transcript.trim()
  );
}

function isFreshStandaloneRequest(transcript: string) {
  const trimmed = transcript.trim();

  if (!trimmed || isFollowUpRequest(trimmed)) {
    return false;
  }

  return /^(search(?:\s+the\s+web)?\s+for|look\s+up|google|find|open|go\s+to|navigate\s+to|read|summari[sz]e|type|fill|click|press|write|compose|send an email|send email)\b/i.test(
    trimmed
  );
}

function cleanExtractedMessagePart(value: string | null) {
  if (!value) {
    return null;
  }

  const cleaned = value
    .trim()
    .replace(/^(that\s+says?|saying|with\s+body|body(?::|\s+is)?|message(?::|\s+is)?|saying\s+that)\s+/i, "")
    .replace(/^["']|["']$/g, "")
    .trim()
    .replace(/[.?!]+$/, "")
    .trim();

  return cleaned || null;
}

function extractEmailMessageDetails(transcript: string) {
  const subjectPatterns = [
    /\bsubject\s*:\s*["']?(.+?)["']?(?=(?:\s+\b(?:body|message)\b\s*:|\s+\b(?:and\s+)?(?:body|message)\b\s+|$))/i,
    /\bwith subject\s+["']?(.+?)["']?(?=(?:\s+\b(?:body|message)\b\s*:|\s+\b(?:and\s+)?(?:body|message)\b\s+|$))/i
  ];

  const bodyPatterns = [
    /\bbody\s*:\s*["']?(.+?)["']?$/i,
    /\bmessage\s*:\s*["']?(.+?)["']?$/i,
    /\band body\s+["']?(.+?)["']?$/i,
    /\band message\s+["']?(.+?)["']?$/i,
    /\b(?:email|mail|message)\s+(?:saying|that says)\s+["']?(.+?)["']?$/i,
    /\bsay(?:ing)?\s+["']?(.+?)["']?$/i,
    /\bwith message\s+["']?(.+?)["']?$/i,
    /\bwith body\s+["']?(.+?)["']?$/i
  ];

  let subject: string | null = null;
  let body: string | null = null;

  for (const pattern of subjectPatterns) {
    const match = transcript.match(pattern);
    if (match) {
      subject = cleanExtractedMessagePart(match[1]);
      break;
    }
  }

  for (const pattern of bodyPatterns) {
    const match = transcript.match(pattern);
    if (match) {
      body = cleanExtractedMessagePart(match[1]);
      break;
    }
  }

  return { subject, body };
}

function maybeParseDeterministically(transcript: string, context?: ParseIntentContext): Intent | null {
  const trimmed = normalizeTranscript(transcript);
  const emailMatch = trimmed.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);

  const searchMatch = trimmed.match(/^(?:search(?:\s+the\s+web)?\s+for|look\s+up|google|find)\s+(.+)$/i);
  if (searchMatch) {
    const query = searchMatch[1].trim().replace(/[.?!]+$/, "");

    return intentSchema.parse({
      type: "search_web",
      summary: `Search the web for ${query}.`,
      page: null,
      currentPage: false,
      target: null,
      actionTarget: null,
      query,
      fields: {},
      message: null,
      requiresConfirmation: false,
      safetyLevel: "low",
      confirmationMessage: null,
      notes: ["This is a fresh standalone search request."]
    });
  }

  if (/^(send|send it|submit|submit it|continue|finish|click send)$/i.test(trimmed) && context?.lastPlan) {
    const sendStep = context.lastPlan.steps.find(
      (step) =>
        step.type === "click" &&
        /send|submit|continue|next/i.test(`${step.target ?? ""} ${step.description}`.toLowerCase())
    );

    if (sendStep) {
      return intentSchema.parse({
        type: "fill_form",
        summary: `Continue the current task by activating ${sendStep.target ?? "the next action"}.`,
        page: null,
        currentPage: true,
        target: null,
        actionTarget: sendStep.target ?? "send button",
        query: null,
        fields: {},
        message: null,
        requiresConfirmation: false,
        safetyLevel: "medium",
        confirmationMessage: null,
        notes: ["Resolved from the previous plan and current task state."]
      });
    }
  }

  if (/^(read it|read it aloud|summari[sz]e it|what does it say|what is on it)$/i.test(trimmed) && context?.currentPageContext) {
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
      notes: ["Resolved from the current page context."]
    });
  }

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

  if (emailMatch && /(gmail|email|e-mail|mail)\b/i.test(trimmed)) {
    const recipient = emailMatch[0];
    const wantsGreetingOnly = /(just\s+greet|greet\s+the\s+person|say\s+hi|say\s+hello|just\s+say\s+hi|just\s+say\s+hello)/i.test(
      trimmed
    );
    const extractedDetails = extractEmailMessageDetails(trimmed);
    const subject = extractedDetails.subject;
    const body = wantsGreetingOnly ? extractedDetails.body ?? "Hello," : extractedDetails.body;
    const wantsSend = /\b(send|send it|don'?t forget to send|and send|then send)\b/i.test(trimmed);

    return intentSchema.parse({
      type: "compose_message",
      summary:
        subject || body
          ? `Open Gmail and ${wantsSend ? "send" : "compose"} an email to ${recipient}${subject ? ` with subject '${subject}'` : ""}.`
          : `Open Gmail and compose an email to ${recipient}.`,
      page: "gmail",
      currentPage: false,
      target: "gmail",
      actionTarget: "send button",
      query: null,
      fields: {},
      message: {
        recipient,
        subject,
        body
      },
      requiresConfirmation: false,
      safetyLevel: body || subject ? "medium" : "high",
      confirmationMessage: null,
      notes:
        body || subject
          ? [
              wantsSend
                ? "The request includes email content and explicitly asks to send it."
                : "The request includes email content for drafting."
            ]
          : ["The recipient is clear, but the message content was not fully specified."]
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
  const useSessionContinuity = !isFreshStandaloneRequest(transcript);
  const sections = [`Latest user request: ${transcript}`];

  if (context?.history?.length) {
    sections.push(
      `Recent conversation:\n${context.history
        .slice(-4)
        .map((entry) => `${entry.role}: ${entry.content}`)
        .join("\n")}`
    );
  }

  if (useSessionContinuity && context?.sessionStateSummary) {
    sections.push(`Session state:\n${context.sessionStateSummary}`);
  }

  if (useSessionContinuity && context?.lastIntentSummary) {
    sections.push(`Last intent:\n${context.lastIntentSummary}`);
  }

  if (useSessionContinuity && context?.lastPlanSummary) {
    sections.push(`Last plan:\n${context.lastPlanSummary}`);
  }

  if (useSessionContinuity && context?.lastExtensionResultSummary) {
    sections.push(`Last extension result:\n${context.lastExtensionResultSummary}`);
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

  if (context?.currentPageContextSummary && context.currentPageContextSummary !== context.pageContextSummary) {
    sections.push(`Current page context snapshot:\n${context.currentPageContextSummary}`);
  }

  return sections.join("\n\n");
}

export async function parseIntent(transcript: string, context?: ParseIntentContext): Promise<Intent> {
  const deterministicIntent = maybeParseDeterministically(transcript, context);
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
