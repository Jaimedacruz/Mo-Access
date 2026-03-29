import type { ExtensionCommand } from "@shared/index";
import { extensionCommandSchema } from "@shared/index";
import type { BackgroundState, PopupAction } from "@extension/shared/runtime";
import { extensionStateStorageKey } from "@extension/shared/runtime";
import { getActiveTabSnapshot, runCommand } from "./commandRouter";
import {
  pingOrchestrator,
  pollNextCommand,
  postHeartbeat,
  postPageContext,
  postResult
} from "./orchestratorClient";

const pollAlarmName = "mo-access-poll";
let isPolling = false;

const defaultState: BackgroundState = {
  orchestratorReachable: false,
  currentTabUrl: null,
  lastCommand: null,
  lastResult: null,
  lastHeartbeat: null,
  lastPageContext: null
};

async function getState() {
  const stored = await chrome.storage.local.get(extensionStateStorageKey);
  return (stored[extensionStateStorageKey] as BackgroundState | undefined) ?? defaultState;
}

async function setState(update: Partial<BackgroundState>) {
  const currentState = await getState();
  const nextState = {
    ...currentState,
    ...update
  } satisfies BackgroundState;

  await chrome.storage.local.set({
    [extensionStateStorageKey]: nextState
  });

  return nextState;
}

function localTestClickCommand(): ExtensionCommand {
  return {
    id: `local_click_${Date.now()}`,
    type: "click",
    target: {
      text: "Open the support page",
      role: "button"
    }
  };
}

function localTestFillCommand(): ExtensionCommand {
  return {
    id: `local_fill_${Date.now()}`,
    type: "fill_field",
    target: {
      fieldHint: "message",
      placeholder: "Message the assistant..."
    },
    value: "Search for remote data analyst jobs"
  };
}

async function updateHeartbeat(lastCommandId: string | null = null) {
  const activeTab = await getActiveTabSnapshot();
  const heartbeat = {
    version: chrome.runtime.getManifest().version,
    ready: true,
    activeTab,
    lastCommandId
  };

  await postHeartbeat(heartbeat);
  await setState({
    currentTabUrl: activeTab.url,
    lastHeartbeat: heartbeat
  });
}

async function runAndStore(command: ExtensionCommand) {
  const result = await runCommand(command);

  await setState({
    lastCommand: command,
    lastResult: result
  });

  if (result.pageContext) {
    await postPageContext(result.pageContext);
    await setState({
      lastPageContext: result.pageContext
    });
  }

  return result;
}

async function pollOrchestratorQueue() {
  if (isPolling) {
    return;
  }

  isPolling = true;

  try {
    await updateHeartbeat();
    const health = await pingOrchestrator();
    await setState({
      orchestratorReachable: health.ok
    });

    let pending = true;
    while (pending) {
      const next = await pollNextCommand();
      if (!next.command) {
        pending = false;
        break;
      }

      const command = extensionCommandSchema.parse(next.command);
      const result = await runAndStore(command);
      await postResult(result);
      await updateHeartbeat(command.id);

      if (["navigate", "open_new_tab", "switch_tab"].includes(command.type)) {
        pending = false;
      }
    }
  } catch {
    await setState({
      orchestratorReachable: false
    });
  } finally {
    isPolling = false;
  }
}

async function handlePopupAction(action: PopupAction) {
  switch (action.type) {
    case "popup:get-state":
      return getState();
    case "popup:ping-orchestrator": {
      const health = await pingOrchestrator();
      await updateHeartbeat();
      return setState({
        orchestratorReachable: health.ok
      });
    }
    case "popup:get-page-context": {
      const result = await runAndStore({
        id: `local_context_${Date.now()}`,
        type: "get_page_context"
      });
      return {
        state: await getState(),
        result
      };
    }
    case "popup:test-click": {
      const result = await runAndStore(localTestClickCommand());
      return {
        state: await getState(),
        result
      };
    }
    case "popup:test-fill": {
      const result = await runAndStore(localTestFillCommand());
      return {
        state: await getState(),
        result
      };
    }
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.alarms.create(pollAlarmName, {
    periodInMinutes: 0.1
  });
  await setState(defaultState);
});

chrome.runtime.onStartup.addListener(async () => {
  await chrome.alarms.create(pollAlarmName, {
    periodInMinutes: 0.1
  });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === pollAlarmName) {
    await pollOrchestratorQueue();
  }
});

chrome.tabs.onActivated.addListener(async () => {
  const activeTab = await getActiveTabSnapshot();
  await setState({
    currentTabUrl: activeTab.url
  });
  await pollOrchestratorQueue();
});

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  if (tab.active) {
    await setState({
      currentTabUrl: tab.url ?? null
    });
  }

  if (tab.active && changeInfo.status === "complete") {
    await pollOrchestratorQueue();
  }
});

chrome.runtime.onMessage.addListener((message: PopupAction, _sender, sendResponse) => {
  void handlePopupAction(message)
    .then((result) => sendResponse(result))
    .catch((error) =>
      sendResponse({
        error: error instanceof Error ? error.message : "Unknown extension error."
      })
    );

  return true;
});
