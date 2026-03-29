import { extensionCommandSchema, type ExtensionCommand, type ExtensionCommandResult } from "@shared/index";
import { isReasonableUrl } from "@extension/shared/normalize";

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tab ?? null;
}

async function injectContentScript(tabId: number) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["assets/content.js"]
  });
}

async function sendToContent(command: ExtensionCommand): Promise<ExtensionCommandResult> {
  const tab = await getActiveTab();

  if (!tab?.id) {
    return {
      commandId: command.id,
      ok: false,
      action: command.type,
      message: "No active tab is available."
    };
  }

  if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) {
    return {
      commandId: command.id,
      ok: false,
      action: command.type,
      message: "This tab does not allow content-script actions."
    };
  }

  try {
    const result = await chrome.tabs.sendMessage(tab.id, {
      type: "extension:run-command",
      command
    });

    return result as ExtensionCommandResult;
  } catch {
    try {
      await injectContentScript(tab.id);
      const retriedResult = await chrome.tabs.sendMessage(tab.id, {
        type: "extension:run-command",
        command
      });

      return retriedResult as ExtensionCommandResult;
    } catch {
      return {
        commandId: command.id,
        ok: false,
        action: command.type,
        message: "The content script could not be attached to the active tab."
      };
    }
  }
}

export async function getActiveTabSnapshot() {
  const tab = await getActiveTab();

  return {
    title: tab?.title ?? null,
    url: tab?.url ?? null,
    tabId: tab?.id ?? null
  };
}

export async function runCommand(commandInput: ExtensionCommand): Promise<ExtensionCommandResult> {
  const command = extensionCommandSchema.parse(commandInput);

  switch (command.type) {
    case "ping": {
      const activeTab = await getActiveTabSnapshot();
      return {
        commandId: command.id,
        ok: true,
        action: "ping",
        message: "Extension is responsive.",
        data: {
          version: chrome.runtime.getManifest().version,
          activeTab
        }
      };
    }
    case "navigate": {
      if (!isReasonableUrl(command.url)) {
        return {
          commandId: command.id,
          ok: false,
          action: "navigate",
          message: "The URL is not a valid http or https destination."
        };
      }

      if (command.newTab) {
        const createdTab = await chrome.tabs.create({ url: command.url, active: true });
        return {
          commandId: command.id,
          ok: true,
          action: "navigate",
          message: "Opened the destination in a new tab.",
          data: {
            tabId: createdTab.id ?? null,
            url: createdTab.url ?? command.url
          }
        };
      }

      const tab = await getActiveTab();
      if (!tab?.id) {
        return {
          commandId: command.id,
          ok: false,
          action: "navigate",
          message: "No active tab is available for navigation."
        };
      }

      await chrome.tabs.update(tab.id, { url: command.url });
      return {
        commandId: command.id,
        ok: true,
        action: "navigate",
        message: "Navigated the active tab successfully.",
        data: {
          tabId: tab.id,
          url: command.url
        }
      };
    }
    default:
      return sendToContent(command);
  }
}
