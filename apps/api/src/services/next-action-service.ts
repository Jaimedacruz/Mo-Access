import {
  type ActionPlan,
  type ActionStep,
  type ExtensionCommand,
  type ExtensionElementMatch,
  type ExtensionPageContext,
  type ExtensionTarget
} from "../../../../shared/index";
import { z } from "zod";
import { env } from "../config";
import { getOpenAiClient } from "../lib/openai";

export type NextActionDecision = {
  command: ExtensionCommand | null;
  reason: string;
  confidence: number;
  clarificationNeeded: boolean;
  clarificationMessage: string | null;
};

type DecideNextActionInput = {
  plan: ActionPlan;
  stepIndex: number;
  pageContext: ExtensionPageContext | null;
};

const modelDecisionSchema = z
  .object({
    commandType: z.enum(["click", "fill_field", "select_option", "wait_for_element", "scroll"]),
    reason: z.string().min(1),
    confidence: z.number().min(0).max(1),
    clarificationNeeded: z.boolean(),
    clarificationMessage: z.string().nullable(),
    selector: z.string().nullable(),
    text: z.string().nullable(),
    fieldHint: z.string().nullable(),
    direction: z.enum(["up", "down", "top", "bottom"]).nullable()
  })
  .strict();

function normalize(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ");
}

function computeLabelScore(query: string, candidate: string | null | undefined) {
  const normalizedQuery = normalize(query);
  const normalizedCandidate = normalize(candidate);

  if (!normalizedQuery || !normalizedCandidate) {
    return 0;
  }

  if (normalizedQuery === normalizedCandidate) {
    return 1;
  }

  if (normalizedCandidate.includes(normalizedQuery) || normalizedQuery.includes(normalizedCandidate)) {
    return 0.88;
  }

  const queryTokens = normalizedQuery.split(" ").filter(Boolean);
  const candidateTokens = normalizedCandidate.split(" ").filter(Boolean);
  const overlap = queryTokens.filter((token) => candidateTokens.includes(token)).length;

  if (overlap === 0) {
    return 0;
  }

  return overlap / Math.max(queryTokens.length, candidateTokens.length);
}

function buildTargetFromCandidate(candidate: ExtensionElementMatch, fallbackText: string | undefined): ExtensionTarget {
  return {
    text: fallbackText ?? candidate.text,
    role: candidate.role,
    selector: candidate.selector ?? null,
    fieldHint: candidate.label ?? candidate.placeholder ?? candidate.name ?? candidate.id ?? null,
    name: candidate.name,
    id: candidate.id,
    ariaLabel: candidate.ariaLabel,
    placeholder: candidate.placeholder
  };
}

function rankInteractiveCandidate(pageContext: ExtensionPageContext, query: string) {
  return [...pageContext.interactiveElements]
    .map((candidate) => ({
      candidate,
      score: Math.max(
        computeLabelScore(query, candidate.text),
        computeLabelScore(query, candidate.label),
        computeLabelScore(query, candidate.ariaLabel),
        computeLabelScore(query, candidate.name),
        computeLabelScore(query, candidate.id)
      )
    }))
    .sort((left, right) => right.score - left.score)[0] ?? null;
}

function rankFieldCandidate(pageContext: ExtensionPageContext, query: string) {
  return [...pageContext.fieldElements]
    .map((candidate) => ({
      candidate,
      score: Math.max(
        computeLabelScore(query, candidate.label),
        computeLabelScore(query, candidate.placeholder),
        computeLabelScore(query, candidate.ariaLabel),
        computeLabelScore(query, candidate.name),
        computeLabelScore(query, candidate.id),
        computeLabelScore(query, candidate.text)
      )
    }))
    .sort((left, right) => right.score - left.score)[0] ?? null;
}

