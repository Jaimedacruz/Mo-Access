import { z } from "zod";

export const assistantStatusSchema = z.enum([
  "idle",
  "transcribing",
  "parsing",
  "planning",
  "ready",
  "error"
]);

export const safetyLevelSchema = z.enum(["low", "medium", "high"]);
export const feedbackEventTypeSchema = z.enum([
  "info",
  "progress",
  "success",
  "warning",
  "error",
  "awaiting_confirmation"
]);
export const feedbackSpeechVoiceSchema = z.enum(["alloy", "ash", "ballad", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer", "verse"]);

export const intentTypeSchema = z.enum([
  "open_page",
  "fill_form",
  "read_page",
  "compose_message",
  "search_web"
]);

export const messageDetailsSchema = z
  .object({
    recipient: z.string().nullable(),
    subject: z.string().nullable(),
    body: z.string().nullable()
  })
  .strict();

export const intentSchema = z
  .object({
    type: intentTypeSchema,
    summary: z.string().min(1),
    page: z.string().nullable(),
    currentPage: z.boolean().default(false),
    target: z.string().nullable(),
    actionTarget: z.string().nullable().default(null),
    query: z.string().nullable(),
    fields: z.record(z.string(), z.string()).default({}),
    message: messageDetailsSchema.nullable(),
    requiresConfirmation: z.boolean(),
    safetyLevel: safetyLevelSchema,
    confirmationMessage: z.string().nullable(),
    notes: z.array(z.string()).default([])
  })
  .strict();

export const commandTypeSchema = z.enum([
  "navigate",
  "click",
  "type",
  "extract_text",
  "confirm",
  "search",
  "compose_message"
]);

export const actionStepSchema = z
  .object({
    type: commandTypeSchema,
    description: z.string().min(1),
    target: z.string().optional(),
    fieldHint: z.string().optional(),
    value: z.string().optional(),
    query: z.string().optional(),
    message: z.string().optional(),
    recipient: z.string().optional(),
    subject: z.string().optional(),
    body: z.string().optional(),
    requiresConfirmation: z.boolean().default(false)
  })
  .strict();

export const actionPlanSchema = z
  .object({
    summary: z.string().min(1),
    steps: z.array(actionStepSchema).min(1),
    requiresConfirmation: z.boolean(),
    safetyLevel: safetyLevelSchema,
    confirmationMessage: z.string().optional(),
    notes: z.array(z.string()).default([])
  })
  .strict();

export const parseIntentRequestSchema = z
  .object({
    transcript: z.string().min(1),
    history: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            content: z.string().min(1)
          })
          .strict()
      )
      .default([]),
    pendingConfirmation: z
      .object({
        summary: z.string().min(1),
        confirmationMessage: z.string().nullable(),
        steps: z.array(z.string()).default([])
      })
      .nullable()
      .default(null)
  })
  .strict();

export const planRequestSchema = z
  .object({
    intent: intentSchema
  })
  .strict();

export const orchestrateRequestSchema = parseIntentRequestSchema;
export const feedbackSpeechRequestSchema = z
  .object({
    text: z.string().min(1).max(320),
    voice: feedbackSpeechVoiceSchema.optional()
  })
  .strict();

export const transcriptionResponseSchema = z
  .object({
    transcript: z.string().min(1)
  })
  .strict();

export const parseIntentResponseSchema = z
  .object({
    intent: intentSchema
  })
  .strict();

export const actionPlanResponseSchema = z
  .object({
    plan: actionPlanSchema
  })
  .strict();

export const orchestratorResponseSchema = z
  .object({
    transcript: z.string().min(1),
    intent: intentSchema,
    plan: actionPlanSchema,
    statusMessages: z.array(z.string()).default([]),
    assistantMessage: z.string().nullable().default(null)
  })
  .strict();

export type AssistantStatus = z.infer<typeof assistantStatusSchema>;
export type SafetyLevel = z.infer<typeof safetyLevelSchema>;
export type FeedbackEventType = z.infer<typeof feedbackEventTypeSchema>;
export type FeedbackSpeechVoice = z.infer<typeof feedbackSpeechVoiceSchema>;
export type IntentType = z.infer<typeof intentTypeSchema>;
export type MessageDetails = z.infer<typeof messageDetailsSchema>;
export type Intent = z.infer<typeof intentSchema>;
export type CommandType = z.infer<typeof commandTypeSchema>;
export type ActionStep = z.infer<typeof actionStepSchema>;
export type ActionPlan = z.infer<typeof actionPlanSchema>;
export type OrchestratorResponse = z.infer<typeof orchestratorResponseSchema>;
export type FeedbackSpeechRequest = z.infer<typeof feedbackSpeechRequestSchema>;
