import type {
  ExtensionCommand,
  ExtensionCommandResult,
  ExtensionHeartbeat,
  ExtensionPageContext
} from "@shared/index";

const apiBaseUrl = "http://localhost:8787/api";

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`Orchestrator request failed with status ${response.status}.`);
  }

  return response.json() as Promise<T>;
}

export async function pingOrchestrator() {
  const response = await fetch(`${apiBaseUrl}/health`);
  return parseJson<{ ok: boolean; openAiConfigured: boolean }>(response);
}

export async function pollNextCommand() {
  const response = await fetch(`${apiBaseUrl}/extension/next-command`);
  return parseJson<{ command: ExtensionCommand | null; pendingCommands: number }>(response);
}

export async function postHeartbeat(heartbeat: ExtensionHeartbeat) {
  await fetch(`${apiBaseUrl}/extension/heartbeat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(heartbeat)
  });
}

export async function postResult(result: ExtensionCommandResult) {
  await fetch(`${apiBaseUrl}/extension/result`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(result)
  });
}

export async function postPageContext(pageContext: ExtensionPageContext) {
  await fetch(`${apiBaseUrl}/extension/page-context`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(pageContext)
  });
}
