import type {
  ExtensionCommand,
  ExtensionCommandResult,
  ExtensionHeartbeat,
  ExtensionPageContext
} from "../../../../shared/index";

type ExtensionBridgeState = {
  pendingCommands: ExtensionCommand[];
  inFlightCommands: Map<string, ExtensionCommand>;
  commandHistory: Map<string, ExtensionCommand>;
  lastHeartbeat: ExtensionHeartbeat | null;
  lastResult: ExtensionCommandResult | null;
  lastPageContext: ExtensionPageContext | null;
};

const bridgeState: ExtensionBridgeState = {
  pendingCommands: [],
  inFlightCommands: new Map(),
  commandHistory: new Map(),
  lastHeartbeat: null,
  lastResult: null,
  lastPageContext: null
};
const resultWaiters = new Map<string, { resolve: (result: ExtensionCommandResult) => void; timeout: NodeJS.Timeout }>();

export function enqueueExtensionCommand(command: ExtensionCommand) {
  bridgeState.pendingCommands.push(command);
  bridgeState.commandHistory.set(command.id, command);

  return {
    queued: true,
    command,
    pendingCommands: bridgeState.pendingCommands.length
  };
}

export function getNextExtensionCommand() {
  const command = bridgeState.pendingCommands.shift() ?? null;

  if (command) {
    bridgeState.inFlightCommands.set(command.id, command);
  }

  return {
    command,
    pendingCommands: bridgeState.pendingCommands.length
  };
}

export function recordExtensionHeartbeat(heartbeat: ExtensionHeartbeat) {
  bridgeState.lastHeartbeat = heartbeat;
}

export function recordExtensionResult(result: ExtensionCommandResult) {
  bridgeState.lastResult = result;
  bridgeState.inFlightCommands.delete(result.commandId);

  const waiter = resultWaiters.get(result.commandId);
  if (waiter) {
    clearTimeout(waiter.timeout);
    resultWaiters.delete(result.commandId);
    waiter.resolve(result);
  }
}

export function recordExtensionPageContext(pageContext: ExtensionPageContext) {
  bridgeState.lastPageContext = pageContext;
}

export function getExtensionBridgeState() {
  return {
    extensionConnected: Boolean(bridgeState.lastHeartbeat?.ready),
    pendingCommands: bridgeState.pendingCommands.length,
    lastHeartbeat: bridgeState.lastHeartbeat,
    lastResult: bridgeState.lastResult,
    lastPageContext: bridgeState.lastPageContext
  };
}

export function getLastExtensionPageContext() {
  return bridgeState.lastPageContext;
}

export function getExtensionCommand(commandId: string) {
  return bridgeState.inFlightCommands.get(commandId) ?? bridgeState.commandHistory.get(commandId) ?? null;
}

export async function waitForExtensionResult(commandId: string, timeoutMs = 8_000) {
  if (bridgeState.lastResult?.commandId === commandId) {
    return bridgeState.lastResult;
  }

  return new Promise<ExtensionCommandResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      resultWaiters.delete(commandId);
      reject(new Error(`Timed out waiting for extension result ${commandId}.`));
    }, timeoutMs);

    resultWaiters.set(commandId, { resolve, timeout });
  });
}

export async function requestFreshPageContext(timeoutMs = 8_000) {
  const command: ExtensionCommand = {
    id: `refresh_context_${Date.now()}`,
    type: "get_page_context"
  };

  enqueueExtensionCommand(command);

  try {
    const result = await waitForExtensionResult(command.id, timeoutMs);
    return result.pageContext ?? bridgeState.lastPageContext;
  } catch {
    return bridgeState.lastPageContext;
  }
}
