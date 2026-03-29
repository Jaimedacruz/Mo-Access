import type {
  ExtensionCommand,
  ExtensionCommandResult,
  ExtensionHeartbeat,
  ExtensionPageContext
} from "../../../../shared/index";

type ExtensionBridgeState = {
  pendingCommands: ExtensionCommand[];
  lastHeartbeat: ExtensionHeartbeat | null;
  lastResult: ExtensionCommandResult | null;
  lastPageContext: ExtensionPageContext | null;
};

const bridgeState: ExtensionBridgeState = {
  pendingCommands: [],
  lastHeartbeat: null,
  lastResult: null,
  lastPageContext: null
};

export function enqueueExtensionCommand(command: ExtensionCommand) {
  bridgeState.pendingCommands.push(command);

  return {
    queued: true,
    command,
    pendingCommands: bridgeState.pendingCommands.length
  };
}

export function getNextExtensionCommand() {
  const command = bridgeState.pendingCommands.shift() ?? null;

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
