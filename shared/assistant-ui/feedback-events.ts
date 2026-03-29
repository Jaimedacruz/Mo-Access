import type { ActionPlan, ActionStep, ExtensionCommandResult, FeedbackEventType } from "../index";

export type FeedbackEvent = {
  id: string;
  type: FeedbackEventType;
  message: string;
  shouldSpeak: boolean;
  priority: "normal" | "high";
};

function firstStepOfType(plan: ActionPlan, type: ActionStep["type"]) {
  return plan.steps.find((step) => step.type === type);
}

export function buildPlanFeedbackEvent(plan: ActionPlan): FeedbackEvent {
  if (plan.requiresConfirmation) {
    return {
      id: `feedback-${Date.now()}`,
      type: "awaiting_confirmation",
      message: plan.confirmationMessage ?? "I am ready to continue. Please confirm.",
      shouldSpeak: true,
      priority: "high"
    };
  }

  if (firstStepOfType(plan, "search")) {
    return {
      id: `feedback-${Date.now()}`,
      type: "progress",
      message: "Searching the web now.",
      shouldSpeak: true,
      priority: "normal"
    };
  }

  if (firstStepOfType(plan, "navigate")) {
    return {
      id: `feedback-${Date.now()}`,
      type: "progress",
      message: "Opening the page now.",
      shouldSpeak: true,
      priority: "normal"
    };
  }

  if (firstStepOfType(plan, "extract_text")) {
    return {
      id: `feedback-${Date.now()}`,
      type: "progress",
      message: "Reading the current page now.",
      shouldSpeak: true,
      priority: "normal"
    };
  }

  if (firstStepOfType(plan, "type")) {
    return {
      id: `feedback-${Date.now()}`,
      type: "progress",
      message: "Filling the form now.",
      shouldSpeak: true,
      priority: "normal"
    };
  }

  if (firstStepOfType(plan, "click")) {
    return {
      id: `feedback-${Date.now()}`,
      type: "progress",
      message: "Continuing on the current page now.",
      shouldSpeak: false,
      priority: "normal"
    };
  }

  return {
    id: `feedback-${Date.now()}`,
    type: "info",
    message: "Preparing your browser actions now.",
    shouldSpeak: false,
    priority: "normal"
  };
}

export function buildQueueFeedbackEvent(queuedCount: number, extensionConnected: boolean): FeedbackEvent {
  if (!extensionConnected) {
    return {
      id: `feedback-${Date.now()}`,
      type: "warning",
      message: "The extension is offline. Open it to continue.",
      shouldSpeak: true,
      priority: "high"
    };
  }

  return {
    id: `feedback-${Date.now()}`,
    type: "success",
    message: `Sent ${queuedCount} browser action${queuedCount === 1 ? "" : "s"} to the extension.`,
    shouldSpeak: false,
    priority: "normal"
  };
}

export function buildProcessingFeedbackEvent(message: string): FeedbackEvent {
  return {
    id: `feedback-${Date.now()}`,
    type: "info",
    message,
    shouldSpeak: false,
    priority: "normal"
  };
}

export function buildErrorFeedbackEvent(message: string): FeedbackEvent {
  return {
    id: `feedback-${Date.now()}`,
    type: "error",
    message,
    shouldSpeak: true,
    priority: "high"
  };
}

function truncate(text: string, maxLength: number) {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}...`;
}

function describeMatch(result: ExtensionCommandResult) {
  const matchText =
    result.matched?.ariaLabel ??
    result.matched?.label ??
    result.matched?.text ??
    result.matched?.placeholder ??
    result.matched?.name ??
    result.matched?.id;

  return matchText ? truncate(matchText, 70) : null;
}

function describeFilledFields(result: ExtensionCommandResult) {
  const filled = Array.isArray(result.data?.filled)
    ? result.data.filled.filter((value): value is string => typeof value === "string")
    : [];

  if (filled.length === 0) {
    return null;
  }

  if (filled.length === 1) {
    return filled[0];
  }

  return `${filled.slice(0, -1).join(", ")} and ${filled[filled.length - 1]}`;
}

export function buildExecutionFeedbackEvent(result: ExtensionCommandResult): FeedbackEvent {
  if (!result.ok) {
    return {
      id: `feedback-${Date.now()}`,
      type: "error",
      message: result.message,
      shouldSpeak: true,
      priority: "high"
    };
  }

  if ((result.action === "extract_text_blocks" || result.action === "get_page_context") && result.pageContext) {
    const firstText = result.pageContext.textBlocks[0]?.text ?? result.pageContext.visibleText;
    return {
      id: `feedback-${Date.now()}`,
      type: "success",
      message: firstText ? `I found this on the page: ${truncate(firstText, 120)}` : "I found readable page content.",
      shouldSpeak: true,
      priority: "normal"
    };
  }

  if (result.action === "click") {
    const match = describeMatch(result);
    return {
      id: `feedback-${Date.now()}`,
      type: "success",
      message: match ? `I found and activated ${match}.` : "I found the button and activated it.",
      shouldSpeak: true,
      priority: "normal"
    };
  }

  if (result.action === "fill_field" || result.action === "fill_form") {
    return {
      id: `feedback-${Date.now()}`,
      type: "success",
      message: "I filled the requested field.",
      shouldSpeak: false,
      priority: "normal"
    };
  }

  if (result.action === "navigate") {
    return {
      id: `feedback-${Date.now()}`,
      type: "success",
      message: result.message,
      shouldSpeak: false,
      priority: "normal"
    };
  }

  return {
    id: `feedback-${Date.now()}`,
    type: "success",
    message: result.message,
    shouldSpeak: false,
    priority: "normal"
  };
}

export function buildExecutionResultMessage(result: ExtensionCommandResult) {
  if (!result.ok) {
    return {
      content: result.message,
      tone: "error" as const
    };
  }

  if ((result.action === "extract_text_blocks" || result.action === "get_page_context") && result.pageContext) {
    const preview = result.pageContext.textBlocks
      .slice(0, 3)
      .map((block) => block.text)
      .filter(Boolean)
      .join(" ");

    return {
      content: preview ? `I found this on the page: ${truncate(preview, 220)}` : "I found readable page content.",
      tone: "default" as const
    };
  }

  if (result.action === "click") {
    const match = describeMatch(result);

    return {
      content: match ? `I found and activated ${match}.` : result.message,
      tone: "default" as const
    };
  }

  if (result.action === "fill_field") {
    const match = describeMatch(result);

    return {
      content: match ? `I filled ${match}.` : "I filled the requested field.",
      tone: "default" as const
    };
  }

  if (result.action === "fill_form") {
    const fields = describeFilledFields(result);

    return {
      content: fields ? `I filled ${fields}.` : "I filled the requested form fields.",
      tone: "default" as const
    };
  }

  if (result.action === "navigate") {
    const destination = typeof result.data?.url === "string" ? result.data.url : null;

    return {
      content: destination ? `I opened ${destination}.` : result.message,
      tone: "default" as const
    };
  }

  return {
    content: result.message,
    tone: "default" as const
  };
}
