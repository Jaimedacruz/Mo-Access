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

export function buildActionPlan(intent: Intent): ActionPlan {
  const steps: ActionStep[] = [];
  const notes = [...intent.notes];
  const navigationTarget = resolveNavigationTarget(intent);

  switch (intent.type) {
    case "open_page": {
      if (navigationTarget) {
        steps.push({
          type: "navigate",
          description: `Navigate to ${navigationTarget}.`,
          target: navigationTarget,
          requiresConfirmation: false
        });
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

      if (gmailComposeUrl) {
        steps.push({
          type: "navigate",
          description: "Open Gmail with the drafted message prefilled.",
          target: gmailComposeUrl,
          requiresConfirmation: false
        });

        steps.push({
          type: "click",
          description: "Click the Send button in Gmail.",
          target: "send button",
          requiresConfirmation: false
        });

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
