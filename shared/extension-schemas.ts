import { z } from "zod";

export const extensionElementRoleSchema = z.enum([
  "button",
  "link",
  "input",
  "textarea",
  "select",
  "contenteditable",
  "other"
]);

export const extensionTargetSchema = z
  .object({
    text: z.string().nullable().optional(),
    role: extensionElementRoleSchema.nullable().optional(),
    selector: z.string().nullable().optional(),
    fieldHint: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    id: z.string().nullable().optional(),
    ariaLabel: z.string().nullable().optional(),
    placeholder: z.string().nullable().optional()
  })
  .strict();

export const extensionFieldEntrySchema = z
  .object({
    fieldHint: z.string().min(1),
    value: z.string()
  })
  .strict();

export const extensionWaitMatchTypeSchema = z.enum(["clickable", "field", "either"]);
export const extensionScrollDirectionSchema = z.enum(["up", "down", "top", "bottom"]);

export const extensionCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      id: z.string().min(1),
      type: z.literal("ping")
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      type: z.literal("get_page_context")
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      type: z.literal("extract_text_blocks")
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      type: z.literal("navigate"),
      url: z.string().min(1),
      newTab: z.boolean().default(false)
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      type: z.literal("open_new_tab"),
      url: z.string().min(1)
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      type: z.literal("switch_tab"),
      query: z.string().min(1).optional(),
      tabId: z.number().int().nonnegative().optional()
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      type: z.literal("click"),
      target: extensionTargetSchema
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      type: z.literal("fill_field"),
      target: extensionTargetSchema,
      value: z.string()
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      type: z.literal("fill_form"),
      fields: z.array(extensionFieldEntrySchema).min(1)
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      type: z.literal("select_option"),
      target: extensionTargetSchema,
      value: z.string().min(1)
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      type: z.literal("scroll"),
      direction: extensionScrollDirectionSchema.default("down"),
      amount: z.number().int().positive().optional(),
      target: extensionTargetSchema.optional()
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      type: z.literal("press_key"),
      key: z.string().min(1),
      altKey: z.boolean().default(false),
      ctrlKey: z.boolean().default(false),
      shiftKey: z.boolean().default(false),
      metaKey: z.boolean().default(false)
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      type: z.literal("wait_for_element"),
      target: extensionTargetSchema,
      matchType: extensionWaitMatchTypeSchema.default("either"),
      timeoutMs: z.number().int().positive().max(30000).default(8000),
      intervalMs: z.number().int().positive().max(5000).default(350)
    })
    .strict()
]);

export const extensionElementMatchSchema = z
  .object({
    tag: z.string(),
    role: extensionElementRoleSchema,
    text: z.string().nullable(),
    label: z.string().nullable(),
    name: z.string().nullable(),
    id: z.string().nullable(),
    placeholder: z.string().nullable(),
    ariaLabel: z.string().nullable(),
    disabled: z.boolean(),
    visible: z.boolean(),
    selector: z.string().nullable().optional(),
    score: z.number().nullable().optional()
  })
  .strict();

export const extensionTextBlockSchema = z
  .object({
    index: z.number().int().nonnegative(),
    tag: z.string(),
    text: z.string().min(1)
  })
  .strict();

export const extensionFormSummarySchema = z
  .object({
    index: z.number().int().nonnegative(),
    id: z.string().nullable(),
    name: z.string().nullable(),
    action: z.string().nullable(),
    method: z.string().nullable(),
    fieldLabels: z.array(z.string()),
    submitLabels: z.array(z.string())
  })
  .strict();

export const extensionPageContextSchema = z
  .object({
    title: z.string(),
    url: z.string(),
    visibleText: z.string(),
    textBlocks: z.array(extensionTextBlockSchema),
    interactiveElements: z.array(extensionElementMatchSchema),
    fieldElements: z.array(extensionElementMatchSchema),
    forms: z.array(extensionFormSummarySchema)
  })
  .strict();

export const extensionCommandResultSchema = z
  .object({
    commandId: z.string().min(1),
    ok: z.boolean(),
    action: z.string().min(1),
    message: z.string().min(1),
    matched: extensionElementMatchSchema.optional(),
    candidates: z.array(extensionElementMatchSchema).optional(),
    pageContext: extensionPageContextSchema.optional(),
    data: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

export const extensionTabStatusSchema = z
  .object({
    title: z.string().nullable(),
    url: z.string().nullable(),
    tabId: z.number().int().nullable()
  })
  .strict();

export const extensionHeartbeatSchema = z
  .object({
    version: z.string().min(1),
    ready: z.boolean(),
    activeTab: extensionTabStatusSchema,
    lastCommandId: z.string().nullable().optional()
  })
  .strict();

export const extensionExecuteRequestSchema = z
  .object({
    command: extensionCommandSchema
  })
  .strict();

export const extensionExecuteResponseSchema = z
  .object({
    queued: z.boolean(),
    command: extensionCommandSchema,
    pendingCommands: z.number().int().nonnegative()
  })
  .strict();

export const extensionBridgeStateSchema = z
  .object({
    extensionConnected: z.boolean(),
    pendingCommands: z.number().int().nonnegative(),
    lastHeartbeat: extensionHeartbeatSchema.nullable(),
    lastResult: extensionCommandResultSchema.nullable(),
    lastPageContext: extensionPageContextSchema.nullable()
  })
  .strict();

export type ExtensionCommand = z.infer<typeof extensionCommandSchema>;
export type ExtensionCommandResult = z.infer<typeof extensionCommandResultSchema>;
export type ExtensionElementMatch = z.infer<typeof extensionElementMatchSchema>;
export type ExtensionFieldEntry = z.infer<typeof extensionFieldEntrySchema>;
export type ExtensionFormSummary = z.infer<typeof extensionFormSummarySchema>;
export type ExtensionHeartbeat = z.infer<typeof extensionHeartbeatSchema>;
export type ExtensionPageContext = z.infer<typeof extensionPageContextSchema>;
export type ExtensionScrollDirection = z.infer<typeof extensionScrollDirectionSchema>;
export type ExtensionTarget = z.infer<typeof extensionTargetSchema>;
export type ExtensionTextBlock = z.infer<typeof extensionTextBlockSchema>;
export type ExtensionWaitMatchType = z.infer<typeof extensionWaitMatchTypeSchema>;
