import type {
  ActionPlan,
  ActionStep,
  ExtensionCommand,
  ExtensionCommandResult,
  ExtensionElementMatch,
  ExtensionPageContext,
  Intent
} from "../../../../shared/index";
import {
  enqueueExtensionCommand,
  getExtensionBridgeState,
  getLastExtensionPageContext,
  requestFreshPageContext,
  waitForExtensionResult
} from "./extension-bridge-service";
import { decideNextAgentCommand } from "./next-action-service";
import {
  getAgentRun,
  incrementAgentRunRetryCount,
  recordAgentRunDecision,
  recordAgentRunObservation,
  recordAgentRunStepResult,
  recordAgentRunStepStart,
  recordSessionCommand,
  startAgentRun,
  updateAgentRunStatus
} from "./session-state-service";

type AgentLoopStartOptions = {
  pageContext?: ExtensionPageContext | null;
};

type AgentStepExecutionResult =
  | {
      status: "completed";
      command: ExtensionCommand;
    }
  | {
      status: "blocked";
      reason: string;
    }
  | {
      status: "finished" | "paused" | "failed" | "cancelled";
      reason: string | null | undefined;
    };

function shouldRefreshObservation(step: ActionStep) {
  return [
    "navigate",
    "click",
    "scroll",
    "open_new_tab",
    "switch_tab",
    "search_youtube",
    "open_search_result",
    "search_whatsapp_contact",
    "open_whatsapp_chat",
    "send_whatsapp_message",
    "create_event",
    "open_date",
    "create_doc",
    "open_doc",
    "open_folder",
    "create_doc_from_drive"
  ].includes(step.type);
}

function shouldPreFetchObservation(step: ActionStep) {
  return ![
    "navigate",
    "search",
    "open_new_tab",
    "switch_tab",
    "search_youtube",
    "search_whatsapp_contact",
    "create_event",
    "open_date",
    "create_doc",
    "create_doc_from_drive"
  ].includes(step.type);
}

function getPendingAgentStep(plan: ActionPlan) {
  const run = getAgentRun();
  if (!run || run.currentStepIndex === null) {
    return null;
  }

  const step = plan.steps[run.currentStepIndex];
  if (!step) {
    return null;
  }

  return {
    index: run.currentStepIndex,
    step
  };
}

