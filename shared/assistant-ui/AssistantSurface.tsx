import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { z } from "zod";
import {
  actionStepSchema,
  sampleCommands,
  safetyLevelSchema,
  statusLabels,
  type ActionPlan,
  type AssistantStatus,
  type Intent,
  type SafetyLevel
} from "../index";
import {
  getExtensionState,
  mapPlanToExtensionCommands,
  orchestrateTranscript,
  queueExtensionCommand,
  transcribeAudio
} from "./api";
import "./assistant-surface.css";

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
  tone?: "default" | "error";
  steps?: ActionPlan["steps"];
  safetyLevel?: SafetyLevel;
  notes?: string[];
};

type AssistantSurfaceProps = {
  eyebrow: string;
  title: string;
  subhead: string;
  historyStorageKey: string;
  surface: "web" | "newtab" | "panel";
  samplePrompts?: readonly string[];
  showSamplePrompts?: boolean;
};

const chatMessageSchema = z
  .object({
    id: z.string().min(1),
    role: z.enum(["assistant", "user"]),
    content: z.string().min(1),
    tone: z.enum(["default", "error"]).optional(),
    steps: z.array(actionStepSchema).optional(),
    safetyLevel: safetyLevelSchema.optional(),
    notes: z.array(z.string()).optional()
  })
  .strict();
const storedChatHistorySchema = z.array(chatMessageSchema);

function createId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  return `fallback-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildWelcomeMessage(title: string): ChatMessage {
  return {
    id: "welcome",
    role: "assistant",
    content: `Welcome to ${title}. Tell me what you want to do on the web and I'll turn it into executable browser actions when the request is clear.`
  };
}

function loadStoredMessages(historyStorageKey: string, fallbackMessages: ChatMessage[]) {
  if (typeof window === "undefined") {
    return fallbackMessages;
  }

  const rawValue = window.localStorage.getItem(historyStorageKey);
  if (!rawValue) {
    return fallbackMessages;
  }

  try {
    const parsed = storedChatHistorySchema.parse(JSON.parse(rawValue));
    return parsed.length > 0 ? parsed : fallbackMessages;
  } catch {
    window.localStorage.removeItem(historyStorageKey);
    return fallbackMessages;
  }
}

function buildAssistantReply(intent: Intent, plan: ActionPlan, assistantMessage: string | null): ChatMessage {
  const summary = intent.summary.endsWith(".") ? intent.summary : `${intent.summary}.`;
  const content = assistantMessage ?? `${summary} I prepared a plan for you.`;

  return {
    id: createId(),
    role: "assistant",
    content,
    steps: plan.steps,
    safetyLevel: plan.safetyLevel,
    notes: plan.notes
  };
}

function submitLabel(isBusy: boolean, typedCommand: string, audioFile: File | null) {
  if (isBusy) {
    return "Working...";
  }

  if (!typedCommand.trim() && audioFile) {
    return "Send voice";
  }

  return "Send";
}

