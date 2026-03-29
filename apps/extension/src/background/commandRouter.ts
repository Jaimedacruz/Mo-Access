import { extensionCommandSchema, type ExtensionCommand, type ExtensionCommandResult } from "@shared/index";
import { includesNormalized, isReasonableUrl } from "@extension/shared/normalize";

function parseCalendarDate(rawDate: string) {
  const normalized = rawDate.trim().toLowerCase();
  const now = new Date();

  if (normalized === "today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  if (normalized === "tomorrow") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  }

  const parsed = new Date(rawDate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatCalendarDate(date: Date) {
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}

function formatCalendarDateRange(dateText?: string | null, timeText?: string | null, endTimeText?: string | null) {
  const date = dateText ? parseCalendarDate(dateText) : new Date();
  if (!date) {
    return null;
  }

  const base = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const parseTime = (value?: string | null, fallbackHour = 9, fallbackMinute = 0) => {
    if (!value) {
      return new Date(base.getFullYear(), base.getMonth(), base.getDate(), fallbackHour, fallbackMinute);
    }

    const match = value.trim().match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (!match) {
      return new Date(base.getFullYear(), base.getMonth(), base.getDate(), fallbackHour, fallbackMinute);
    }

    let hours = Number.parseInt(match[1], 10);
    const minutes = match[2] ? Number.parseInt(match[2], 10) : 0;
    const meridiem = match[3]?.toLowerCase();

    if (meridiem === "pm" && hours < 12) {
      hours += 12;
    }

    if (meridiem === "am" && hours === 12) {
      hours = 0;
    }

    return new Date(base.getFullYear(), base.getMonth(), base.getDate(), hours, minutes);
  };

  const start = parseTime(timeText);
  const end = parseTime(endTimeText, start.getHours() + 1, start.getMinutes());
  const serialize = (value: Date) =>
    `${value.getFullYear()}${String(value.getMonth() + 1).padStart(2, "0")}${String(value.getDate()).padStart(2, "0")}T${String(value.getHours()).padStart(2, "0")}${String(value.getMinutes()).padStart(2, "0")}00`;

  return `${serialize(start)}/${serialize(end)}`;
}

function calendarNavigationUrl(command: Extract<ExtensionCommand, { type: "create_event" | "open_date" }>) {
  if (command.type === "open_date") {
    const date = parseCalendarDate(command.date);
    if (!date) {
      return null;
    }

    return `https://calendar.google.com/calendar/u/0/r/day/${formatCalendarDate(date)}`;
  }

  const url = new URL("https://calendar.google.com/calendar/u/0/r/eventedit");
  url.searchParams.set("text", command.title);
  if (command.details) {
    url.searchParams.set("details", command.details);
  }
  if (command.guestEmail) {
    url.searchParams.set("add", command.guestEmail);
  }

  const dates = formatCalendarDateRange(command.date ?? null, command.time ?? null, command.endTime ?? null);
  if (dates) {
    url.searchParams.set("dates", dates);
  }

  return url.toString();
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tab ?? null;
}

async function getCurrentWindowTabs() {
  return chrome.tabs.query({
    currentWindow: true
  });
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
    case "open_new_tab": {
      if (!isReasonableUrl(command.url)) {
        return {
          commandId: command.id,
          ok: false,
          action: "open_new_tab",
          message: "The URL is not a valid http or https destination."
        };
      }

      const createdTab = await chrome.tabs.create({ url: command.url, active: true });
      return {
        commandId: command.id,
        ok: true,
        action: "open_new_tab",
        message: "Opened the destination in a new tab.",
        data: {
          tabId: createdTab.id ?? null,
          url: createdTab.url ?? command.url
        }
      };
    }
    case "search_youtube": {
      const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(command.query)}`;
      const tab = await getActiveTab();
      if (!tab?.id) {
        return {
          commandId: command.id,
          ok: false,
          action: "search_youtube",
          message: "No active tab is available for YouTube search."
        };
      }

      await chrome.tabs.update(tab.id, { url });
      return {
        commandId: command.id,
        ok: true,
        action: "search_youtube",
        message: "Opened YouTube search results.",
        data: {
          tabId: tab.id,
          url
        }
      };
    }
    case "create_event":
    case "open_date": {
      const url = calendarNavigationUrl(command);
      if (!url) {
        return {
          commandId: command.id,
          ok: false,
          action: command.type,
          message: "The Google Calendar target could not be resolved."
        };
      }

      const tab = await getActiveTab();
      if (!tab?.id) {
        return {
          commandId: command.id,
          ok: false,
          action: command.type,
          message: "No active tab is available for Google Calendar navigation."
        };
      }

      await chrome.tabs.update(tab.id, { url });
      return {
        commandId: command.id,
        ok: true,
        action: command.type,
        message: command.type === "create_event" ? "Opened the Google Calendar event editor." : "Opened the requested Google Calendar date.",
        data: {
          tabId: tab.id,
          url
        }
      };
    }
    case "create_doc":
    case "create_doc_from_drive": {
      const url = "https://docs.google.com/document/create";
      const tab = await getActiveTab();
      if (!tab?.id) {
        return {
          commandId: command.id,
          ok: false,
          action: command.type,
          message: "No active tab is available for Google Docs creation."
        };
      }

      await chrome.tabs.update(tab.id, { url });
      return {
        commandId: command.id,
        ok: true,
        action: command.type,
        message: "Opened a new Google Doc.",
        data: {
          tabId: tab.id,
          url
        }
      };
    }
    case "switch_tab": {
      const tabs = await getCurrentWindowTabs();
      const tab =
        typeof command.tabId === "number"
          ? tabs.find((candidate) => candidate.id === command.tabId) ?? null
          : tabs.find((candidate) =>
              includesNormalized(candidate.title, command.query) || includesNormalized(candidate.url, command.query)
            ) ?? null;

      if (!tab?.id) {
        return {
          commandId: command.id,
          ok: false,
          action: "switch_tab",
          message: "No matching tab was found."
        };
      }

      await chrome.tabs.update(tab.id, { active: true });

      if (typeof tab.windowId === "number") {
        await chrome.windows.update(tab.windowId, { focused: true });
      }

      return {
        commandId: command.id,
        ok: true,
        action: "switch_tab",
        message: "Switched to the requested tab.",
        data: {
          tabId: tab.id,
          title: tab.title ?? null,
          url: tab.url ?? null
        }
      };
    }
    default:
      return sendToContent(command);
  }
}