function targetFromCandidate(candidate: ExtensionElementMatch, fallbackText: string | null | undefined) {
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

function buildRetryCommandFromCandidate(command: ExtensionCommand, candidate: ExtensionElementMatch) {
  const commandId = `agent_retry_${Date.now()}`;

  switch (command.type) {
    case "click":
      return {
        ...command,
        id: commandId,
        target: targetFromCandidate(candidate, command.target.text)
      } satisfies ExtensionCommand;
    case "fill_field":
      return {
        ...command,
        id: commandId,
        target: targetFromCandidate(candidate, command.target.text)
      } satisfies ExtensionCommand;
    case "select_option":
      return {
        ...command,
        id: commandId,
        target: targetFromCandidate(candidate, command.target.text)
      } satisfies ExtensionCommand;
    case "wait_for_element":
      return {
        ...command,
        id: commandId,
        target: targetFromCandidate(candidate, command.target.text)
      } satisfies ExtensionCommand;
    default:
      return null;
  }
}

function buildWaitCommandFromCommand(command: ExtensionCommand) {
  if (command.type === "click") {
    return {
      id: `agent_wait_${Date.now()}`,
      type: "wait_for_element",
      target: command.target,
      matchType: "clickable",
      timeoutMs: 2500,
      intervalMs: 250
    } satisfies ExtensionCommand;
  }

  if (command.type === "fill_field" || command.type === "select_option") {
    return {
      id: `agent_wait_${Date.now()}`,
      type: "wait_for_element",
      target: command.target,
      matchType: "field",
      timeoutMs: 2500,
      intervalMs: 250
    } satisfies ExtensionCommand;
  }

  return null;
}

async function refreshObservation(timeoutMs = 8_000) {
  try {
    const observation = await requestFreshPageContext(timeoutMs);
    if (observation) {
      recordAgentRunObservation(observation);
    }

    return observation;
  } catch {
    return getLastExtensionPageContext();
  }
}

async function issueCommandAttempt(stepIndex: number, command: ExtensionCommand) {
  enqueueExtensionCommand(command);
  recordSessionCommand(command);
  recordAgentRunStepStart(stepIndex, command);

  const result = await waitForExtensionResult(command.id, 12_000);
  return result;
}

async function attemptRecovery(
  plan: ActionPlan,
  stepIndex: number,
  step: ActionStep,
  command: ExtensionCommand,
  initialResult: ExtensionCommandResult,
  observation: ExtensionPageContext | null
) {
  let latestResult = initialResult;
  let latestObservation = observation ?? (await refreshObservation());
  const initialFailureMessage = initialResult.message.toLowerCase();

  const candidateRetries = (initialResult.candidates ?? []).filter((candidate) => candidate.selector).slice(0, 2);
  for (const candidate of candidateRetries) {
    const retryCommand = buildRetryCommandFromCandidate(command, candidate);
    if (!retryCommand) {
      continue;
    }

    incrementAgentRunRetryCount();
    latestResult = await issueCommandAttempt(stepIndex, retryCommand);
    latestObservation = latestResult.pageContext ?? (await refreshObservation()) ?? latestObservation;

    if (latestResult.ok) {
      return {
        result: latestResult,
        observation: latestObservation
      };
    }
  }

  if (/no high-confidence|timed out waiting|could not/i.test(initialFailureMessage)) {
    incrementAgentRunRetryCount();
    const scrollCommand: ExtensionCommand = {
      id: `agent_scroll_${Date.now()}`,
      type: "scroll",
      direction: "down",
      target: "target" in command ? command.target : undefined
    };
    const scrollResult = await issueCommandAttempt(stepIndex, scrollCommand);
    latestObservation = scrollResult.pageContext ?? (await refreshObservation()) ?? latestObservation;

    const waitCommand = buildWaitCommandFromCommand(command);
    if (waitCommand) {
      incrementAgentRunRetryCount();
      const waitResult = await issueCommandAttempt(stepIndex, waitCommand);
      latestObservation = waitResult.pageContext ?? (await refreshObservation()) ?? latestObservation;

      if (waitResult.ok) {
        incrementAgentRunRetryCount();
        const reDecision = await decideNextAgentCommand({
          plan,
          stepIndex,
          pageContext: latestObservation
        });
        recordAgentRunDecision(reDecision.reason, reDecision.confidence, reDecision.clarificationNeeded);

        if (reDecision.command && !reDecision.clarificationNeeded) {
          latestResult = await issueCommandAttempt(stepIndex, reDecision.command);
          latestObservation = latestResult.pageContext ?? (await refreshObservation()) ?? latestObservation;

          if (latestResult.ok) {
            return {
              result: latestResult,
              observation: latestObservation
            };
          }
        }
      }
    }
  }

  if (!latestResult.ok && latestObservation) {
    const reDecision = await decideNextAgentCommand({
      plan,
      stepIndex,
      pageContext: latestObservation
    });
    recordAgentRunDecision(reDecision.reason, reDecision.confidence, reDecision.clarificationNeeded);

    if (reDecision.clarificationNeeded) {
      return {
        result: {
          ...latestResult,
          message: reDecision.clarificationMessage ?? latestResult.message
        },
        observation: latestObservation
      };
    }
  }

  return {
    result: latestResult,
    observation: latestObservation
  };
}

export function startAgentLoop(intent: Intent, plan: ActionPlan, options?: AgentLoopStartOptions) {
  return startAgentRun(intent, plan, options?.pageContext ?? null);
}

export async function executeNextAgentStep(plan: ActionPlan): Promise<AgentStepExecutionResult> {
  const run = getAgentRun();
  if (!run) {
    return {
      status: "blocked",
      reason: "No active agent run is available."
    };
  }

  if (run.status === "completed") {
    return {
      status: "finished",
      reason: run.stopReason ?? "The agent run is already complete."
    };
  }

  if (run.status === "paused" || run.status === "failed" || run.status === "cancelled") {
    return {
      status: run.status,
      reason: run.stopReason ?? run.blockedReason ?? `The agent run is ${run.status}.`
    };
  }

  if (run.status === "blocked") {
    return {
      status: "blocked",
      reason: run.blockedReason ?? run.stopReason ?? "The agent run is blocked."
    };
  }

  const bridgeState = getExtensionBridgeState();
  if (!bridgeState.extensionConnected) {
    updateAgentRunStatus("blocked", {
      blockedReason: "The browser extension is not connected.",
      stopReason: "The browser extension is not connected."
    });
    return {
      status: "blocked",
      reason: "The browser extension is not connected."
    };
  }

  const pendingStep = getPendingAgentStep(plan);
  if (!pendingStep) {
    updateAgentRunStatus("completed", {
      stopReason: "All planned steps completed."
    });
    return {
      status: "finished",
      reason: "All planned steps completed."
    };
  }

  const pageContext = shouldPreFetchObservation(pendingStep.step) ? await refreshObservation(10_000) : getLastExtensionPageContext();
  const decision = await decideNextAgentCommand({
    plan,
    stepIndex: pendingStep.index,
    pageContext
  });
  recordAgentRunDecision(decision.reason, decision.confidence, decision.clarificationNeeded);

  if (decision.clarificationNeeded || !decision.command) {
    const reason = decision.clarificationMessage ?? decision.reason;
    updateAgentRunStatus("blocked", {
      blockedReason: reason,
      stopReason: reason
    });
    return {
      status: "blocked",
      reason
    };
  }

  let finalResult = await issueCommandAttempt(pendingStep.index, decision.command);
  let finalObservation: ExtensionPageContext | null = finalResult.pageContext ?? pageContext ?? null;

  if (!finalResult.ok) {
    incrementAgentRunRetryCount();
    const recovered = await attemptRecovery(
      plan,
      pendingStep.index,
      pendingStep.step,
      decision.command,
      finalResult,
      finalObservation
    );
    finalResult = recovered.result;
    finalObservation = recovered.observation;
  }

  if (finalResult.ok && shouldRefreshObservation(pendingStep.step)) {
    finalObservation = (await refreshObservation(12_000)) ?? finalObservation;
  }

  recordAgentRunStepResult(pendingStep.index, finalResult, {
    observation: finalObservation
  });

  if (finalObservation) {
    recordAgentRunObservation(finalObservation);
  }

  if (!finalResult.ok) {
    return {
      status: "blocked",
      reason: finalResult.message
    };
  }

  return {
    status: "completed",
    command: decision.command
  };
}

export async function runAgentLoop(plan: ActionPlan, options?: { maxSteps?: number }) {
  const maxSteps = options?.maxSteps ?? plan.steps.length;
  let iterations = 0;

  while (iterations < maxSteps) {
    const run = getAgentRun();
    if (!run) {
      return {
        status: "blocked" as const,
        reason: "No active agent run is available."
      };
    }

    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled" || run.status === "paused") {
      return {
        status: run.status,
        reason: run.stopReason
      };
    }

    const execution = await executeNextAgentStep(plan);
    iterations += 1;

    if (execution.status !== "completed") {
      return execution;
    }
  }

  updateAgentRunStatus("blocked", {
    blockedReason: "The agent loop reached its current step limit.",
    stopReason: "The agent loop reached its current step limit."
  });

  return {
    status: "blocked" as const,
    reason: "The agent loop reached its current step limit."
  };
}
