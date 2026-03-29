import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AssistantSurface } from "@shared/assistant-ui/AssistantSurface";
import "../pages/assistant-page.css";

document.body.dataset.surface = "newtab";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AssistantSurface
      eyebrow="Always-on browser assistant"
      historyStorageKey="mo-access-extension-chat-history"
      showSamplePrompts={true}
      subhead="Start browsing with your assistant already open. Ask it to read pages, search the web, fill forms, or help you work across sites."
      surface="newtab"
      title="Mo Access"
    />
  </StrictMode>
);
