import {
  agentContinueRequestSchema,
  agentContinueResponseSchema,
  agentStartResponseSchema,
  agentStateResponseSchema,
  extensionBridgeStateSchema,
  extensionCommandResultSchema,
  feedbackSpeechRequestSchema,
  pageSummaryResponseSchema,
  transcriptionResponseSchema,
  type AgentContinueResponse,
  type AgentStartResponse,
  type AgentStateResponse,
  type ExtensionPageContext,
  type FeedbackSpeechRequest
} from "../index";

type AgentStartOptions = {
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  maxSteps?: number;
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

export async function summarizeBrowserPage(request: string, pageContext: ExtensionPageContext) {
  const response = await fetch(`${resolveApiBaseUrl()}/api/page-summary`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      request,
      pageContext
    })
  });

  return parseJsonResponse(response, pageSummaryResponseSchema);
}

export async function startAgentRun(
  transcript: string,
  options?: AgentStartOptions
): Promise<AgentStartResponse> {
  const response = await fetch(`${resolveApiBaseUrl()}/api/agent/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      transcript,
      history: options?.history ?? [],
      autoRun: false,
      maxSteps: options?.maxSteps
    })
  });

  return parseJsonResponse(response, agentStartResponseSchema);
}

export async function continueAgentRun(maxSteps = 1): Promise<AgentContinueResponse> {
  const payload = agentContinueRequestSchema.parse({ maxSteps });
  const response = await fetch(`${resolveApiBaseUrl()}/api/agent/continue`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  return parseJsonResponse(response, agentContinueResponseSchema);
}

export async function pauseAgentRun(): Promise<AgentStateResponse> {
  const response = await fetch(`${resolveApiBaseUrl()}/api/agent/pause`, {
    method: "POST"
  });

  return parseJsonResponse(response, agentStateResponseSchema);
}

export async function cancelAgentRun(): Promise<AgentStateResponse> {
  const response = await fetch(`${resolveApiBaseUrl()}/api/agent/cancel`, {
    method: "POST"
  });

  return parseJsonResponse(response, agentStateResponseSchema);
}

export async function getAgentState(): Promise<AgentStateResponse> {
  const response = await fetch(`${resolveApiBaseUrl()}/api/agent/state`);
  return parseJsonResponse(response, agentStateResponseSchema);
}

export async function getExtensionState() {
  const response = await fetch(`${resolveApiBaseUrl()}/api/extension/state`);
  return parseJsonResponse(response, extensionBridgeStateSchema);
}

export async function getExtensionCommandResult(commandId: string) {
  const response = await fetch(`${resolveApiBaseUrl()}/api/extension/result/${encodeURIComponent(commandId)}`);
  return parseJsonResponse(response, extensionCommandResultSchema);
}
