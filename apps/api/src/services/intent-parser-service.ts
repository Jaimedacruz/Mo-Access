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
import { extractGoogleAppOpenTarget, extractGoogleAppSearchTarget } from "./google-apps-service";

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

function extractEmailLikeRecipient(transcript: string) {
  return transcript.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+(?:\.[A-Z]{2,})?\b/i)?.[0] ?? null;
}

function isCompleteEmailAddress(value: string | null | undefined) {
  if (!value) {
    return false;
  }

  return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value.trim());
}

function extractSearchQuery(transcript: string) {
  const patterns = [
    /(?:^|.*?\b)search\s+(.+?)\s+on\s+google(?:\s+(?:and|then)\b.*)?$/i,
    /(?:^|.*?\b)search(?:\s+the\s+web)?\s+for\s+(.+?)(?:\s+(?:and|then)\b.*)?$/i,
    /^(?:look\s+up|google|find)\s+(.+?)(?:\s+(?:and|then)\b.*)?$/i
  ];

  for (const pattern of patterns) {
    const match = transcript.match(pattern);
    if (!match) {
      continue;
    }

    const query = match[1]
      .trim()
      .replace(/[.?!]+$/, "")
      .trim();

    if (query) {
      return query;
    }
  }

  return null;
}

function specialIntentFields(command: string, values: Record<string, string>) {
  return {
    __app_command: command,
    ...values
  };
}

