import type {
  ActionPlan,
  ActionStep,
  ExtensionCommand,
  ExtensionCommandResult,
  ExtensionHeartbeat,
  ExtensionPageContext,
  Intent
} from "../../../../shared/index";

export type AgentRunStatus =
  | "idle"
  | "running"
  | "waiting_for_extension"
  | "paused"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentStepStatus = "pending" | "running" | "completed" | "blocked" | "skipped";

export type AgentRunStep = {
  index: number;
  type: ActionStep["type"];
  description: string;
  status: AgentStepStatus;
  commandId: string | null;
  commandType: ExtensionCommand["type"] | null;
  startedAt: string | null;
  completedAt: string | null;
  resultOk: boolean | null;
  resultMessage: string | null;
};

export type AgentTaskRun = {
  id: string;
  goal: string;
  intentType: Intent["type"];
  status: AgentRunStatus;
  startedAt: string;
  updatedAt: string;
  currentStepIndex: number | null;
  currentStepDescription: string | null;
  completedSteps: number;
  totalSteps: number;
  retryCount: number;
  blockedReason: string | null;
  stopReason: string | null;
  activePageUrl: string | null;
  activePageTitle: string | null;
  lastObservationSummary: string | null;
  lastDecisionSummary: string | null;
  lastDecisionConfidence: number | null;
  clarificationNeeded: boolean;
  lastCommandId: string | null;
  lastCommandType: ExtensionCommand["type"] | null;
  lastResultOk: boolean | null;
  lastResultMessage: string | null;
  steps: AgentRunStep[];
};

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
  agentRun: AgentTaskRun | null;
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
  updatedAt: null,
  agentRun: null
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

function summarizeObservation(pageContext: ExtensionPageContext | null) {
  if (!pageContext) {
    return null;
  }

  const firstLine = pageContext.textBlocks[0]?.text ?? pageContext.visibleText.slice(0, 140).trim();
  return firstLine || pageContext.title || null;
}

function buildAgentRunSteps(plan: ActionPlan): AgentRunStep[] {
  return plan.steps.map((step, index) => ({
    index,
    type: step.type,
    description: step.description,
    status: "pending",
    commandId: null,
    commandType: null,
    startedAt: null,
    completedAt: null,
    resultOk: null,
    resultMessage: null
  }));
}

function getCurrentAgentStep(run: AgentTaskRun | null) {
  if (!run || run.currentStepIndex === null) {
    return null;
  }

  return run.steps[run.currentStepIndex] ?? null;
}

function syncSessionStateFromAgentRun(run: AgentTaskRun | null) {
  if (!run) {
    return;
  }

  sessionState.currentTask = run.goal;
  sessionState.currentStage = `Agent ${run.status.replace(/_/g, " ")}.`;
  sessionState.nextExpectedAction = run.currentStepDescription;
  sessionState.unresolvedGoals = run.steps
    .filter((step) => step.status === "pending" || step.status === "running")
    .map((step) => step.description);
}

export function getSessionState() {
  return {
    ...sessionState
  };
}

export function getAgentRun() {
  return sessionState.agentRun;
}

export function startAgentRun(intent: Intent, plan: ActionPlan, pageContext: ExtensionPageContext | null) {
  const startedAt = new Date().toISOString();
  const run: AgentTaskRun = {
    id: `agent_run_${Date.now()}`,
    goal: intent.summary,
    intentType: intent.type,
    status: plan.steps.length > 0 ? "running" : "completed",
    startedAt,
    updatedAt: startedAt,
    currentStepIndex: plan.steps.length > 0 ? 0 : null,
    currentStepDescription: plan.steps[0]?.description ?? null,
    completedSteps: 0,
    totalSteps: plan.steps.length,
    retryCount: 0,
    blockedReason: null,
    stopReason: plan.steps.length > 0 ? null : "No executable steps were produced.",
    activePageUrl: pageContext?.url ?? null,
    activePageTitle: pageContext?.title ?? null,
    lastObservationSummary: summarizeObservation(pageContext),
    lastDecisionSummary: null,
    lastDecisionConfidence: null,
    clarificationNeeded: false,
    lastCommandId: null,
    lastCommandType: null,
    lastResultOk: null,
    lastResultMessage: null,
    steps: buildAgentRunSteps(plan)
  };

  sessionState.agentRun = run;
  syncSessionStateFromAgentRun(run);
  stampUpdate();

  return run;
}

export function updateAgentRunStatus(
  status: AgentRunStatus,
  options?: { blockedReason?: string | null; stopReason?: string | null }
) {
  const run = sessionState.agentRun;
  if (!run) {
    return null;
  }

  run.status = status;
  run.blockedReason = options?.blockedReason ?? run.blockedReason;
  run.stopReason = options?.stopReason ?? run.stopReason;
  run.updatedAt = new Date().toISOString();
  syncSessionStateFromAgentRun(run);
  stampUpdate();
  return run;
}

export function incrementAgentRunRetryCount() {
  const run = sessionState.agentRun;
  if (!run) {
    return null;
  }

  run.retryCount += 1;
  run.updatedAt = new Date().toISOString();
  stampUpdate();
  return run;
}

export function recordAgentRunObservation(pageContext: ExtensionPageContext | null) {
  const run = sessionState.agentRun;
  if (!run || !pageContext) {
    return run;
  }

  run.activePageUrl = pageContext.url;
  run.activePageTitle = pageContext.title;
  run.lastObservationSummary = summarizeObservation(pageContext);
  run.updatedAt = new Date().toISOString();
  syncSessionStateFromAgentRun(run);
  stampUpdate();
  return run;
}

