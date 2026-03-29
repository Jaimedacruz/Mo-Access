import { actionPlanSchema, type ActionPlan, type ActionStep, type Intent } from "../../../../shared/index";

function slugifyTarget(input: string) {
  return `/${input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}`;
}

function resolveNavigationTarget(intent: Intent) {
  if (intent.currentPage) {
    return undefined;
  }

  const candidate = intent.page ?? intent.target ?? "";

  if (!candidate) {
    return undefined;
  }

  if (candidate.startsWith("/") || candidate.startsWith("http")) {
    return candidate;
  }

  return slugifyTarget(candidate);
}

function buildGmailComposeUrl(intent: Intent) {
  const recipient = intent.message?.recipient?.trim();
  const subject = intent.message?.subject?.trim() ?? "";
  const body = intent.message?.body?.trim() ?? "";

  if (!recipient) {
    return null;
  }

  const url = new URL("https://mail.google.com/mail/");
  url.searchParams.set("view", "cm");
  url.searchParams.set("fs", "1");
  url.searchParams.set("tf", "1");
  url.searchParams.set("to", recipient);

  if (subject) {
    url.searchParams.set("su", subject);
  }

  if (body) {
    url.searchParams.set("body", body);
  }

  return url.toString();
}

function hasCompleteEmailRecipient(intent: Intent) {
  const recipient = intent.message?.recipient?.trim();
  if (!recipient) {
    return false;
  }

  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(recipient);
}

function specialCommand(intent: Intent) {
  return intent.fields["__app_command"] ?? null;
}

function specialValue(intent: Intent, key: string) {
  const value = intent.fields[key];
  return value && value.trim() ? value.trim() : undefined;
}

