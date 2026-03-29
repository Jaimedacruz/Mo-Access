import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AssistantSurface } from "@shared/assistant-ui/AssistantSurface";
import "../pages/assistant-page.css";

document.body.dataset.surface = "panel";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AssistantSurface
      eyebrow="Browser overlay"
      historyStorageKey="mo-access-extension-chat-history"
      showSamplePrompts={false}
      subhead="Ask for actions on the current page without leaving what you are doing."
      surface="panel"
      title="Mo Access"
    />
  </StrictMode>
);