export function recordAgentRunDecision(
  summary: string,
  confidence: number,
  clarificationNeeded: boolean
) {
  const run = sessionState.agentRun;
  if (!run) {
    return null;
  }

  run.lastDecisionSummary = summary;
  run.lastDecisionConfidence = confidence;
  run.clarificationNeeded = clarificationNeeded;
  run.updatedAt = new Date().toISOString();
  stampUpdate();
  return run;
}

export function recordAgentRunStepStart(stepIndex: number, command: ExtensionCommand) {
  const run = sessionState.agentRun;
  if (!run) {
    return null;
  }

  const step = run.steps[stepIndex];
  if (!step) {
    return run;
  }

  const startedAt = new Date().toISOString();
  step.status = "running";
  step.commandId = command.id;
  step.commandType = command.type;
  step.startedAt = startedAt;
  step.resultOk = null;
  step.resultMessage = null;

  run.status = "waiting_for_extension";
  run.currentStepIndex = stepIndex;
  run.currentStepDescription = step.description;
  run.lastCommandId = command.id;
  run.lastCommandType = command.type;
  run.updatedAt = startedAt;
  syncSessionStateFromAgentRun(run);
  stampUpdate();

  return step;
}

export function recordAgentRunStepResult(
  stepIndex: number,
  result: ExtensionCommandResult,
  options?: { observation?: ExtensionPageContext | null }
) {
  const run = sessionState.agentRun;
  if (!run) {
    return null;
  }

  const step = run.steps[stepIndex];
  if (!step) {
    return run;
  }

  const completedAt = new Date().toISOString();
  step.status = result.ok ? "completed" : "blocked";
  step.completedAt = completedAt;
  step.resultOk = result.ok;
  step.resultMessage = result.message;

  run.lastResultOk = result.ok;
  run.lastResultMessage = result.message;
  run.updatedAt = completedAt;

  if (options?.observation) {
    run.activePageUrl = options.observation.url;
    run.activePageTitle = options.observation.title;
    run.lastObservationSummary = summarizeObservation(options.observation);
  } else if (result.pageContext) {
    run.activePageUrl = result.pageContext.url;
    run.activePageTitle = result.pageContext.title;
    run.lastObservationSummary = summarizeObservation(result.pageContext);
  }

  if (!result.ok) {
    run.status = "blocked";
    run.blockedReason = result.message;
    run.stopReason = result.message;
    run.currentStepIndex = stepIndex;
    run.currentStepDescription = step.description;
    syncSessionStateFromAgentRun(run);
    stampUpdate();
    return run;
  }

  run.completedSteps = run.steps.filter((candidate) => candidate.status === "completed").length;

  const nextStep = run.steps.find((candidate) => candidate.status === "pending");
  if (!nextStep) {
    run.status = "completed";
    run.currentStepIndex = null;
    run.currentStepDescription = null;
    run.stopReason = "All planned steps completed.";
  } else {
    run.status = "running";
    run.currentStepIndex = nextStep.index;
    run.currentStepDescription = nextStep.description;
  }

  syncSessionStateFromAgentRun(run);
  stampUpdate();
  return run;
}

export function clearAgentRun() {
  sessionState.agentRun = null;
  stampUpdate();
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
  if (sessionState.agentRun) {
    sessionState.agentRun.activePageUrl = heartbeat.activeTab.url;
    sessionState.agentRun.activePageTitle = heartbeat.activeTab.title;
    sessionState.agentRun.updatedAt = new Date().toISOString();
  }
  stampUpdate();
}

export function recordSessionPageContext(pageContext: ExtensionPageContext) {
  sessionState.lastPageContext = pageContext;
  sessionState.activeWebsite = websiteFromUrl(pageContext.url) ?? sessionState.activeWebsite;
  recordAgentRunObservation(pageContext);
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
    ...pageContext.textBlocks.slice(0, 12).map((block) => `- ${block.text}`),
    "Field candidates:",
    ...pageContext.fieldElements
      .slice(0, 10)
      .map((field) => `- ${field.label ?? field.placeholder ?? field.ariaLabel ?? field.name ?? field.id ?? field.tag}`),
    "Form summaries:",
    ...pageContext.forms
      .slice(0, 6)
      .map(
        (form) =>
          `- fields: ${form.fieldLabels.slice(0, 5).join(", ") || "none"} | submit: ${form.submitLabels.slice(0, 3).join(", ") || "none"}`
      )
  ].join("\n");
}

export function buildSessionStateSummary() {
  const lines = [
    `Current task: ${sessionState.currentTask ?? "None"}`,
    `Active website: ${sessionState.activeWebsite ?? "Unknown"}`,
    `Current stage: ${sessionState.currentStage ?? "Unknown"}`,
    `Next expected action: ${sessionState.nextExpectedAction ?? "None"}`,
    `Unresolved goals: ${sessionState.unresolvedGoals.length ? sessionState.unresolvedGoals.join(" | ") : "None"}`
  ];

  const currentAgentStep = getCurrentAgentStep(sessionState.agentRun);
  if (sessionState.agentRun) {
    lines.push(`Agent run status: ${sessionState.agentRun.status}`);
    lines.push(`Agent progress: ${sessionState.agentRun.completedSteps}/${sessionState.agentRun.totalSteps}`);
    lines.push(`Agent current step: ${currentAgentStep?.description ?? "None"}`);
    lines.push(`Agent last observation: ${sessionState.agentRun.lastObservationSummary ?? "None"}`);
  }

  return lines.join("\n");
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
