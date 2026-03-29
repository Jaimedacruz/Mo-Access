import { z } from "zod";
import { extensionPageContextSchema } from "./extension-schemas";

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
export const agentRunStatusSchema = z.enum([
  "idle",
  "running",
  "waiting_for_extension",
  "paused",
  "blocked",
  "completed",
  "failed",
  "cancelled"
]);
export const agentStepStatusSchema = z.enum(["pending", "running", "completed", "blocked", "skipped"]);

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
  "open_new_tab",
  "switch_tab",
  "click",
  "type",
  "select_option",
  "scroll",
  "press_key",
  "wait_for_element",
  "extract_text",
  "search_youtube",
  "open_search_result",
  "play_video",
  "pause_video",
  "mute_video",
  "unmute_video",
  "seek_forward",
  "seek_backward",
  "fullscreen_video",
  "create_event",
  "edit_event",
  "delete_event",
  "open_date",
  "add_guest",
  "set_time",
  "create_doc",
  "rename_doc",
  "insert_text",
  "select_text",
  "apply_format",
  "open_doc",
  "open_folder",
  "create_doc_from_drive",
  "upload_file",
  "rename_file",
  "move_file",
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
    date: z.string().optional(),
    time: z.string().optional(),
    endTime: z.string().optional(),
    guestEmail: z.string().optional(),
    title: z.string().optional(),
    details: z.string().optional(),
    text: z.string().optional(),
    format: z.string().optional(),
    index: z.number().int().positive().optional(),
    seconds: z.number().int().positive().optional(),
    fileName: z.string().optional(),
    currentName: z.string().optional(),
    newName: z.string().optional(),
    folderName: z.string().optional(),
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
export const pageSummaryRequestSchema = z
  .object({
    request: z.string().min(1),
    pageContext: extensionPageContextSchema
  })
  .strict();
export const pageSummaryResponseSchema = z
  .object({
    summary: z.string().min(1)
  })
  .strict();
export const agentRunStepSchema = z
  .object({
    index: z.number().int().nonnegative(),
    type: commandTypeSchema,
    description: z.string().min(1),
    status: agentStepStatusSchema,
    commandId: z.string().nullable(),
    commandType: z.string().nullable(),
    startedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    resultOk: z.boolean().nullable(),
    resultMessage: z.string().nullable()
  })
  .strict();
export const agentRunSchema = z
  .object({
    id: z.string().min(1),
    goal: z.string().min(1),
    intentType: intentTypeSchema,
    status: agentRunStatusSchema,
    startedAt: z.string().min(1),
    updatedAt: z.string().min(1),
    currentStepIndex: z.number().int().nullable(),
    currentStepDescription: z.string().nullable(),
    completedSteps: z.number().int().nonnegative(),
    totalSteps: z.number().int().nonnegative(),
    retryCount: z.number().int().nonnegative(),
    blockedReason: z.string().nullable(),
    stopReason: z.string().nullable(),
    activePageUrl: z.string().nullable(),
    activePageTitle: z.string().nullable(),
    lastObservationSummary: z.string().nullable(),
    lastDecisionSummary: z.string().nullable(),
    lastDecisionConfidence: z.number().nullable(),
    clarificationNeeded: z.boolean(),
    lastCommandId: z.string().nullable(),
    lastCommandType: z.string().nullable(),
    lastResultOk: z.boolean().nullable(),
    lastResultMessage: z.string().nullable(),
    steps: z.array(agentRunStepSchema)
  })
  .strict();
export const agentLoopOutcomeSchema = z
  .object({
    status: agentRunStatusSchema.or(z.literal("finished")),
    reason: z.string().nullable().optional()
  })
  .strict();
export const agentStartRequestSchema = parseIntentRequestSchema
  .extend({
    autoRun: z.boolean().default(false),
    maxSteps: z.number().int().positive().max(25).optional()
  })
  .strict();
export const agentContinueRequestSchema = z
  .object({
    maxSteps: z.number().int().positive().max(25).default(1)
  })
  .strict();
export const agentStartResponseSchema = z
  .object({
    transcript: z.string().min(1),
    intent: intentSchema,
    plan: actionPlanSchema,
    agentRun: agentRunSchema,
    loopOutcome: agentLoopOutcomeSchema.nullable().default(null)
  })
  .strict();
export const agentContinueResponseSchema = z
  .object({
    agentRun: agentRunSchema.nullable(),
    loopOutcome: agentLoopOutcomeSchema
  })
  .strict();
export const agentStateResponseSchema = z
  .object({
    agentRun: agentRunSchema.nullable()
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
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;
export type AgentStepStatus = z.infer<typeof agentStepStatusSchema>;
export type IntentType = z.infer<typeof intentTypeSchema>;
export type MessageDetails = z.infer<typeof messageDetailsSchema>;
export type Intent = z.infer<typeof intentSchema>;
export type CommandType = z.infer<typeof commandTypeSchema>;
export type ActionStep = z.infer<typeof actionStepSchema>;
export type ActionPlan = z.infer<typeof actionPlanSchema>;
export type OrchestratorResponse = z.infer<typeof orchestratorResponseSchema>;
export type FeedbackSpeechRequest = z.infer<typeof feedbackSpeechRequestSchema>;
export type PageSummaryRequest = z.infer<typeof pageSummaryRequestSchema>;
export type PageSummaryResponse = z.infer<typeof pageSummaryResponseSchema>;
export type AgentRunStep = z.infer<typeof agentRunStepSchema>;
export type AgentRun = z.infer<typeof agentRunSchema>;
export type AgentLoopOutcome = z.infer<typeof agentLoopOutcomeSchema>;
export type AgentStartRequest = z.infer<typeof agentStartRequestSchema>;
export type AgentContinueRequest = z.infer<typeof agentContinueRequestSchema>;
export type AgentStartResponse = z.infer<typeof agentStartResponseSchema>;
export type AgentContinueResponse = z.infer<typeof agentContinueResponseSchema>;
export type AgentStateResponse = z.infer<typeof agentStateResponseSchema>;
