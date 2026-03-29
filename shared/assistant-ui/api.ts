import {
  extensionBridgeStateSchema,
  extensionCommandResultSchema,
  extensionExecuteResponseSchema,
  feedbackSpeechRequestSchema,
  orchestratorResponseSchema,
  transcriptionResponseSchema,
  type ActionPlan,
  type ExtensionCommand,
  type FeedbackSpeechRequest,
  type ExtensionTarget,
  type OrchestratorResponse
} from "../index";

type OrchestrateOptions = {
  history?: Array<{ role: "user" | "assistant"; content: string }>;
};

function resolveApiBaseUrl() {
  const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return viteEnv?.VITE_API_BASE_URL ?? "http://localhost:8787";
}

async function parseJsonResponse<T>(response: Response, parser: { parse(data: unknown): T }) {
  const payload = await response.json();

  if (!response.ok) {
    const errorMessage =
      typeof payload?.error === "string" ? payload.error : "The request could not be completed.";
    throw new Error(errorMessage);
  }

  return parser.parse(payload);
}

function mapStepTarget(target: string | undefined): ExtensionTarget {
  return {
    text: target ?? null,
    fieldHint: target ?? null,
    role: target?.toLowerCase().includes("button") || target?.toLowerCase().includes("send") ? "button" : null,
    selector: null,
    name: null,
    id: null,
    ariaLabel: null,
    placeholder: null
  };
}

export async function transcribeAudio(file: File) {
  const formData = new FormData();
  formData.append("audio", file);

  const response = await fetch(`${resolveApiBaseUrl()}/api/speech-to-text`, {
    method: "POST",
    body: formData
  });

  return parseJsonResponse(response, transcriptionResponseSchema);
}

export async function synthesizeFeedbackAudio(
  request: FeedbackSpeechRequest,
  options?: { signal?: AbortSignal }
) {
  const payload = feedbackSpeechRequestSchema.parse(request);
  const response = await fetch(`${resolveApiBaseUrl()}/api/feedback/speech`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
    signal: options?.signal
  });

  if (!response.ok) {
    let errorMessage = "Speech synthesis failed.";

    try {
      const payload = await response.json();
      if (typeof payload?.error === "string") {
        errorMessage = payload.error;
      }
    } catch {
      // Ignore JSON parsing failures for binary responses.
    }

    throw new Error(errorMessage);
  }

  return response.blob();
}

export async function orchestrateTranscript(
  transcript: string,
  options?: OrchestrateOptions
): Promise<OrchestratorResponse> {
  const response = await fetch(`${resolveApiBaseUrl()}/api/orchestrate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      transcript,
      history: options?.history ?? []
    })
  });

  return parseJsonResponse(response, orchestratorResponseSchema);
}

export async function getExtensionState() {
  const response = await fetch(`${resolveApiBaseUrl()}/api/extension/state`);
  return parseJsonResponse(response, extensionBridgeStateSchema);
}

export async function getExtensionCommandResult(commandId: string) {
  const response = await fetch(`${resolveApiBaseUrl()}/api/extension/result/${encodeURIComponent(commandId)}`);
  return parseJsonResponse(response, extensionCommandResultSchema);
}

export async function queueExtensionCommand(command: ExtensionCommand) {
  const response = await fetch(`${resolveApiBaseUrl()}/api/extension/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ command })
  });

  return parseJsonResponse(response, extensionExecuteResponseSchema);
}

export function mapPlanToExtensionCommands(
  plan: ActionPlan,
  options?: { newTabForNavigation?: boolean }
) {
  const commands: ExtensionCommand[] = [];

  for (const [index, step] of plan.steps.entries()) {
    const id = `plan_${Date.now()}_${index}`;

    switch (step.type) {
      case "navigate":
        if (step.target) {
          commands.push({
            id,
            type: "navigate",
            url: step.target.startsWith("http") ? step.target : `http://localhost:5173${step.target}`,
            newTab: options?.newTabForNavigation ?? false
          });
        }
        break;
      case "type":
        if (step.fieldHint && typeof step.value === "string") {
          commands.push({
            id,
            type: "fill_field",
            target: {
              fieldHint: step.fieldHint,
              text: null,
              role: null,
              selector: null,
              name: null,
              id: null,
              ariaLabel: null,
              placeholder: null
            },
            value: step.value
          });
        }
        break;
      case "click":
        commands.push({
          id,
          type: "click",
          target: mapStepTarget(step.target)
        });
        break;
      case "extract_text":
        commands.push({
          id,
          type: "extract_text_blocks"
        });
        break;
      case "search":
        if (step.query) {
          commands.push({
            id,
            type: "navigate",
            url: `https://www.google.com/search?q=${encodeURIComponent(step.query)}`,
            newTab: options?.newTabForNavigation ?? false
          });
        }
        break;
      default:
        break;
    }
  }

  return commands;
}
