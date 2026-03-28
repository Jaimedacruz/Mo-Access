import {
  orchestratorResponseSchema,
  transcriptionResponseSchema,
  type OrchestratorResponse
} from "@shared/index";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

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

  const response = await fetch(`${apiBaseUrl}/api/speech-to-text`, {
    method: "POST",
    body: formData
  });

  return parseJsonResponse(response, transcriptionResponseSchema);
}

export async function orchestrateTranscript(transcript: string): Promise<OrchestratorResponse> {
  const response = await fetch(`${apiBaseUrl}/api/orchestrate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ transcript })
  });

  return parseJsonResponse(response, orchestratorResponseSchema);
}
