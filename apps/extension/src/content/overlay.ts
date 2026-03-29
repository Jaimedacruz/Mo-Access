const overlayStorageKey = "moAccessOverlayState";
const overlayHostId = "mo-access-overlay-host";

type OverlayState = {
  expanded: boolean;
  x: number | null;
  y: number | null;
};

const defaultOverlayState: OverlayState = {
  expanded: false,
  x: null,
  y: null
};

function isExtensionContextAvailable() {
  try {
    return Boolean(chrome?.runtime?.id);
  } catch {
    return false;
  }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

async function readOverlayState() {
  if (!isExtensionContextAvailable()) {
    return defaultOverlayState;
  }

  try {
    const stored = await chrome.storage.local.get(overlayStorageKey);
    return {
      ...defaultOverlayState,
      ...(stored[overlayStorageKey] as Partial<OverlayState> | undefined)
    } satisfies OverlayState;
  } catch {
    return defaultOverlayState;
  }
}

async function writeOverlayState(state: OverlayState) {
  if (!isExtensionContextAvailable()) {
    return;
  }

  try {
    await chrome.storage.local.set({
      [overlayStorageKey]: state
    });
  } catch {
    // Ignore writes from stale content scripts after extension reloads.
  }
}

function iframeUrl() {
  try {
    return chrome.runtime.getURL("panel.html");
  } catch {
    return "";
  }
}

export async function mountAssistantOverlay() {
  if (!isExtensionContextAvailable() || window.top !== window.self || !document.body || document.getElementById(overlayHostId)) {
    return;
  }

  const overlayState = await readOverlayState();
  const host = document.createElement("div");
  host.id = overlayHostId;
  host.style.position = "fixed";
  host.style.zIndex = "2147483647";
  host.style.pointerEvents = "none";

  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
      }

      .overlay-shell {
        position: relative;
        width: 100%;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        pointer-events: auto;
      }

      .widget,
      .panel {
        border: 1px solid rgba(22, 33, 40, 0.12);
        box-shadow: 0 18px 42px rgba(15, 30, 27, 0.18);
        backdrop-filter: blur(14px);
      }

      .widget {
        display: inline-flex;
        align-items: center;
        gap: 0.7rem;
        border-radius: 999px;
        background: rgba(23, 68, 61, 0.96);
        color: #f5faf8;
        padding: 0.85rem 1rem;
        cursor: pointer;
        user-select: none;
      }

      .widget:hover {
        transform: translateY(-1px);
      }

      .widget-badge {
        width: 0.78rem;
        height: 0.78rem;
        border-radius: 999px;
        background: #8ee6be;
        box-shadow: 0 0 0 6px rgba(142, 230, 190, 0.16);
      }

      .widget-copy {
        display: grid;
        gap: 0.12rem;
      }

      .widget-copy strong {
        font-size: 0.95rem;
        font-weight: 700;
      }

      .widget-copy span {
        font-size: 0.78rem;
        color: rgba(245, 250, 248, 0.8);
      }

      .panel {
        width: min(420px, calc(100vw - 24px));
        height: min(700px, calc(100vh - 24px));
        border-radius: 1.4rem;
        overflow: hidden;
        background: rgba(251, 248, 241, 0.98);
        display: none;
      }

      .panel.is-open {
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        animation: panel-in 180ms ease;
      }

      .panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        padding: 0.85rem 0.9rem;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.88), rgba(245, 239, 230, 0.9));
        border-bottom: 1px solid rgba(22, 33, 40, 0.08);
        cursor: move;
        user-select: none;
      }

      .panel-title {
        display: grid;
        gap: 0.15rem;
      }

      .panel-title strong {
        font-size: 0.96rem;
        color: #173a34;
      }

      .panel-title span {
        font-size: 0.76rem;
        color: #5f736e;
      }

      .panel-actions {
        display: flex;
        align-items: center;
        gap: 0.45rem;
      }

      .icon-button {
        min-width: 3rem;
        height: 2rem;
        border: 1px solid rgba(22, 33, 40, 0.08);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.92);
        color: #1f3a36;
        font: inherit;
        cursor: pointer;
      }

      .icon-button:hover {
        background: #17443d;
        color: white;
      }

      iframe {
        width: 100%;
        height: 100%;
        border: none;
        background: transparent;
      }

      @keyframes panel-in {
        from {
          opacity: 0;
          transform: translateY(8px) scale(0.98);
        }

        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      @media (max-width: 640px) {
        .panel {
          width: min(100vw - 12px, 420px);
          height: min(100vh - 12px, 700px);
        }
      }
    </style>
    <div class="overlay-shell">
      <button class="widget" type="button" aria-label="Open Mo Access">
        <span class="widget-badge" aria-hidden="true"></span>
        <span class="widget-copy">
          <strong>Mo Access</strong>
          <span>Ask for help on this page</span>
        </span>
      </button>
      <section class="panel ${overlayState.expanded ? "is-open" : ""}" aria-label="Mo Access assistant panel">
        <header class="panel-header">
          <div class="panel-title">
            <strong>Mo Access</strong>
            <span>Always-on browser assistant</span>
          </div>
          <div class="panel-actions">
            <button class="icon-button" data-action="open-tab" title="Open in new tab" type="button">Open</button>
            <button class="icon-button" data-action="collapse" title="Minimize assistant" type="button">Hide</button>
          </div>
        </header>
        <iframe src="${iframeUrl()}" title="Mo Access assistant"></iframe>
      </section>
    </div>
  `;

  document.documentElement.appendChild(host);

  const widget = shadow.querySelector<HTMLButtonElement>(".widget");
  const panel = shadow.querySelector<HTMLElement>(".panel");
  const panelHeader = shadow.querySelector<HTMLElement>(".panel-header");
  const collapseButton = shadow.querySelector<HTMLButtonElement>("[data-action='collapse']");
  const openTabButton = shadow.querySelector<HTMLButtonElement>("[data-action='open-tab']");

  if (!widget || !panel || !panelHeader || !collapseButton || !openTabButton) {
    return;
  }

  const overlayWidget = widget;
  const overlayPanel = panel;
  const overlayHeader = panelHeader;
  const overlayCollapseButton = collapseButton;
  const overlayOpenTabButton = openTabButton;

  const overlayMetrics = {
    widthCollapsed: 248,
    heightCollapsed: 64,
    widthExpanded: 420,
    heightExpanded: 700
  };

  const state = { ...overlayState };

  function applyPosition() {
    const width = state.expanded ? overlayMetrics.widthExpanded : overlayMetrics.widthCollapsed;
    const height = state.expanded ? overlayMetrics.heightExpanded : overlayMetrics.heightCollapsed;
    const safeX = state.x ?? window.innerWidth - width - 24;
    const safeY = state.y ?? window.innerHeight - height - 24;
    const clampedX = clamp(safeX, 12, Math.max(12, window.innerWidth - width - 12));
    const clampedY = clamp(safeY, 12, Math.max(12, window.innerHeight - height - 12));

    state.x = clampedX;
    state.y = clampedY;
    host.style.left = `${clampedX}px`;
    host.style.top = `${clampedY}px`;
  }

  async function persistState() {
    await writeOverlayState(state);
  }

  async function setExpanded(nextExpanded: boolean) {
    state.expanded = nextExpanded;
    overlayPanel.classList.toggle("is-open", nextExpanded);
    overlayWidget.style.display = nextExpanded ? "none" : "inline-flex";
    applyPosition();
    await persistState();
  }

  let dragStartPointerX = 0;
  let dragStartPointerY = 0;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragging = false;

  function onPointerMove(event: PointerEvent) {
    if (!dragging) {
      return;
    }

    state.x = dragStartX + (event.clientX - dragStartPointerX);
    state.y = dragStartY + (event.clientY - dragStartPointerY);
    applyPosition();
  }

  async function onPointerUp() {
    if (!dragging) {
      return;
    }

    dragging = false;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    await persistState();
  }

  function startDragging(event: PointerEvent) {
    if (event.button !== 0) {
      return;
    }

    dragging = true;
    dragStartPointerX = event.clientX;
    dragStartPointerY = event.clientY;
    dragStartX = state.x ?? 0;
    dragStartY = state.y ?? 0;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  }

  overlayWidget.addEventListener("click", () => {
    void setExpanded(true);
  });
  overlayWidget.addEventListener("pointerdown", startDragging);
  overlayHeader.addEventListener("pointerdown", startDragging);
  overlayCollapseButton.addEventListener("click", () => {
    void setExpanded(false);
  });
  overlayOpenTabButton.addEventListener("click", () => {
    if (!isExtensionContextAvailable()) {
      return;
    }

    try {
      window.open(chrome.runtime.getURL("newtab.html"), "_blank");
    } catch {
      // Ignore clicks from stale content scripts after extension reloads.
    }
  });

  window.addEventListener("resize", () => {
    applyPosition();
    void persistState();
  });

  overlayWidget.style.display = state.expanded ? "none" : "inline-flex";
  applyPosition();
}