export function AssistantSurface({
  eyebrow,
  title,
  subhead,
  historyStorageKey,
  surface,
  samplePrompts = sampleCommands,
  showSamplePrompts = true
}: AssistantSurfaceProps) {
  const initialMessages = [buildWelcomeMessage(title)];
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadStoredMessages(historyStorageKey, initialMessages));
  const [typedCommand, setTypedCommand] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [status, setStatus] = useState<AssistantStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const isBusy = status === "transcribing" || status === "parsing" || status === "planning";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  useEffect(() => {
    try {
      window.localStorage.setItem(historyStorageKey, JSON.stringify(messages));
    } catch {
      // Ignore storage failures and keep the current in-memory chat available.
    }
  }, [historyStorageKey, messages]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function addMessage(message: ChatMessage) {
    setMessages((previous) => [...previous, message]);
  }

  function addErrorMessage(message: string) {
    addMessage({
      id: createId(),
      role: "assistant",
      content: message,
      tone: "error"
    });
  }

  function conversationHistory() {
    return messages.map((message) => ({
      role: message.role,
      content: message.content
    }));
  }

  async function queuePlanExecution(plan: ActionPlan) {
    const commands = mapPlanToExtensionCommands(plan).filter((command) => {
      const step = plan.steps.find((candidate) => {
        if (candidate.type === "navigate" && command.type === "navigate") {
          return true;
        }
        if (candidate.type === "type" && command.type === "fill_field") {
          return true;
        }
        if (candidate.type === "click" && command.type === "click") {
          return true;
        }
        if (candidate.type === "extract_text" && command.type === "extract_text_blocks") {
          return true;
        }
        if (candidate.type === "search" && command.type === "navigate") {
          return true;
        }

        return false;
      });

      return step ? !step.requiresConfirmation : true;
    });

    if (commands.length === 0) {
      throw new Error("There are no executable browser steps yet. Add more detail if you want something specific to happen on the page.");
    }

    const bridgeState = await getExtensionState();
    for (const command of commands) {
      await queueExtensionCommand(command);
    }

    return {
      queuedCount: commands.length,
      extensionConnected: bridgeState.extensionConnected
    };
  }

  async function autoQueuePlanExecution(plan: ActionPlan) {
    const execution = await queuePlanExecution(plan);
    addMessage({
      id: createId(),
      role: "assistant",
      content: execution.extensionConnected
        ? `I queued ${execution.queuedCount} browser action${execution.queuedCount === 1 ? "" : "s"} for the extension.`
        : `I queued ${execution.queuedCount} browser action${execution.queuedCount === 1 ? "" : "s"}. Open the extension to let it pick them up.`,
      steps: plan.steps,
      safetyLevel: plan.safetyLevel
    });
  }

  async function sendTypedCommand(command: string) {
    const trimmed = command.trim();

    if (!trimmed) {
      setStatus("error");
      setError("Type a message or attach audio before sending.");
      return;
    }

    setError(null);
    addMessage({
      id: createId(),
      role: "user",
      content: trimmed
    });
    setTypedCommand("");
    setStatus("parsing");

    try {
      const result = await orchestrateTranscript(trimmed, {
        history: conversationHistory()
      });
      setStatus("planning");
      addMessage(buildAssistantReply(result.intent, result.plan, result.assistantMessage));
      await autoQueuePlanExecution(result.plan);
      setStatus("ready");
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : "I couldn't process that request.";
      setStatus("error");
      setError(message);
      addErrorMessage(message);
    }
  }

  async function sendAudioCommand(file: File) {
    setError(null);
    setStatus("transcribing");

    try {
      const { transcript } = await transcribeAudio(file);
      addMessage({
        id: createId(),
        role: "user",
        content: transcript
      });
      setAudioFile(null);
      setStatus("parsing");

      const result = await orchestrateTranscript(transcript, {
        history: conversationHistory()
      });
      setStatus("planning");
      addMessage(buildAssistantReply(result.intent, result.plan, result.assistantMessage));
      await autoQueuePlanExecution(result.plan);
      setStatus("ready");
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : "I couldn't process that audio clip.";
      setStatus("error");
      setError(message);
      addErrorMessage(message);
    }
  }

  async function handleSubmit() {
    if (isBusy) {
      return;
    }

    if (typedCommand.trim()) {
      await sendTypedCommand(typedCommand);
      return;
    }

    if (audioFile) {
      await sendAudioCommand(audioFile);
      return;
    }

    setStatus("error");
    setError("Type a message or attach audio before sending.");
  }

  async function startRecording() {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("error");
        setError("This browser does not support microphone recording.");
        return;
      }

      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);

      streamRef.current = stream;
      audioChunksRef.current = [];
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const mimeType = recorder.mimeType || "audio/webm";
        const recordedBlob = new Blob(audioChunksRef.current, { type: mimeType });
        const recordedFile = new File([recordedBlob], "voice-command.webm", { type: mimeType });
        setAudioFile(recordedFile);
        stream.getTracks().forEach((track) => track.stop());
        setIsRecording(false);
      };

      recorder.start();
      setIsRecording(true);
    } catch (caughtError) {
      setStatus("error");
      setError(caughtError instanceof Error ? caughtError.message : "Microphone access failed.");
    }
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current;

    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  }

  function handleSampleClick(command: string) {
    setTypedCommand(command);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSubmit();
    }
  }

  return (
    <main className={`assistant-surface surface-${surface}`}>
      <header className="assistant-topbar">
        <div>
          <p className="assistant-eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
        </div>
        <span className={`assistant-status-pill assistant-status-${status}`}>{statusLabels[status]}</span>
      </header>

      <section className="assistant-subhead">
        <p>{subhead}</p>
      </section>

      {showSamplePrompts ? (
        <section className="assistant-sample-row" aria-label="Sample prompts">
          {samplePrompts.map((command) => (
            <button className="assistant-sample-chip" key={command} onClick={() => handleSampleClick(command)} type="button">
              {command}
            </button>
          ))}
        </section>
      ) : null}

      <section className="assistant-chat-surface" aria-live="polite">
        <div className="assistant-messages">
          {messages.map((message) => (
            <article className={`assistant-message-row ${message.role}`} key={message.id}>
              <div className={`assistant-message-bubble ${message.role} ${message.tone === "error" ? "error" : ""}`}>
                <span className="assistant-message-label">
                  {message.role === "assistant" ? "Assistant" : "You"}
                </span>
                <p>{message.content}</p>

                {message.steps?.length ? (
                  <ol className="assistant-plan-list">
                    {message.steps.map((step, index) => (
                      <li key={`${message.id}-${step.type}-${index}`}>{step.description}</li>
                    ))}
                  </ol>
                ) : null}

                {message.notes?.length ? (
                  <div className="assistant-message-meta">
                    {message.safetyLevel ? (
                      <span className="assistant-meta-chip">Safety: {message.safetyLevel}</span>
                    ) : null}
                  </div>
                ) : null}

                {message.notes?.length ? (
                  <ul className="assistant-notes-list">
                    {message.notes.map((note) => (
                      <li key={`${message.id}-${note}`}>{note}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </article>
          ))}

          {isBusy ? (
            <div className="assistant-message-row assistant">
              <div className="assistant-message-bubble assistant assistant-typing-bubble">
                <span className="assistant-message-label">Assistant</span>
                <p>{statusLabels[status]}...</p>
              </div>
            </div>
          ) : null}

          <div ref={messagesEndRef} />
        </div>
      </section>

      <section className="assistant-composer-shell">
        {audioFile ? (
          <div className="assistant-attachment-row">
            <span className="assistant-attachment-pill">{audioFile.name} ready</span>
            <button className="assistant-text-button" onClick={() => setAudioFile(null)} type="button">
              Remove
            </button>
          </div>
        ) : null}

        {error ? <p className="assistant-composer-error">{error}</p> : null}

        <div className="assistant-composer">
          <textarea
            onChange={(event) => setTypedCommand(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder="Message the assistant..."
            rows={surface === "panel" ? 2 : 3}
            value={typedCommand}
          />

          <div className="assistant-composer-actions">
            <div className="assistant-composer-tools">
              <button
                className={`assistant-tool-button ${isRecording ? "recording" : ""}`}
                onClick={isRecording ? stopRecording : startRecording}
                type="button"
              >
                {isRecording ? "Stop" : "Voice"}
              </button>

              <label className="assistant-tool-button assistant-upload-button">
                Upload
                <input
                  accept="audio/*"
                  onChange={(event) => setAudioFile(event.target.files?.[0] ?? null)}
                  type="file"
                />
              </label>
            </div>

            <button className="assistant-send-button" disabled={isBusy} onClick={() => void handleSubmit()} type="button">
              {submitLabel(isBusy, typedCommand, audioFile)}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