function maybeParseGoogleControllerIntent(transcript: string): Intent | null {
  const trimmed = normalizeTranscript(transcript);

  const youtubeSearch = trimmed.match(/^(?:search|find|look up)\s+(.+?)\s+on\s+youtube$/i);
  if (youtubeSearch) {
    return intentSchema.parse({
      type: "open_page",
      summary: `Search YouTube for ${youtubeSearch[1]}.`,
      page: "youtube",
      currentPage: false,
      target: "youtube",
      actionTarget: null,
      query: null,
      fields: specialIntentFields("search_youtube", { query: youtubeSearch[1].trim() }),
      message: null,
      requiresConfirmation: false,
      safetyLevel: "low",
      confirmationMessage: null,
      notes: ["Use the YouTube controller for search results."]
    });
  }

  const youtubeResult = trimmed.match(/^(?:open|play)\s+(?:the\s+)?(first|second|third|(\d+)(?:st|nd|rd|th)?)\s+(?:youtube\s+)?result$/i);
  if (youtubeResult) {
    const indexWord = youtubeResult[1].toLowerCase();
    const index = youtubeResult[2]
      ? Number.parseInt(youtubeResult[2], 10)
      : indexWord === "first"
        ? 1
        : indexWord === "second"
          ? 2
          : 3;

    return intentSchema.parse({
      type: "open_page",
      summary: `Open YouTube search result ${index}.`,
      page: "youtube",
      currentPage: true,
      target: "youtube",
      actionTarget: null,
      query: null,
      fields: specialIntentFields("open_search_result", { index: String(index) }),
      message: null,
      requiresConfirmation: false,
      safetyLevel: "low",
      confirmationMessage: null,
      notes: ["Use the YouTube controller on the current results page."]
    });
  }

  const youtubeControls: Array<{ pattern: RegExp; command: string; summary: string; seconds?: number }> = [
    { pattern: /^(?:play|resume)(?: the)?(?: current)?(?: youtube)? video$/i, command: "play_video", summary: "Play the current YouTube video." },
    { pattern: /^(?:pause|stop)(?: the)?(?: current)?(?: youtube)? video$/i, command: "pause_video", summary: "Pause the current YouTube video." },
    { pattern: /^(?:mute)(?: the)?(?: current)?(?: youtube)? video$/i, command: "mute_video", summary: "Mute the current YouTube video." },
    { pattern: /^(?:unmute)(?: the)?(?: current)?(?: youtube)? video$/i, command: "unmute_video", summary: "Unmute the current YouTube video." },
    { pattern: /^(?:fullscreen|maximi[sz]e)(?: the)?(?: current)?(?: youtube)? video$/i, command: "fullscreen_video", summary: "Fullscreen the current YouTube video." }
  ];

  for (const control of youtubeControls) {
    if (control.pattern.test(trimmed)) {
      return intentSchema.parse({
        type: "fill_form",
        summary: control.summary,
        page: "youtube",
        currentPage: true,
        target: "youtube",
        actionTarget: null,
        query: null,
        fields: specialIntentFields(control.command, {}),
        message: null,
        requiresConfirmation: false,
        safetyLevel: "low",
        confirmationMessage: null,
        notes: ["Use the YouTube controller on the current page."]
      });
    }
  }

  const youtubeSeek = trimmed.match(/^(?:fast forward|seek forward|skip forward|rewind|seek backward|skip backward)(?:\s+(\d+))?(?:\s+seconds?)?(?:\s+(?:on|in)\s+youtube|\s+the\s+video|\s+the\s+youtube\s+video)?$/i);
  if (youtubeSeek) {
    const backward = /rewind|backward/i.test(trimmed);
    const seconds = youtubeSeek[1] ? Number.parseInt(youtubeSeek[1], 10) : 10;

    return intentSchema.parse({
      type: "fill_form",
      summary: `${backward ? "Seek backward" : "Seek forward"} ${seconds} seconds in the current YouTube video.`,
      page: "youtube",
      currentPage: true,
      target: "youtube",
      actionTarget: null,
      query: null,
      fields: specialIntentFields(backward ? "seek_backward" : "seek_forward", { seconds: String(seconds) }),
      message: null,
      requiresConfirmation: false,
      safetyLevel: "low",
      confirmationMessage: null,
      notes: ["Use the YouTube controller on the current page."]
    });
  }

  const createEvent = trimmed.match(/^(?:create|add)\s+(?:a\s+)?(?:google\s+)?calendar event(?: called| titled)?\s+(.+?)(?:\s+on\s+(.+?))?(?:\s+at\s+(.+))?$/i);
  if (createEvent) {
    return intentSchema.parse({
      type: "fill_form",
      summary: `Create a Google Calendar event titled ${createEvent[1].trim()}.`,
      page: "calendar",
      currentPage: false,
      target: "calendar",
      actionTarget: null,
      query: null,
      fields: specialIntentFields("create_event", {
        title: createEvent[1].trim(),
        date: createEvent[2]?.trim() ?? "",
        time: createEvent[3]?.trim() ?? ""
      }),
      message: null,
      requiresConfirmation: false,
      safetyLevel: "low",
      confirmationMessage: null,
      notes: ["Use the Google Calendar controller."]
    });
  }

  const openDate = trimmed.match(/^(?:open|go to)\s+(.+?)\s+in\s+(?:google\s+)?calendar$/i);
  if (openDate) {
    return intentSchema.parse({
      type: "open_page",
      summary: `Open ${openDate[1].trim()} in Google Calendar.`,
      page: "calendar",
      currentPage: false,
      target: "calendar",
      actionTarget: null,
      query: null,
      fields: specialIntentFields("open_date", { date: openDate[1].trim() }),
      message: null,
      requiresConfirmation: false,
      safetyLevel: "low",
      confirmationMessage: null,
      notes: ["Use the Google Calendar controller."]
    });
  }

  const addGuest = trimmed.match(/^(?:add guest|invite)\s+([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\s+(?:to|for)\s+(?:the\s+)?(?:current\s+)?(?:google\s+)?calendar event$/i);
  if (addGuest) {
    return intentSchema.parse({
      type: "fill_form",
      summary: `Add ${addGuest[1]} as a guest to the current Google Calendar event.`,
      page: "calendar",
      currentPage: true,
      target: "calendar",
      actionTarget: null,
      query: null,
      fields: specialIntentFields("add_guest", { guestEmail: addGuest[1] }),
      message: null,
      requiresConfirmation: false,
      safetyLevel: "low",
      confirmationMessage: null,
      notes: ["Use the Google Calendar controller on the current event."]
    });
  }

  const setTime = trimmed.match(/^(?:set time|change time)\s+to\s+(.+?)(?:\s+to\s+(.+))?$/i);
  if (setTime && /calendar event|calendar/i.test(trimmed)) {
    return intentSchema.parse({
      type: "fill_form",
      summary: `Set the current Google Calendar event time to ${setTime[1].trim()}.`,
      page: "calendar",
      currentPage: true,
      target: "calendar",
      actionTarget: null,
      query: null,
      fields: specialIntentFields("set_time", {
        time: setTime[1].trim(),
        endTime: setTime[2]?.trim() ?? ""
      }),
      message: null,
      requiresConfirmation: false,
      safetyLevel: "low",
      confirmationMessage: null,
      notes: ["Use the Google Calendar controller on the current event."]
    });
  }

  const editEvent = trimmed.match(/^(?:edit|rename)\s+(?:the\s+)?(?:current\s+)?(?:google\s+)?calendar event(?: title)?\s+to\s+(.+)$/i);
  if (editEvent) {
    return intentSchema.parse({
      type: "fill_form",
      summary: `Rename the current Google Calendar event to ${editEvent[1].trim()}.`,
      page: "calendar",
      currentPage: true,
      target: "calendar",
      actionTarget: null,
      query: null,
      fields: specialIntentFields("edit_event", { title: editEvent[1].trim() }),
      message: null,
      requiresConfirmation: false,
      safetyLevel: "low",
      confirmationMessage: null,
      notes: ["Use the Google Calendar controller on the current event."]
    });
  }

  if (/^(?:delete|remove)\s+(?:the\s+)?(?:current\s+)?(?:google\s+)?calendar event$/i.test(trimmed)) {
    return intentSchema.parse({
      type: "fill_form",
      summary: "Delete the current Google Calendar event.",
      page: "calendar",
      currentPage: true,
      target: "calendar",
      actionTarget: null,
      query: null,
      fields: specialIntentFields("delete_event", {}),
      message: null,
      requiresConfirmation: false,
      safetyLevel: "medium",
      confirmationMessage: null,
      notes: ["Use the Google Calendar controller on the current event."]
    });
  }

  const createDoc = trimmed.match(/^(?:create|new)\s+(?:a\s+)?(?:google\s+)?doc(?:ument)?(?: called| titled)?\s*(.*)$/i);
  if (createDoc) {
    return intentSchema.parse({
      type: "open_page",
      summary: createDoc[1]?.trim() ? `Create a Google Doc titled ${createDoc[1].trim()}.` : "Create a new Google Doc.",
      page: "docs",
      currentPage: false,
      target: "docs",
      actionTarget: null,
      query: null,
      fields: specialIntentFields("create_doc", { title: createDoc[1]?.trim() ?? "" }),
      message: null,
      requiresConfirmation: false,
      safetyLevel: "low",
      confirmationMessage: null,
      notes: ["Use the Google Docs controller."]
    });
  }

  const renameDoc = trimmed.match(/^(?:rename)\s+(?:the\s+)?(?:current\s+)?(?:google\s+)?doc(?:ument)?\s+to\s+(.+)$/i);
  if (renameDoc) {
    return intentSchema.parse({
      type: "fill_form",
      summary: `Rename the current Google Doc to ${renameDoc[1].trim()}.`,
      page: "docs",
      currentPage: true,
      target: "docs",
      actionTarget: null,
      query: null,
      fields: specialIntentFields("rename_doc", { title: renameDoc[1].trim() }),
      message: null,
      requiresConfirmation: false,
      safetyLevel: "low",
      confirmationMessage: null,
      notes: ["Use the Google Docs controller on the current page."]
    });
  }

  const insertText = trimmed.match(/^(?:insert|type|write)\s+["']?(.+?)["']?\s+(?:into|in)\s+(?:the\s+)?(?:current\s+)?(?:google\s+)?doc(?:ument)?$/i);
  if (insertText) {
    return intentSchema.parse({
      type: "fill_form",
      summary: `Insert text into the current Google Doc.`,
      page: "docs",
      currentPage: true,
      target: "docs",
      actionTarget: null,
      query: null,
      fields: specialIntentFields("insert_text", { text: insertText[1].trim() }),
      message: null,
      requiresConfirmation: false,
      safetyLevel: "low",
      confirmationMessage: null,
      notes: ["Use the Google Docs controller on the current page."]
    });
  }

  const selectText = trimmed.match(/^(?:select|highlight)\s+["']?(.+?)["']?\s+(?:in|on)\s+(?:the\s+)?(?:current\s+)?(?:google\s+)?doc(?:ument)?$/i);
  if (selectText) {
    return intentSchema.parse({
      type: "fill_form",
      summary: `Select text in the current Google Doc.`,
      page: "docs",
      currentPage: true,
      target: "docs",
      actionTarget: null,
      query: null,
      fields: specialIntentFields("select_text", { text: selectText[1].trim() }),
      message: null,
      requiresConfirmation: false,
      safetyLevel: "low",
      confirmationMessage: null,
      notes: ["Use the Google Docs controller on the current page."]
    });
  }

  const applyFormat = trimmed.match(/^(?:apply|make)\s+(bold|italic|underline|heading|bullet list|numbered list)(?:\s+(?:to|on)\s+(?:the\s+)?selection)?(?:\s+in\s+(?:the\s+)?(?:current\s+)?(?:google\s+)?doc(?:ument)?)?$/i);
  if (applyFormat) {
    const normalizedFormat = applyFormat[1].toLowerCase().replace(/\s+/g, "_");
    return intentSchema.parse({
      type: "fill_form",
      summary: `Apply ${applyFormat[1]} formatting in the current Google Doc.`,
      page: "docs",
      currentPage: true,
      target: "docs",
      actionTarget: null,
      query: null,
      fields: specialIntentFields("apply_format", { format: normalizedFormat }),
      message: null,
      requiresConfirmation: false,
      safetyLevel: "low",
      confirmationMessage: null,
      notes: ["Use the Google Docs controller on the current page."]
    });
  }

  const openDoc = trimmed.match(/^(?:open)\s+(?:google\s+)?doc(?:ument)?\s+(.+)$/i);
  if (openDoc) {
    return intentSchema.parse({
      type: "open_page",
      summary: `Open the Google Doc ${openDoc[1].trim()}.`,
      page: "docs",
      currentPage: true,
      target: "docs",
      actionTarget: null,
      query: null,
      fields: specialIntentFields("open_doc", { title: openDoc[1].trim() }),
      message: null,
      requiresConfirmation: false,
      safetyLevel: "low",
      confirmationMessage: null,
      notes: ["Use the Google Docs controller."]
    });
  }

  const openFolder = trimmed.match(/^(?:open)\s+(?:the\s+)?(?:google\s+)?drive folder\s+(.+)$/i);
  if (openFolder) {
    return intentSchema.parse({
      type: "open_page",
      summary: `Open the Google Drive folder ${openFolder[1].trim()}.`,
      page: "drive",
      currentPage: true,
      target: "drive",
      actionTarget: null,
      query: null,
      fields: specialIntentFields("open_folder", { folderName: openFolder[1].trim() }),
      message: null,
      requiresConfirmation: false,
      safetyLevel: "low",
      confirmationMessage: null,
      notes: ["Use the Google Drive controller."]
    });
  }

  const createDocFromDrive = trimmed.match(/^(?:create)\s+(?:a\s+)?doc(?:ument)?\s+from\s+drive(?: called| titled)?\s*(.*)$/i);
  if (createDocFromDrive) {
    return intentSchema.parse({
      type: "open_page",
      summary: createDocFromDrive[1]?.trim()
        ? `Create a Google Doc from Drive titled ${createDocFromDrive[1].trim()}.`
        : "Create a Google Doc from Drive.",
      page: "drive",
      currentPage: true,
      target: "drive",
      actionTarget: null,
      query: null,
      fields: specialIntentFields("create_doc_from_drive", { title: createDocFromDrive[1]?.trim() ?? "" }),
      message: null,
      requiresConfirmation: false,
      safetyLevel: "low",
      confirmationMessage: null,
      notes: ["Use the Google Drive controller."]
    });
  }

  const renameFile = trimmed.match(/^(?:rename)\s+(?:drive\s+)?file\s+(.+?)\s+to\s+(.+)$/i);
  if (renameFile) {
    return intentSchema.parse({
      type: "fill_form",
      summary: `Rename the Drive file ${renameFile[1].trim()} to ${renameFile[2].trim()}.`,
      page: "drive",
      currentPage: true,
      target: "drive",
      actionTarget: null,
      query: null,
      fields: specialIntentFields("rename_file", { currentName: renameFile[1].trim(), newName: renameFile[2].trim() }),
      message: null,
      requiresConfirmation: false,
      safetyLevel: "low",
      confirmationMessage: null,
      notes: ["Use the Google Drive controller."]
    });
  }

  const moveFile = trimmed.match(/^(?:move)\s+(?:drive\s+)?file\s+(.+?)\s+to\s+(?:folder\s+)?(.+)$/i);
  if (moveFile) {
    return intentSchema.parse({
      type: "fill_form",
      summary: `Move the Drive file ${moveFile[1].trim()} to ${moveFile[2].trim()}.`,
      page: "drive",
      currentPage: true,
      target: "drive",
      actionTarget: null,
      query: null,
      fields: specialIntentFields("move_file", { fileName: moveFile[1].trim(), folderName: moveFile[2].trim() }),
      message: null,
      requiresConfirmation: false,
      safetyLevel: "low",
      confirmationMessage: null,
      notes: ["Use the Google Drive controller."]
    });
  }

  const uploadFile = trimmed.match(/^(?:upload)\s+file\s+(.+?)(?:\s+to\s+(?:google\s+)?drive)?$/i);
  if (uploadFile) {
    return intentSchema.parse({
      type: "fill_form",
      summary: `Upload ${uploadFile[1].trim()} to Google Drive.`,
      page: "drive",
      currentPage: true,
      target: "drive",
      actionTarget: null,
      query: null,
      fields: specialIntentFields("upload_file", { fileName: uploadFile[1].trim() }),
      message: null,
      requiresConfirmation: false,
      safetyLevel: "medium",
      confirmationMessage: null,
      notes: ["Use the Google Drive controller."]
    });
  }

  return null;
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
    .replace(/\bsubject\s+(?:should\s+be|is)\s+["']?.+$/i, "")
    .replace(/\bwith subject\s+["']?.+$/i, "")
    .replace(/^["']|["']$/g, "")
    .trim()
    .replace(/[.?!]+$/, "")
    .trim();

  return cleaned || null;
}

function extractEmailMessageDetails(transcript: string) {
  const subjectPatterns = [
    /\bsubject\s*:\s*["']?(.+?)["']?(?=(?:\s+\b(?:body|message)\b\s*:|\s+\b(?:and\s+)?(?:body|message)\b\s+|$))/i,
    /\bwith subject\s+["']?(.+?)["']?(?=(?:\s+\b(?:body|message)\b\s*:|\s+\b(?:and\s+)?(?:body|message)\b\s+|$))/i,
    /\bsubject should be\s+["']?(.+?)["']?$/i,
    /\bsubject is\s+["']?(.+?)["']?$/i
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
  const emailLikeRecipient = extractEmailLikeRecipient(trimmed);
  const wantsAnswerBack = /\b(return|tell|give|show)\b.*\b(to me|back)\b|\bwhat is\b|\bwho is\b|\bhow old\b|\bhow much\b|\bwhen\b|\bwhere\b/i.test(
    trimmed
  );
  const controllerIntent = maybeParseGoogleControllerIntent(trimmed);
  if (controllerIntent) {
    return controllerIntent;
  }
  const googleAppSearchTarget = extractGoogleAppSearchTarget(trimmed);
  if (googleAppSearchTarget) {
    const notes = [`Resolved as a ${googleAppSearchTarget.app.label} search.`];
    if (wantsAnswerBack || googleAppSearchTarget.app.key !== "google") {
      notes.push("After opening the results, extract the visible result and answer the user's question.");
    }

    return intentSchema.parse({
      type: "open_page",
      summary:
        googleAppSearchTarget.app.key === "youtube"
          ? `Search YouTube for ${googleAppSearchTarget.query} and return the answer.`
          : `Open ${googleAppSearchTarget.app.label} results for ${googleAppSearchTarget.query} and return the answer.`,
      page: googleAppSearchTarget.url,
      currentPage: false,
      target: googleAppSearchTarget.url,
      actionTarget: null,
      query: null,
      fields: {},
      message: null,
      requiresConfirmation: false,
      safetyLevel: "low",
      confirmationMessage: null,
      notes
    });
  }

  const googleAppOpenTarget = extractGoogleAppOpenTarget(trimmed);
  if (googleAppOpenTarget) {
    return intentSchema.parse({
      type: "open_page",
      summary: `Open ${googleAppOpenTarget.app.label}.`,
      page: googleAppOpenTarget.url,
      currentPage: false,
      target: googleAppOpenTarget.url,
      actionTarget: null,
      query: null,
      fields: {},
      message: null,
      requiresConfirmation: false,
      safetyLevel: "low",
      confirmationMessage: null,
      notes: [`Resolved as direct navigation to ${googleAppOpenTarget.app.label}.`]
    });
  }

  const searchQuery = extractSearchQuery(trimmed);
  if (searchQuery) {
    const query = searchQuery;
    const notes = ["This is a fresh standalone search request."];

    if (wantsAnswerBack) {
      notes.push("After searching, extract the result and answer the user's question.");
    }

    return intentSchema.parse({
      type: "search_web",
      summary: wantsAnswerBack ? `Search the web for ${query} and return the answer.` : `Search the web for ${query}.`,
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
      notes
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

  if (emailLikeRecipient && /(gmail|email|e-mail|mail)\b/i.test(trimmed)) {
    const recipient = emailLikeRecipient;
    const wantsGreetingOnly = /(just\s+greet|greet\s+the\s+person|say\s+hi|say\s+hello|just\s+say\s+hi|just\s+say\s+hello)/i.test(
      trimmed
    );
    const extractedDetails = extractEmailMessageDetails(trimmed);
    const subject = extractedDetails.subject;
    const body = wantsGreetingOnly ? extractedDetails.body ?? "Hello," : extractedDetails.body;
    const wantsSend = /\b(send|send it|don'?t forget to send|and send|then send)\b/i.test(trimmed);
    const completeRecipient = isCompleteEmailAddress(recipient);
    const notes = [];

    if (!completeRecipient) {
      notes.push("Recipient appears to be missing a top-level domain or full email address.");
    }

    if (body || subject) {
      notes.push(
        wantsSend && completeRecipient
          ? "The request includes email content and explicitly asks to send it."
          : "The request includes email content for drafting."
      );
    } else {
      notes.push("The recipient is clear enough to draft an email, but the message content was not fully specified.");
    }

    if (wantsSend && !completeRecipient) {
      notes.push("The draft will open in Gmail, but send should wait until the recipient address is complete.");
    }

    return intentSchema.parse({
      type: "compose_message",
      summary:
        subject || body
          ? `Open Gmail and ${wantsSend ? "send" : "compose"} an email to ${recipient}${subject ? ` with subject '${subject}'` : ""}.`
          : `Open Gmail and compose an email to ${recipient}.`,
      page: "gmail",
      currentPage: false,
      target: "gmail",
      actionTarget: wantsSend && completeRecipient ? "send button" : null,
      query: null,
      fields: {},
      message: {
        recipient,
        subject,
        body
      },
      requiresConfirmation: false,
      safetyLevel: completeRecipient && (body || subject) ? "medium" : "high",
      confirmationMessage: null,
      notes
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