function maybeBuildGoogleAppControllerSteps(intent: Intent) {
  const command = specialCommand(intent);
  if (!command) {
    return null;
  }

  switch (command) {
    case "search_youtube":
      return [
        {
          type: "search_youtube",
          description: `Search YouTube for ${specialValue(intent, "query") ?? "the requested topic"}.`,
          query: specialValue(intent, "query"),
          requiresConfirmation: false
        }
      ] satisfies ActionStep[];
    case "search_whatsapp_contact":
      return [
        ...(!intent.currentPage
          ? [
              {
                type: "navigate",
                description: "Open WhatsApp Web.",
                target: "https://web.whatsapp.com/",
                requiresConfirmation: false
              } satisfies ActionStep
            ]
          : []),
        {
          type: "search_whatsapp_contact",
          description: `Search WhatsApp for ${specialValue(intent, "contactName") ?? "the requested contact"}.`,
          contactName: specialValue(intent, "contactName"),
          requiresConfirmation: false
        }
      ] satisfies ActionStep[];
    case "open_whatsapp_chat":
      return [
        ...(!intent.currentPage
          ? [
              {
                type: "navigate",
                description: "Open WhatsApp Web.",
                target: "https://web.whatsapp.com/",
                requiresConfirmation: false
              } satisfies ActionStep
            ]
          : []),
        {
          type: "search_whatsapp_contact",
          description: `Search WhatsApp for ${specialValue(intent, "contactName") ?? "the requested contact"}.`,
          contactName: specialValue(intent, "contactName"),
          requiresConfirmation: false
        },
        {
          type: "open_whatsapp_chat",
          description: `Open the WhatsApp chat with ${specialValue(intent, "contactName") ?? "the requested contact"}.`,
          contactName: specialValue(intent, "contactName"),
          requiresConfirmation: false
        }
      ] satisfies ActionStep[];
    case "send_whatsapp_message":
      return [
        ...(!intent.currentPage
          ? [
              {
                type: "navigate",
                description: "Open WhatsApp Web.",
                target: "https://web.whatsapp.com/",
                requiresConfirmation: false
              } satisfies ActionStep
            ]
          : []),
        ...(specialValue(intent, "contactName")
          ? [
              {
                type: "search_whatsapp_contact",
                description: `Search WhatsApp for ${specialValue(intent, "contactName")}.`,
                contactName: specialValue(intent, "contactName"),
                requiresConfirmation: false
              } satisfies ActionStep,
              {
                type: "open_whatsapp_chat",
                description: `Open the WhatsApp chat with ${specialValue(intent, "contactName")}.`,
                contactName: specialValue(intent, "contactName"),
                requiresConfirmation: false
              } satisfies ActionStep
            ]
          : []),
        {
          type: "send_whatsapp_message",
          description: "Send the WhatsApp message in the current chat.",
          message: specialValue(intent, "message"),
          requiresConfirmation: false
        }
      ] satisfies ActionStep[];
    case "open_search_result":
      return [
        {
          type: "open_search_result",
          description: `Open search result ${specialValue(intent, "index") ?? "1"}.`,
          index: Number.parseInt(specialValue(intent, "index") ?? "1", 10),
          requiresConfirmation: false
        }
      ] satisfies ActionStep[];
    case "play_video":
    case "pause_video":
    case "mute_video":
    case "unmute_video":
    case "fullscreen_video":
      return [
        {
          type: command,
          description: intent.summary,
          requiresConfirmation: false
        }
      ] satisfies ActionStep[];
    case "seek_forward":
    case "seek_backward":
      return [
        {
          type: command,
          description: intent.summary,
          seconds: Number.parseInt(specialValue(intent, "seconds") ?? "10", 10),
          requiresConfirmation: false
        }
      ] satisfies ActionStep[];
    case "create_event":
      return [
        {
          type: "create_event",
          description: intent.summary,
          title: specialValue(intent, "title"),
          date: specialValue(intent, "date"),
          time: specialValue(intent, "time"),
          requiresConfirmation: false
        },
        {
          type: "click",
          description: "Click the Save button in Google Calendar.",
          target: "save button",
          requiresConfirmation: false
        }
      ] satisfies ActionStep[];
    case "edit_event":
      return [
        {
          type: "edit_event",
          description: intent.summary,
          title: specialValue(intent, "title"),
          details: specialValue(intent, "details"),
          requiresConfirmation: false
        }
      ] satisfies ActionStep[];
    case "delete_event":
      return [
        {
          type: "delete_event",
          description: intent.summary,
          requiresConfirmation: false
        }
      ] satisfies ActionStep[];
    case "open_date":
      return [
        {
          type: "open_date",
          description: intent.summary,
          date: specialValue(intent, "date"),
          requiresConfirmation: false
        }
      ] satisfies ActionStep[];
    case "add_guest":
      return [
        {
          type: "add_guest",
          description: intent.summary,
          guestEmail: specialValue(intent, "guestEmail"),
          requiresConfirmation: false
        }
      ] satisfies ActionStep[];
    case "set_time":
      return [
        {
          type: "set_time",
          description: intent.summary,
          time: specialValue(intent, "time"),
          endTime: specialValue(intent, "endTime"),
          requiresConfirmation: false
        }
      ] satisfies ActionStep[];
    case "create_doc":
      return [
        {
          type: "create_doc",
          description: intent.summary,
          title: specialValue(intent, "title"),
          requiresConfirmation: false
        },
        ...(specialValue(intent, "title")
          ? [
              {
                type: "rename_doc",
                description: `Rename the new Google Doc to ${specialValue(intent, "title")}.`,
                title: specialValue(intent, "title"),
                requiresConfirmation: false
              } satisfies ActionStep
            ]
          : [])
      ] satisfies ActionStep[];
    case "rename_doc":
      return [
        {
          type: "rename_doc",
          description: intent.summary,
          title: specialValue(intent, "title"),
          requiresConfirmation: false
        }
      ] satisfies ActionStep[];
    case "insert_text":
      return [
        {
          type: "insert_text",
          description: intent.summary,
          text: specialValue(intent, "text"),
          requiresConfirmation: false
        }
      ] satisfies ActionStep[];
    case "select_text":
      return [
        {
          type: "select_text",
          description: intent.summary,
          text: specialValue(intent, "text"),
          requiresConfirmation: false
        }
      ] satisfies ActionStep[];
    case "apply_format":
      return [
        {
          type: "apply_format",
          description: intent.summary,
          format: specialValue(intent, "format"),
          requiresConfirmation: false
        }
      ] satisfies ActionStep[];
    case "open_doc":
      return [
        {
          type: "open_doc",
          description: intent.summary,
          title: specialValue(intent, "title"),
          requiresConfirmation: false
        }
      ] satisfies ActionStep[];
    case "open_folder":
      return [
        {
          type: "open_folder",
          description: intent.summary,
          folderName: specialValue(intent, "folderName"),
          requiresConfirmation: false
        }
      ] satisfies ActionStep[];
    case "create_doc_from_drive":
      return [
        {
          type: "create_doc_from_drive",
          description: intent.summary,
          title: specialValue(intent, "title"),
          requiresConfirmation: false
        },
        ...(specialValue(intent, "title")
          ? [
              {
                type: "rename_doc",
                description: `Rename the new Google Doc to ${specialValue(intent, "title")}.`,
                title: specialValue(intent, "title"),
                requiresConfirmation: false
              } satisfies ActionStep
            ]
          : [])
      ] satisfies ActionStep[];
    case "upload_file":
      return [
        {
          type: "upload_file",
          description: intent.summary,
          fileName: specialValue(intent, "fileName"),
          requiresConfirmation: false
        }
      ] satisfies ActionStep[];
    case "rename_file":
      return [
        {
          type: "rename_file",
          description: intent.summary,
          currentName: specialValue(intent, "currentName"),
          newName: specialValue(intent, "newName"),
          requiresConfirmation: false
        }
      ] satisfies ActionStep[];
    case "move_file":
      return [
        {
          type: "move_file",
          description: intent.summary,
          fileName: specialValue(intent, "fileName"),
          folderName: specialValue(intent, "folderName"),
          requiresConfirmation: false
        }
      ] satisfies ActionStep[];
    default:
      return null;
  }
}

