import type {
  ActionPlan,
  ExtensionCommand,
  ExtensionCommandResult,
  ExtensionHeartbeat,
  ExtensionPageContext,
  Intent
} from "../../../../shared/index";

type AssistantSessionState = {
  currentTask: string | null;
  activeWebsite: string | null;
  lastIntent: Intent | null;
  lastPlan: ActionPlan | null;
  lastCommand: ExtensionCommand | null;
  lastResult: ExtensionCommandResult | null;
  lastPageContext: ExtensionPageContext | null;
  unresolvedGoals: string[];
  currentStage: string | null;
  nextExpectedAction: string | null;
  updatedAt: string | null;
};

const sessionState: AssistantSessionState = {
  currentTask: null,
  activeWebsite: null,
  lastIntent: null,
  lastPlan: null,
  lastCommand: null,
  lastResult: null,
  lastPageContext: null,
  unresolvedGoals: [],
  currentStage: null,
  nextExpectedAction: null,
  updatedAt: null
};

function stampUpdate() {
  sessionState.updatedAt = new Date().toISOString();
}

function websiteFromUrl(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function deriveUnresolvedGoals(plan: ActionPlan) {
  return plan.steps.map((step) => step.description);
}

function deriveStageFromResult(result: ExtensionCommandResult, command: ExtensionCommand | null) {
  if (result.ok) {
    return command ? `${command.type} completed: ${result.message}` : result.message;
  }

  return command ? `${command.type} blocked: ${result.message}` : `Blocked: ${result.message}`;
}

export function getSessionState() {
  return {
    ...sessionState
  };
}

export function recordSessionIntentPlan(intent: Intent, plan: ActionPlan, pageContext: ExtensionPageContext | null) {
  sessionState.currentTask = intent.summary;
  sessionState.lastIntent = intent;
  sessionState.lastPlan = plan;
  sessionState.unresolvedGoals = deriveUnresolvedGoals(plan);
  sessionState.nextExpectedAction = sessionState.unresolvedGoals[0] ?? null;
  sessionState.currentStage = `Planned ${plan.steps.length} browser step${plan.steps.length === 1 ? "" : "s"}.`;
  sessionState.activeWebsite =
    websiteFromUrl(pageContext?.url) ??
    (intent.page ? websiteFromUrl(intent.page) ?? intent.page : null) ??
    (intent.target ? websiteFromUrl(intent.target) ?? intent.target : null);

  if (pageContext) {
    sessionState.lastPageContext = pageContext;
    sessionState.activeWebsite = websiteFromUrl(pageContext.url) ?? sessionState.activeWebsite;
  }

  stampUpdate();
}

export function recordSessionHeartbeat(heartbeat: ExtensionHeartbeat) {
  sessionState.activeWebsite =
    websiteFromUrl(heartbeat.activeTab.url) ?? sessionState.activeWebsite;
  stampUpdate();
}

export function recordSessionPageContext(pageContext: ExtensionPageContext) {
  sessionState.lastPageContext = pageContext;
  sessionState.activeWebsite = websiteFromUrl(pageContext.url) ?? sessionState.activeWebsite;
  stampUpdate();
}

export function recordSessionCommand(command: ExtensionCommand) {
  sessionState.lastCommand = command;
  sessionState.currentStage = `Queued ${command.type} for execution.`;
  stampUpdate();
}

export function recordSessionResult(result: ExtensionCommandResult, command: ExtensionCommand | null) {
  sessionState.lastResult = result;
  sessionState.lastCommand = command ?? sessionState.lastCommand;
  sessionState.currentStage = deriveStageFromResult(result, command);

  if (result.pageContext) {
    sessionState.lastPageContext = result.pageContext;
    sessionState.activeWebsite = websiteFromUrl(result.pageContext.url) ?? sessionState.activeWebsite;
  }

  if (result.ok) {
    const nextGoals = [...sessionState.unresolvedGoals];
    nextGoals.shift();
    sessionState.unresolvedGoals = nextGoals;
  } else if (!sessionState.unresolvedGoals.includes(result.message)) {
    sessionState.unresolvedGoals = [result.message, ...sessionState.unresolvedGoals];
  }

  sessionState.nextExpectedAction = sessionState.unresolvedGoals[0] ?? null;
  stampUpdate();
}

function summarizePlan(plan: ActionPlan | null) {
  if (!plan) {
    return "None";
  }

  return [
    `Summary: ${plan.summary}`,
    "Steps:",
    ...plan.steps.slice(0, 6).map((step) => `- ${step.description}`)
  ].join("\n");
}

function summarizeIntent(intent: Intent | null) {
  if (!intent) {
    return "None";
  }

  return `Type: ${intent.type}\nSummary: ${intent.summary}`;
}

function summarizeResult(result: ExtensionCommandResult | null, command: ExtensionCommand | null) {
  if (!result) {
    return "None";
  }

  return [
    `Command: ${command?.type ?? "unknown"}`,
    `Action: ${result.action}`,
    `Success: ${result.ok ? "yes" : "no"}`,
    `Message: ${result.message}`
  ].join("\n");
}

function summarizePageContext(pageContext: ExtensionPageContext | null) {
  if (!pageContext) {
    return "None";
  }

  return [
    `Title: ${pageContext.title}`,
    `URL: ${pageContext.url}`,
    "Visible text sample:",
    ...pageContext.textBlocks.slice(0, 12).map((block) => `- ${block.text}`)
  ].join("\n");
}

export function buildSessionStateSummary() {
  return [
    `Current task: ${sessionState.currentTask ?? "None"}`,
    `Active website: ${sessionState.activeWebsite ?? "Unknown"}`,
    `Current stage: ${sessionState.currentStage ?? "Unknown"}`,
    `Next expected action: ${sessionState.nextExpectedAction ?? "None"}`,
    `Unresolved goals: ${sessionState.unresolvedGoals.length ? sessionState.unresolvedGoals.join(" | ") : "None"}`
  ].join("\n");
}

export function buildSessionContextForParser() {
  return {
    lastIntent: sessionState.lastIntent,
    lastPlan: sessionState.lastPlan,
    lastExtensionResult: sessionState.lastResult,
    currentPageContext: sessionState.lastPageContext,
    sessionStateSummary: buildSessionStateSummary(),
    lastIntentSummary: summarizeIntent(sessionState.lastIntent),
    lastPlanSummary: summarizePlan(sessionState.lastPlan),
    lastExtensionResultSummary: summarizeResult(sessionState.lastResult, sessionState.lastCommand),
    currentPageContextSummary: summarizePageContext(sessionState.lastPageContext)
  };
}
