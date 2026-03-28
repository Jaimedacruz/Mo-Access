import { actionPlanSchema, type ActionPlan, type ActionStep, type Intent } from "../../../../shared/index";

function slugifyTarget(input: string) {
  return `/${input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}`;
}

function resolveNavigationTarget(intent: Intent) {
  const candidate = intent.page ?? intent.target ?? "";

  if (!candidate) {
    return undefined;
  }

  if (candidate.startsWith("/") || candidate.startsWith("http")) {
    return candidate;
  }

  return slugifyTarget(candidate);
}

function confirmationStep(message: string): ActionStep {
  return {
    type: "confirm",
    description: message,
    message,
    requiresConfirmation: true
  };
}

export function buildActionPlan(intent: Intent): ActionPlan {
  const steps: ActionStep[] = [];
  const notes = [...intent.notes];
  const navigationTarget = resolveNavigationTarget(intent);
  const confirmationMessage =
    intent.confirmationMessage ??
    (intent.requiresConfirmation ? "Review this action before anything is submitted or sent." : undefined);

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

      steps.push(
        confirmationStep(
          confirmationMessage ?? "Review the filled form before any submit action is allowed."
        )
      );
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
        notes.push("This iteration prepares text extraction; a later extension can speak the extracted content aloud.");
      }
      break;
    }
    case "compose_message": {
      if (navigationTarget) {
        steps.push({
          type: "navigate",
          description: `Open ${navigationTarget} before drafting the message.`,
          target: navigationTarget,
          requiresConfirmation: false
        });
      }

      steps.push({
        type: "compose_message",
        description: "Draft the requested message without sending it.",
        recipient: intent.message?.recipient ?? undefined,
        subject: intent.message?.subject ?? undefined,
        body: intent.message?.body ?? undefined,
        requiresConfirmation: true
      });

      steps.push(
        confirmationStep(
          confirmationMessage ?? "Review the drafted message before any send action is allowed."
        )
      );
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
    requiresConfirmation: intent.requiresConfirmation,
    safetyLevel: intent.safetyLevel,
    confirmationMessage,
    notes
  });
}
