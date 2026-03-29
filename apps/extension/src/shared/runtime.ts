import type {
  ExtensionCommand,
  ExtensionCommandResult,
  ExtensionHeartbeat,
  ExtensionPageContext
} from "@shared/index";

export type PopupAction =
  | { type: "popup:get-state" }
  | { type: "popup:ping-orchestrator" }
  | { type: "popup:get-page-context" }
  | { type: "popup:test-click" }
  | { type: "popup:test-fill" };

export type ContentAction = {
  type: "extension:run-command";
  command: ExtensionCommand;
};

export type BackgroundState = {
  orchestratorReachable: boolean;
  currentTabUrl: string | null;
  lastCommand: ExtensionCommand | null;
  lastResult: ExtensionCommandResult | null;
  lastHeartbeat: ExtensionHeartbeat | null;
  lastPageContext: ExtensionPageContext | null;
};

export const extensionStateStorageKey = "moAccessState";