function summarizePageContext(pageContext: ExtensionPageContext) {
  return [
    `Title: ${pageContext.title}`,
    `URL: ${pageContext.url}`,
    "Interactive candidates:",
    ...pageContext.interactiveElements
      .slice(0, 10)
      .map(
        (candidate) =>
          `- ${candidate.role}: ${candidate.label ?? candidate.text ?? candidate.ariaLabel ?? candidate.placeholder ?? candidate.name ?? candidate.id ?? candidate.tag}`
      ),
    "Field candidates:",
    ...pageContext.fieldElements
      .slice(0, 10)
      .map(
        (candidate) =>
          `- ${candidate.role}: ${candidate.label ?? candidate.placeholder ?? candidate.ariaLabel ?? candidate.name ?? candidate.id ?? candidate.tag}`
      ),
    "Forms:",
    ...pageContext.forms
      .slice(0, 6)
      .map(
        (form) =>
          `- fields: ${form.fieldLabels.slice(0, 5).join(", ") || "none"} | submit: ${form.submitLabels.slice(0, 3).join(", ") || "none"}`
      )
  ].join("\n");
}

function buildDeterministicDecision(step: ActionStep, stepIndex: number, pageContext: ExtensionPageContext | null): NextActionDecision {
  const commandId = `agent_decision_${Date.now()}_${stepIndex}`;

  switch (step.type) {
    case "navigate":
      if (!step.target) {
        return {
          command: null,
          reason: "The navigation step has no target URL.",
          confidence: 0,
          clarificationNeeded: true,
          clarificationMessage: "I need a destination before I can continue."
        };
      }

      return {
        command: {
          id: commandId,
          type: "navigate",
          url: step.target.startsWith("http") ? step.target : `http://localhost:5173${step.target}`,
          newTab: false
        },
        reason: "The plan already specifies the destination explicitly.",
        confidence: 0.99,
        clarificationNeeded: false,
        clarificationMessage: null
      };
    case "search":
      if (!step.query) {
        return {
          command: null,
          reason: "The search step has no query.",
          confidence: 0,
          clarificationNeeded: true,
          clarificationMessage: "I need a search query before I can continue."
        };
      }

      return {
        command: {
          id: commandId,
          type: "navigate",
          url: `https://www.google.com/search?q=${encodeURIComponent(step.query)}`,
          newTab: false
        },
        reason: "The safest search execution is a direct navigation to the search results page.",
        confidence: 0.99,
        clarificationNeeded: false,
        clarificationMessage: null
      };
    case "extract_text":
      return {
        command: {
          id: commandId,
          type: "extract_text_blocks"
        },
        reason: "Reading the page requires extracting visible text from the current page.",
        confidence: 0.99,
        clarificationNeeded: false,
        clarificationMessage: null
      };
    case "type": {
      if (!step.fieldHint || typeof step.value !== "string") {
        return {
          command: null,
          reason: "The type step is missing either a field hint or a value.",
          confidence: 0,
          clarificationNeeded: true,
          clarificationMessage: "I need to know both the field and the value before typing."
        };
      }

      const bestField = pageContext ? rankFieldCandidate(pageContext, step.fieldHint) : null;
      if (bestField?.candidate.role === "select" && bestField.score >= 0.82) {
        return {
          command: {
            id: commandId,
            type: "select_option",
            target: buildTargetFromCandidate(bestField.candidate, step.fieldHint),
            value: step.value
          },
          reason: "The field hint matches a visible select control, so selecting an option is more reliable than typing.",
          confidence: Math.max(0.74, bestField.score),
          clarificationNeeded: false,
          clarificationMessage: null
        };
      }

      return {
        command: {
          id: commandId,
          type: "fill_field",
          target: bestField && bestField.score >= 0.78
            ? buildTargetFromCandidate(bestField.candidate, step.fieldHint)
            : {
                text: null,
                role: null,
                selector: null,
                fieldHint: step.fieldHint,
                name: null,
                id: null,
                ariaLabel: null,
                placeholder: null
              },
          value: step.value
        },
        reason: bestField && bestField.score >= 0.78
          ? "A strong field match was found in the current page context."
          : "The planner provided a usable field hint, so the extension can attempt field matching directly.",
        confidence: bestField ? Math.max(0.58, bestField.score) : 0.66,
        clarificationNeeded: false,
        clarificationMessage: null
      };
    }
    case "click": {
      if (!step.target) {
        return {
          command: null,
          reason: "The click step has no target.",
          confidence: 0,
          clarificationNeeded: true,
          clarificationMessage: "I need to know what to click before I can continue."
        };
      }

      const bestInteractive = pageContext ? rankInteractiveCandidate(pageContext, step.target) : null;

      return {
        command: {
          id: commandId,
          type: "click",
          target: bestInteractive && bestInteractive.score >= 0.8
            ? buildTargetFromCandidate(bestInteractive.candidate, step.target)
            : {
                text: step.target,
                role: step.target.toLowerCase().includes("button") || step.target.toLowerCase().includes("send") ? "button" : null,
                selector: null,
                fieldHint: null,
                name: null,
                id: null,
                ariaLabel: null,
                placeholder: null
              }
        },
        reason: bestInteractive && bestInteractive.score >= 0.8
          ? "A strong clickable candidate was found on the page."
          : "The planner provided a click target, so the extension can attempt direct element matching.",
        confidence: bestInteractive ? Math.max(0.56, bestInteractive.score) : 0.64,
        clarificationNeeded: false,
        clarificationMessage: null
      };
    }
    case "select_option":
      if (!step.fieldHint || typeof step.value !== "string") {
        return {
          command: null,
          reason: "The select step is missing either a field hint or a value.",
          confidence: 0,
          clarificationNeeded: true,
          clarificationMessage: "I need to know which field to select and what option to choose."
        };
      }

      return {
        command: {
          id: commandId,
          type: "select_option",
          target: {
            text: null,
            role: "select",
            selector: null,
            fieldHint: step.fieldHint,
            name: null,
            id: null,
            ariaLabel: null,
            placeholder: null
          },
          value: step.value
        },
        reason: "The plan explicitly asks for a select-style interaction.",
        confidence: 0.88,
        clarificationNeeded: false,
        clarificationMessage: null
      };
    case "scroll":
      return {
        command: {
          id: commandId,
          type: "scroll",
          direction: "down",
          amount: undefined,
          target: step.target
            ? {
                text: step.target,
                role: null,
                selector: null,
                fieldHint: null,
                name: null,
                id: null,
                ariaLabel: null,
                placeholder: null
              }
            : undefined
        },
        reason: "The plan explicitly asks for a scroll action.",
        confidence: 0.9,
        clarificationNeeded: false,
        clarificationMessage: null
      };
    case "press_key":
      return {
        command: {
          id: commandId,
          type: "press_key",
          key: step.value ?? "Enter",
          altKey: false,
          ctrlKey: false,
          shiftKey: false,
          metaKey: false
        },
        reason: "The plan explicitly asks for a key press.",
        confidence: 0.9,
        clarificationNeeded: false,
        clarificationMessage: null
      };
    case "wait_for_element":
      return {
        command: {
          id: commandId,
          type: "wait_for_element",
          target: {
            text: step.target ?? null,
            role: null,
            selector: null,
            fieldHint: step.fieldHint ?? null,
            name: null,
            id: null,
            ariaLabel: null,
            placeholder: null
          },
          matchType: "either",
          timeoutMs: 4000,
          intervalMs: 300
        },
        reason: "The plan explicitly asks to wait for a target element.",
        confidence: 0.86,
        clarificationNeeded: false,
        clarificationMessage: null
      };
    case "search_youtube":
      if (!step.query) {
        return {
          command: null,
          reason: "The YouTube search step has no query.",
          confidence: 0,
          clarificationNeeded: true,
          clarificationMessage: "I need a YouTube search query before I can continue."
        };
      }

      return {
        command: {
          id: commandId,
          type: "search_youtube",
          query: step.query
        },
        reason: "This is a deterministic YouTube search action.",
        confidence: 0.99,
        clarificationNeeded: false,
        clarificationMessage: null
      };
    case "open_search_result":
      return {
        command: {
          id: commandId,
          type: "open_search_result",
          index: step.index ?? 1
        },
        reason: "This is a deterministic search-result action on the current app page.",
        confidence: 0.95,
        clarificationNeeded: false,
        clarificationMessage: null
      };
    case "search_whatsapp_contact":
      if (!step.contactName) {
        return {
          command: null,
          reason: "The WhatsApp contact search step has no contact name.",
          confidence: 0,
          clarificationNeeded: true,
          clarificationMessage: "I need the contact name before I can search WhatsApp."
        };
      }

      return {
        command: {
          id: commandId,
          type: "search_whatsapp_contact",
          name: step.contactName
        },
        reason: "This is a deterministic WhatsApp contact search action.",
        confidence: 0.96,
        clarificationNeeded: false,
        clarificationMessage: null
      };
    case "open_whatsapp_chat":
      if (!step.contactName) {
        return {
          command: null,
          reason: "The WhatsApp open chat step has no contact name.",
          confidence: 0,
          clarificationNeeded: true,
          clarificationMessage: "I need the contact name before I can open the WhatsApp chat."
        };
      }

      return {
        command: {
          id: commandId,
          type: "open_whatsapp_chat",
          name: step.contactName
        },
        reason: "This is a deterministic WhatsApp chat-opening action.",
        confidence: 0.96,
        clarificationNeeded: false,
        clarificationMessage: null
      };
    case "send_whatsapp_message":
      if (!step.message) {
        return {
          command: null,
          reason: "The WhatsApp send message step has no message body.",
          confidence: 0,
          clarificationNeeded: true,
          clarificationMessage: "I need the WhatsApp message text before I can continue."
        };
      }

      return {
        command: {
          id: commandId,
          type: "send_whatsapp_message",
          message: step.message
        },
        reason: "This is a deterministic WhatsApp message send action.",
        confidence: 0.96,
        clarificationNeeded: false,
        clarificationMessage: null
      };
    case "play_video":
    case "pause_video":
    case "mute_video":
    case "unmute_video":
    case "fullscreen_video":
      return {
        command: {
          id: commandId,
          type: step.type
        } as ExtensionCommand,
        reason: "This is a deterministic YouTube playback control.",
        confidence: 0.98,
        clarificationNeeded: false,
        clarificationMessage: null
      };
    case "seek_forward":
    case "seek_backward":
      return {
        command: {
          id: commandId,
          type: step.type,
          seconds: step.seconds ?? 10
        } as ExtensionCommand,
        reason: "This is a deterministic YouTube seek control.",
        confidence: 0.97,
        clarificationNeeded: false,
        clarificationMessage: null
      };
    case "create_event":
      if (!step.title) {
        return {
          command: null,
          reason: "The calendar event step has no title.",
          confidence: 0,
          clarificationNeeded: true,
          clarificationMessage: "I need an event title before I can create the calendar event."
        };
      }

      return {
        command: {
          id: commandId,
          type: "create_event",
          title: step.title,
          date: step.date ?? null,
          time: step.time ?? null,
          endTime: step.endTime ?? null,
          details: step.details ?? null,
          guestEmail: step.guestEmail ?? null
        },
        reason: "This is a deterministic Google Calendar creation flow.",
        confidence: 0.97,
        clarificationNeeded: false,
        clarificationMessage: null
      };
    case "edit_event":
      return {
        command: {
          id: commandId,
          type: "edit_event",
          title: step.title ?? null,
          details: step.details ?? null
        },
        reason: "This is a deterministic Google Calendar edit action.",
        confidence: 0.92,
        clarificationNeeded: false,
        clarificationMessage: null
      };
    case "delete_event":
      return {
        command: {
          id: commandId,
          type: "delete_event",
          title: step.title ?? null
        },
        reason: "This is a deterministic Google Calendar delete action.",
        confidence: 0.92,
        clarificationNeeded: false,
        clarificationMessage: null
      };
    case "open_date":
      if (!step.date) {
        return {
          command: null,
          reason: "The open date step has no date.",
          confidence: 0,
          clarificationNeeded: true,
          clarificationMessage: "I need a date before I can open it in Google Calendar."
        };
      }

      return {
        command: {
          id: commandId,
          type: "open_date",
          date: step.date
        },
        reason: "This is a deterministic Google Calendar navigation.",
        confidence: 0.97,
        clarificationNeeded: false,
        clarificationMessage: null
      };
    case "add_guest":
      if (!step.guestEmail) {
        return {
          command: null,
          reason: "The add guest step has no email address.",
          confidence: 0,
          clarificationNeeded: true,
          clarificationMessage: "I need the guest email address before I can continue."
        };
      }

      return {
        command: {
          id: commandId,
          type: "add_guest",
          guestEmail: step.guestEmail
        },
        reason: "This is a deterministic Google Calendar guest action.",
        confidence: 0.95,
        clarificationNeeded: false,
        clarificationMessage: null
      };
    case "set_time":
      if (!step.time) {
        return {
          command: null,
          reason: "The set time step has no time value.",
          confidence: 0,
          clarificationNeeded: true,
          clarificationMessage: "I need a time before I can continue."
        };
      }

      return {
        command: {
          id: commandId,
          type: "set_time",
          time: step.time,
          endTime: step.endTime ?? null
        },
        reason: "This is a deterministic Google Calendar time update.",
        confidence: 0.95,
        clarificationNeeded: false,
        clarificationMessage: null
      };
    case "create_doc":
      return {
        command: {
          id: commandId,
          type: "create_doc",
          title: step.title ?? null
        },
        reason: "This is a deterministic Google Docs creation flow.",
        confidence: 0.97,
        clarificationNeeded: false,
        clarificationMessage: null
      };
    case "rename_doc":
      if (!step.title) {
        return {
          command: null,
          reason: "The rename doc step has no target title.",
          confidence: 0,
          clarificationNeeded: true,
          clarificationMessage: "I need the new document title before I can continue."
        };
      }

      return {
        command: {
          id: commandId,
          type: "rename_doc",
          title: step.title
        },
        reason: "This is a deterministic Google Docs rename action.",
        confidence: 0.94,
        clarificationNeeded: false,
        clarificationMessage: null
      };
    case "insert_text":
      if (!step.text) {
        return {
          command: null,
          reason: "The insert text step has no text.",
          confidence: 0,
          clarificationNeeded: true,
          clarificationMessage: "I need the text to insert before I can continue."
        };
      }

      return {
        command: {
          id: commandId,
          type: "insert_text",
          text: step.text
        },
        reason: "This is a deterministic Google Docs text insertion.",
        confidence: 0.94,
        clarificationNeeded: false,
        clarificationMessage: null
      };
    case "select_text":
      if (!step.text) {
        return {
          command: null,
          reason: "The select text step has no target text.",
          confidence: 0,
          clarificationNeeded: true,
          clarificationMessage: "I need the text to select before I can continue."
        };
      }

      return {
        command: {
          id: commandId,
          type: "select_text",
          text: step.text
        },
        reason: "This is a deterministic Google Docs selection action.",
        confidence: 0.9,
        clarificationNeeded: false,
        clarificationMessage: null
      };
    case "apply_format":
      if (!step.format) {
        return {
          command: null,
          reason: "The formatting step has no format value.",
          confidence: 0,
          clarificationNeeded: true,
          clarificationMessage: "I need the format to apply before I can continue."
        };
      }

      return {
        command: {
          id: commandId,
          type: "apply_format",
          format: step.format as Extract<ExtensionCommand, { type: "apply_format" }>["format"]
        },
        reason: "This is a deterministic Google Docs formatting action.",
        confidence: 0.92,
        clarificationNeeded: false,
        clarificationMessage: null
      };
    case "open_doc":
      if (!step.title) {
        return {
          command: null,
          reason: "The open doc step has no title.",
          confidence: 0,
          clarificationNeeded: true,
          clarificationMessage: "I need the document title before I can continue."
        };
      }

      return {
        command: {
          id: commandId,
          type: "open_doc",
          title: step.title
        },
        reason: "This is a deterministic Google Docs navigation on the current page.",
        confidence: 0.92,
        clarificationNeeded: false,
        clarificationMessage: null
      };
    case "open_folder":
      if (!step.folderName) {
        return {
          command: null,
          reason: "The open folder step has no folder name.",
          confidence: 0,
          clarificationNeeded: true,
          clarificationMessage: "I need the folder name before I can continue."
        };
      }

      return {
        command: {
          id: commandId,
          type: "open_folder",
          name: step.folderName
        },
        reason: "This is a deterministic Google Drive folder action.",
        confidence: 0.92,
        clarificationNeeded: false,
        clarificationMessage: null
      };
    case "create_doc_from_drive":
      return {
        command: {
          id: commandId,
          type: "create_doc_from_drive",
          title: step.title ?? null
        },
        reason: "This is a deterministic Google Drive document creation flow.",
        confidence: 0.95,
        clarificationNeeded: false,
        clarificationMessage: null
      };
    case "upload_file":
      return {
        command: {
          id: commandId,
          type: "upload_file",
          fileName: step.fileName ?? null
        },
        reason: "This is a deterministic Google Drive upload request.",
        confidence: 0.9,
        clarificationNeeded: false,
        clarificationMessage: null
      };
    case "rename_file":
      if (!step.newName) {
        return {
          command: null,
          reason: "The rename file step has no new name.",
          confidence: 0,
          clarificationNeeded: true,
          clarificationMessage: "I need the new file name before I can continue."
        };
      }

      return {
        command: {
          id: commandId,
          type: "rename_file",
          currentName: step.currentName ?? null,
          newName: step.newName
        },
        reason: "This is a deterministic Google Drive rename action.",
        confidence: 0.9,
        clarificationNeeded: false,
        clarificationMessage: null
      };
    case "move_file":
      if (!step.folderName) {
        return {
          command: null,
          reason: "The move file step has no destination folder.",
          confidence: 0,
          clarificationNeeded: true,
          clarificationMessage: "I need the destination folder before I can continue."
        };
      }

      return {
        command: {
          id: commandId,
          type: "move_file",
          fileName: step.fileName ?? null,
          folderName: step.folderName
        },
        reason: "This is a deterministic Google Drive move action.",
        confidence: 0.9,
        clarificationNeeded: false,
        clarificationMessage: null
      };
    default:
      return {
        command: null,
        reason: `The step type '${step.type}' is not yet supported by the agent decider.`,
        confidence: 0,
        clarificationNeeded: true,
        clarificationMessage: `I do not know how to execute the step '${step.description}' yet.`
      };
  }
}