export function buildActionPlan(intent: Intent): ActionPlan {
  const specialSteps = maybeBuildGoogleAppControllerSteps(intent);
  const steps: ActionStep[] = specialSteps ? [...specialSteps] : [];
  const notes = [...intent.notes];
  const navigationTarget = resolveNavigationTarget(intent);

  if (specialSteps) {
    return actionPlanSchema.parse({
      summary: intent.summary,
      steps,
      requiresConfirmation: false,
      safetyLevel: intent.safetyLevel,
      confirmationMessage: undefined,
      notes
    });
  }

  switch (intent.type) {
    case "open_page": {
      if (navigationTarget) {
        steps.push({
          type: "navigate",
          description: `Navigate to ${navigationTarget}.`,
          target: navigationTarget,
          requiresConfirmation: false
        });

        if (
          intent.notes.some((note) => /extract the visible result and answer the user's question/i.test(note)) ||
          /\breturn the answer\b|\bgive me a summary\b|\bsummar/i.test(intent.summary)
        ) {
          steps.push({
            type: "extract_text",
            description: "Read the visible app results and answer the user's question.",
            target: "visible-app-results",
            requiresConfirmation: false
          });
        }
      } else if (intent.target) {
        steps.push({
          type: "search",
          description: `Search for ${intent.target}.`,
          query: intent.target,
          requiresConfirmation: false
        });
        notes.push("A direct page target was not clear, so the planner chose a safe search step.");
      } else {
        steps.push({
          type: "search",
          description: "Search for the requested destination.",
          query: intent.summary,
          requiresConfirmation: false
        });
        notes.push("The request did not specify a concrete destination.");
      }

      break;
    }
    case "fill_form": {
      if (navigationTarget) {
        steps.push({
          type: "navigate",
          description: `Open ${navigationTarget} before filling fields.`,
          target: navigationTarget,
          requiresConfirmation: false
        });
      }

      const fields = Object.entries(intent.fields);
      if (fields.length === 0) {
        notes.push("No actual field values were provided, so the plan pauses before typing.");
      }

      for (const [fieldHint, value] of fields) {
        steps.push({
          type: "type",
          description: `Type the provided value into the ${fieldHint} field.`,
          fieldHint,
          value,
          requiresConfirmation: false
        });
      }

      if (intent.actionTarget) {
        steps.push({
          type: "click",
          description: `Click the ${intent.actionTarget}.`,
          target: intent.actionTarget,
          requiresConfirmation: false
        });
      } else {
        notes.push("No follow-up button or control was specified, so the plan stops after typing.");
      }
      break;
    }
    case "read_page": {
      if (navigationTarget) {
        steps.push({
          type: "navigate",
          description: `Open ${navigationTarget}.`,
          target: navigationTarget,
          requiresConfirmation: false
        });
      }

      steps.push({
        type: "extract_text",
        description: "Extract the visible page text so it can be read aloud later.",
        target: "visible-page-content",
        requiresConfirmation: false
      });

      if (intent.notes.length === 0) {
        notes.push("This plan focuses on extracting readable page content from the current page safely.");
      }
      break;
    }
    case "compose_message": {
      const gmailComposeUrl =
        intent.target?.toLowerCase().includes("gmail") || intent.page?.toLowerCase().includes("gmail")
          ? buildGmailComposeUrl(intent)
          : null;
      const hasDeliverableRecipient = hasCompleteEmailRecipient(intent);

      if (gmailComposeUrl) {
        steps.push({
          type: "navigate",
          description: "Open Gmail with the drafted message prefilled.",
          target: gmailComposeUrl,
          requiresConfirmation: false
        });

        if ((intent.message?.subject || intent.message?.body) && hasDeliverableRecipient) {
          steps.push({
            type: "click",
            description: "Click the Send button in Gmail.",
            target: "send button",
            requiresConfirmation: false
          });
        } else if (!hasDeliverableRecipient) {
          notes.push("The Gmail draft will open, but the recipient address needs to be completed before sending.");
        } else {
          notes.push("The email content is missing, so the plan opens Gmail but does not send a blank message.");
        }

        notes.push("This flow relies on an active Gmail session in the browser.");
        break;
      }

      if (navigationTarget) {
        steps.push({
          type: "navigate",
          description: `Open ${navigationTarget} before drafting the message.`,
          target: navigationTarget,
          requiresConfirmation: false
        });
      }

      if (intent.message?.recipient) {
        steps.push({
          type: "type",
          description: "Type the recipient email address into the To field.",
          fieldHint: "to",
          value: intent.message.recipient,
          requiresConfirmation: false
        });
      } else {
        notes.push("The recipient email address is missing.");
      }

      if (intent.message?.subject) {
        steps.push({
          type: "type",
          description: "Type the email subject.",
          fieldHint: "subject",
          value: intent.message.subject,
          requiresConfirmation: false
        });
      }

      if (intent.message?.body) {
        steps.push({
          type: "type",
          description: "Type the email body into the message field.",
          fieldHint: "message body",
          value: intent.message.body,
          requiresConfirmation: false
        });
      } else {
        notes.push("The message body is missing.");
      }

      if (intent.message?.recipient && intent.message?.body) {
        steps.push({
          type: "click",
          description: "Click the Send button.",
          target: "send button",
          requiresConfirmation: false
        });
      }
      break;
    }
    case "search_web": {
      steps.push({
        type: "search",
        description: `Search the web for ${intent.query ?? intent.summary}.`,
        query: intent.query ?? intent.summary,
        requiresConfirmation: false
      });

      if (
        intent.notes.some((note) => /extract the result and answer the user's question/i.test(note)) ||
        /\breturn the answer\b|\bwhat is\b|\bwho is\b|\bhow old\b|\bhow much\b|\bwhen\b|\bwhere\b/i.test(intent.summary)
      ) {
        steps.push({
          type: "extract_text",
          description: "Read the visible search results and answer the user's question.",
          target: "visible-search-results",
          requiresConfirmation: false
        });
      }
      break;
    }
  }

  return actionPlanSchema.parse({
    summary: intent.summary,
    steps,
    requiresConfirmation: false,
    safetyLevel: intent.safetyLevel,
    confirmationMessage: undefined,
    notes
  });
}
