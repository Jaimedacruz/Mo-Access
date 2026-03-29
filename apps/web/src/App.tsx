import { AssistantSurface } from "@shared/assistant-ui/AssistantSurface";

export default function App() {
  return (
    <AssistantSurface
      eyebrow="Voice assistant"
      historyStorageKey="mo-access-chat-history"
      showSamplePrompts={true}
      subhead="Speak or type what you want to do. The assistant turns clear requests into browser actions and only pauses when the request is too vague to execute safely."
      surface="web"
      title="Voice Access Planner"
    />
  );
}
