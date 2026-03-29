import type { BackgroundState, PopupAction } from "@extension/shared/runtime";
import { extensionStateStorageKey } from "@extension/shared/runtime";
import "./styles.css";

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

async function sendMessage<T>(message: PopupAction) {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

function button(label: string, action: PopupAction["type"]) {
  return `<button type="button" data-action="${action}">${label}</button>`;
}

async function getBackgroundState() {
  const stored = await chrome.storage.local.get(extensionStateStorageKey);
  return (stored[extensionStateStorageKey] as BackgroundState | undefined) ?? {
    orchestratorReachable: false,
    currentTabUrl: null,
    lastCommand: null,
    lastResult: null,
    lastHeartbeat: null,
    lastPageContext: null
  };
}

async function render() {
  const state = await getBackgroundState();
  const app = document.getElementById("app");

  if (!app) {
    return;
  }

  app.innerHTML = `
    <main class="popup-shell">
      <header class="popup-header">
        <div>
          <p class="eyebrow">Mo Access</p>
          <h1>Extension Debug</h1>
        </div>
        <span class="status ${state.orchestratorReachable ? "ok" : "offline"}">
          ${state.orchestratorReachable ? "Connected" : "Waiting"}
        </span>
      </header>

      <section class="card">
        <h2>Current tab</h2>
        <p>${state.currentTabUrl ?? "No active tab URL available."}</p>
      </section>

      <section class="button-grid">
        ${button("Ping orchestrator", "popup:ping-orchestrator")}
        ${button("Get page context", "popup:get-page-context")}
        ${button("Run test click", "popup:test-click")}
        ${button("Run test fill", "popup:test-fill")}
      </section>

      <section class="card">
        <h2>Last command</h2>
        <pre>${state.lastCommand ? formatJson(state.lastCommand) : "No command yet."}</pre>
      </section>

      <section class="card">
        <h2>Last result</h2>
        <pre>${state.lastResult ? formatJson(state.lastResult) : "No execution result yet."}</pre>
      </section>
    </main>
  `;

  app.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((element) => {
    element.addEventListener("click", async () => {
      element.disabled = true;
      try {
        await sendMessage({ type: element.dataset.action as PopupAction["type"] });
      } finally {
        element.disabled = false;
        await render();
      }
    });
  });
}

void render();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[extensionStateStorageKey]) {
    void render();
  }
});