async function buildModelDecision(step: ActionStep, stepIndex: number, pageContext: ExtensionPageContext): Promise<NextActionDecision | null> {
  const openai = getOpenAiClient();
  const response = await openai.responses.create({
    model: env.OPENAI_REASONING_MODEL,
    instructions: `
You choose the next browser command for an accessibility-first browser agent.

Rules:
- Prefer deterministic, low-risk commands.
- Only choose from: click, fill_field, select_option, wait_for_element, scroll.
- Use the live page context to ground the choice.
- If the request is too ambiguous, set clarificationNeeded to true.
- Keep reasons concise.
- Confidence must be between 0 and 1.
- Return JSON only.
    `.trim(),
    input: [
      `Current step type: ${step.type}`,
      `Current step description: ${step.description}`,
      `Step target: ${step.target ?? "None"}`,
      `Step field hint: ${step.fieldHint ?? "None"}`,
      `Step value: ${step.value ?? "None"}`,
      `Page context:\n${summarizePageContext(pageContext)}`
    ].join("\n\n"),
    text: {
      format: {
        type: "json_schema",
        name: "next_action_decision",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: [
            "commandType",
            "reason",
            "confidence",
            "clarificationNeeded",
            "clarificationMessage",
            "selector",
            "text",
            "fieldHint",
            "direction"
          ],
          properties: {
            commandType: {
              type: "string",
              enum: ["click", "fill_field", "select_option", "wait_for_element", "scroll"]
            },
            reason: {
              type: "string",
              minLength: 1
            },
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 1
            },
            clarificationNeeded: {
              type: "boolean"
            },
            clarificationMessage: {
              type: ["string", "null"]
            },
            selector: {
              type: ["string", "null"]
            },
            text: {
              type: ["string", "null"]
            },
            fieldHint: {
              type: ["string", "null"]
            },
            direction: {
              type: ["string", "null"],
              enum: ["up", "down", "top", "bottom", null]
            }
          }
        }
      }
    },
    store: false
  });

  const parsed = modelDecisionSchema.parse(JSON.parse(response.output_text));
  if (parsed.clarificationNeeded) {
    return {
      command: null,
      reason: parsed.reason,
      confidence: parsed.confidence,
      clarificationNeeded: true,
      clarificationMessage: parsed.clarificationMessage ?? "I need a bit more detail before I continue."
    };
  }

  const baseTarget: ExtensionTarget = {
    text: parsed.text ?? step.target ?? null,
    role: parsed.commandType === "click" ? "button" : null,
    selector: parsed.selector,
    fieldHint: parsed.fieldHint ?? step.fieldHint ?? null,
    name: null,
    id: null,
    ariaLabel: null,
    placeholder: null
  };

  let command: ExtensionCommand | null = null;
  const id = `agent_model_${Date.now()}_${stepIndex}`;

  switch (parsed.commandType) {
    case "click":
      command = { id, type: "click", target: baseTarget };
      break;
    case "fill_field":
      if (typeof step.value === "string") {
        command = { id, type: "fill_field", target: baseTarget, value: step.value };
      }
      break;
    case "select_option":
      if (typeof step.value === "string") {
        command = { id, type: "select_option", target: baseTarget, value: step.value };
      }
      break;
    case "wait_for_element":
      command = { id, type: "wait_for_element", target: baseTarget, matchType: "either", timeoutMs: 3500, intervalMs: 300 };
      break;
    case "scroll":
      command = { id, type: "scroll", direction: parsed.direction ?? "down", target: parsed.selector || parsed.text ? baseTarget : undefined };
      break;
  }

  return {
    command,
    reason: parsed.reason,
    confidence: parsed.confidence,
    clarificationNeeded: false,
    clarificationMessage: null
  };
}

export async function decideNextAgentCommand(input: DecideNextActionInput): Promise<NextActionDecision> {
  const step = input.plan.steps[input.stepIndex];
  if (!step) {
    return {
      command: null,
      reason: "No pending step is available.",
      confidence: 0,
      clarificationNeeded: true,
      clarificationMessage: "There is no remaining step to execute."
    };
  }

  const deterministicDecision = buildDeterministicDecision(step, input.stepIndex, input.pageContext);
  if (!input.pageContext || deterministicDecision.clarificationNeeded || deterministicDecision.confidence >= 0.75) {
    return deterministicDecision;
  }

  if (step.type !== "click" && step.type !== "type") {
    return deterministicDecision;
  }

  try {
    const modelDecision = await buildModelDecision(step, input.stepIndex, input.pageContext);
    if (modelDecision?.command) {
      return modelDecision;
    }
  } catch {
    // Fall back to deterministic execution if the model decision path fails.
  }

  return deterministicDecision;
}
