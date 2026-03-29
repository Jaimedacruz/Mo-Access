import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { z } from "zod";
import {
  actionStepSchema,
  sampleCommands,
  safetyLevelSchema,
  statusLabels,
  type ActionPlan,
  type AgentRun,
  type AgentRunStatus,
  type AssistantStatus,
  type Intent,
  type SafetyLevel
} from "../index";
import {
  cancelAgentRun,
  continueAgentRun,
  getAgentState,
  getExtensionCommandResult,
  startAgentRun,
  transcribeAudio
} from "./api";
import {
  buildErrorFeedbackEvent,
  buildExecutionFeedbackEvent,
  buildExecutionResultMessage,
  buildPlanFeedbackEvent,
  buildProcessingFeedbackEvent,
  type FeedbackEvent
} from "./feedback-events";
import { FeedbackSpeechController } from "./feedback-speech";
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
const voiceFeedbackStorageKey = "mo-access-voice-feedback-enabled";
const activeAgentStatuses: AgentRunStatus[] = ["running", "waiting_for_extension"];

function agentStatusLabel(status: AgentRunStatus) {
  return status.replace(/_/g, " ");
}

function agentTerminalMessage(run: AgentRun) {
  switch (run.status) {
    case "completed":
      return "I finished the full browser task.";
    case "blocked":
      return run.blockedReason ?? run.stopReason ?? "I got blocked and need a clearer instruction.";
    case "failed":
      return run.stopReason ?? "The agent run failed.";
    case "cancelled":
      return run.stopReason ?? "The agent run was cancelled.";
    case "paused":
      return run.stopReason ?? "The agent run is paused.";
    default:
      return null;
  }
}

function statusFromAgentRun(run: AgentRun | null): AssistantStatus {
  if (!run) {
    return "ready";
  }

  if (run.status === "running" || run.status === "waiting_for_extension") {
    return "planning";
  }

  if (run.status === "blocked" || run.status === "failed" || run.status === "cancelled") {
    return "error";
  }

  return "ready";
}

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

function loadStoredBoolean(storageKey: string, fallbackValue: boolean) {
  if (typeof window === "undefined") {
    return fallbackValue;
  }

  const rawValue = window.localStorage.getItem(storageKey);
  if (rawValue === null) {
    return fallbackValue;
  }

  return rawValue === "true";
}

function buildWelcomeMessage(title: string): ChatMessage {
  return {
    id: "welcome",
    role: "assistant",
    content: `Welcome to ${title}. Tell me what you want to do on the web and I'll execute clear browser tasks automatically.`
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
  const content = assistantMessage ?? `${summary} I'm executing it now.`;

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
  const [feedbackEvents, setFeedbackEvents] = useState<FeedbackEvent[]>([]);
  const [voiceFeedbackEnabled, setVoiceFeedbackEnabled] = useState<boolean>(() =>
    loadStoredBoolean(voiceFeedbackStorageKey, false)
  );
  const [agentRun, setAgentRun] = useState<AgentRun | null>(null);
  const [isAgentRequestPending, setIsAgentRequestPending] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const speechControllerRef = useRef<FeedbackSpeechController | null>(null);
  const processedCommandIdsRef = useRef<Set<string>>(new Set());
  const lastAnnouncedStepKeyRef = useRef<string | null>(null);
  const lastTerminalRunKeyRef = useRef<string | null>(null);
  const isAgentActive = agentRun ? activeAgentStatuses.includes(agentRun.status) : false;
  const isBusy =
    status === "transcribing" || status === "parsing" || status === "planning" || isAgentRequestPending || isAgentActive;

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
    speechControllerRef.current = new FeedbackSpeechController();

    return () => {
      speechControllerRef.current?.destroy();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(voiceFeedbackStorageKey, String(voiceFeedbackEnabled));
    } catch {
      // Ignore preference persistence failures.
    }

    if (!voiceFeedbackEnabled) {
      speechControllerRef.current?.cancel();
    }
  }, [voiceFeedbackEnabled]);

  useEffect(() => {
    let isCancelled = false;

    void getAgentState()
      .then((response) => {
        if (!isCancelled && response.agentRun) {
          void syncAgentRun(response.agentRun);
        }
      })
      .catch(() => {
        // Ignore bootstrap agent state failures in the UI.
      });

    return () => {
      isCancelled = true;
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

  function addFeedbackEvent(event: FeedbackEvent) {
    setFeedbackEvents((previous) => {
      const lastEvent = previous[previous.length - 1];
      if (lastEvent && lastEvent.message === event.message && lastEvent.type === event.type) {
        return previous;
      }

      return [...previous.slice(-4), event];
    });

    if (!voiceFeedbackEnabled || !event.shouldSpeak) {
      return;
    }

    void speechControllerRef.current?.speakFeedback(event.message, {
      priority: event.priority,
      interrupt: event.priority === "high"
    }).catch((error) => {
      console.error("Voice feedback failed.", error);
    });
  }

  function conversationHistory() {
    return messages.map((message) => ({
      role: message.role,
      content: message.content
    }));
  }

  async function waitForCommandResult(commandId: string, timeoutMs = 12000) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      try {
        return await getExtensionCommandResult(commandId);
      } catch (error) {
        if (!(error instanceof Error) || !/No result found/i.test(error.message)) {
          throw error;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 600));
    }

    throw new Error(`Timed out waiting for extension result ${commandId}.`);
  }

  async function syncAgentRun(nextRun: AgentRun | null) {
    setAgentRun(nextRun);
    setStatus(statusFromAgentRun(nextRun));

    if (!nextRun) {
      return;
    }

    const currentStepKey =
      nextRun.currentStepIndex !== null && activeAgentStatuses.includes(nextRun.status)
        ? `${nextRun.id}:${nextRun.currentStepIndex}:${nextRun.status}`
        : null;

    if (currentStepKey && currentStepKey !== lastAnnouncedStepKeyRef.current && nextRun.currentStepDescription) {
      lastAnnouncedStepKeyRef.current = currentStepKey;
      addFeedbackEvent({
        id: createId(),
        type: "progress",
        message: `Now working on: ${nextRun.currentStepDescription}`,
        shouldSpeak: true,
        priority: "normal"
      });
    }

    for (const step of nextRun.steps) {
      if (
        !step.commandId ||
        processedCommandIdsRef.current.has(step.commandId) ||
        (step.status !== "completed" && step.status !== "blocked")
      ) {
        continue;
      }

      processedCommandIdsRef.current.add(step.commandId);

      try {
        const result = await waitForCommandResult(step.commandId, 2_000);
        addFeedbackEvent(buildExecutionFeedbackEvent(result));
        const executionMessage = buildExecutionResultMessage(result);
        addMessage({
          id: createId(),
          role: "assistant",
          content: executionMessage.content,
          tone: executionMessage.tone
        });
      } catch {
        addMessage({
          id: createId(),
          role: "assistant",
          content:
            step.resultMessage ??
            (step.status === "completed" ? `${step.description} completed.` : `${step.description} could not be completed.`),
          tone: step.status === "blocked" ? "error" : "default"
        });
      }
    }

    if (
      !activeAgentStatuses.includes(nextRun.status) &&
      nextRun.status !== "idle" &&
      lastTerminalRunKeyRef.current !== `${nextRun.id}:${nextRun.status}`
    ) {
      lastTerminalRunKeyRef.current = `${nextRun.id}:${nextRun.status}`;
      const terminalMessage = agentTerminalMessage(nextRun);
      if (terminalMessage) {
        addFeedbackEvent({
          id: createId(),
          type: nextRun.status === "completed" ? "success" : nextRun.status === "paused" ? "warning" : "error",
          message: terminalMessage,
          shouldSpeak: true,
          priority: nextRun.status === "completed" ? "normal" : "high"
        });
        addMessage({
          id: createId(),
          role: "assistant",
          content: terminalMessage,
          tone: nextRun.status === "completed" ? "default" : "error"
        });
      }
    }
  }

  async function advanceAgentRun(maxSteps = 1) {
    setIsAgentRequestPending(true);

    try {
      const result = await continueAgentRun(maxSteps);
      await syncAgentRun(result.agentRun);
    } finally {
      setIsAgentRequestPending(false);
    }
  }

  useEffect(() => {
    if (!agentRun || agentRun.status !== "running" || isAgentRequestPending) {
      return;
    }

    void advanceAgentRun(1).catch((caughtError) => {
      const message =
        caughtError instanceof Error ? caughtError.message : "The agent could not continue the current task.";
      setStatus("error");
      setError(message);
      addFeedbackEvent(buildErrorFeedbackEvent(message));
      addErrorMessage(message);
    });
  }, [agentRun?.id, agentRun?.status, agentRun?.updatedAt, isAgentRequestPending]);

  useEffect(() => {
    if (!agentRun || agentRun.status !== "waiting_for_extension" || isAgentRequestPending) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void getAgentState()
        .then((response) => syncAgentRun(response.agentRun))
        .catch(() => {
          // Ignore transient polling failures while the extension is processing.
        });
    }, 1000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [agentRun?.id, agentRun?.status, agentRun?.updatedAt, isAgentRequestPending]);

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
    processedCommandIdsRef.current = new Set();
    lastAnnouncedStepKeyRef.current = null;
    lastTerminalRunKeyRef.current = null;
    setAgentRun(null);
    setTypedCommand("");
    setStatus("parsing");
    addFeedbackEvent(buildProcessingFeedbackEvent("Understanding your request."));

    try {
      const result = await startAgentRun(trimmed, {
        history: conversationHistory()
      });
      setStatus("planning");
      addMessage(buildAssistantReply(result.intent, result.plan, null));
      addFeedbackEvent(buildPlanFeedbackEvent(result.plan));
      await syncAgentRun(result.agentRun);
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : "I couldn't process that request.";
      setStatus("error");
      setError(message);
      addFeedbackEvent(buildErrorFeedbackEvent(message));
      addErrorMessage(message);
    }
  }

  async function sendAudioCommand(file: File) {
    setError(null);
    setStatus("transcribing");
    addFeedbackEvent(buildProcessingFeedbackEvent("Transcribing your audio."));

    try {
      const { transcript } = await transcribeAudio(file);
      addMessage({
        id: createId(),
        role: "user",
        content: transcript
      });
      processedCommandIdsRef.current = new Set();
      lastAnnouncedStepKeyRef.current = null;
      lastTerminalRunKeyRef.current = null;
      setAgentRun(null);
      setAudioFile(null);
      setStatus("parsing");
      addFeedbackEvent(buildProcessingFeedbackEvent("Understanding your request."));

      const result = await startAgentRun(transcript, {
        history: conversationHistory()
      });
      setStatus("planning");
      addMessage(buildAssistantReply(result.intent, result.plan, null));
      addFeedbackEvent(buildPlanFeedbackEvent(result.plan));
      await syncAgentRun(result.agentRun);
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : "I couldn't process that audio clip.";
      setStatus("error");
      setError(message);
      addFeedbackEvent(buildErrorFeedbackEvent(message));
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

  async function handleCancelAgent() {
    try {
      const result = await cancelAgentRun();
      await syncAgentRun(result.agentRun);
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "The agent could not be cancelled.";
      setStatus("error");
      setError(message);
      addFeedbackEvent(buildErrorFeedbackEvent(message));
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

  const latestFeedback = feedbackEvents[feedbackEvents.length - 1] ?? null;

  return (
    <main className={`assistant-surface surface-${surface}`}>
      <header className="assistant-topbar">
        <div>
          <p className="assistant-eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
        </div>
        <div className="assistant-topbar-actions">
          <button
            aria-pressed={voiceFeedbackEnabled}
            className={`assistant-voice-toggle ${voiceFeedbackEnabled ? "enabled" : ""}`}
            onClick={() => setVoiceFeedbackEnabled((previous) => !previous)}
            type="button"
          >
            Voice feedback: {voiceFeedbackEnabled ? "On" : "Off"}
          </button>
          <span className={`assistant-status-pill assistant-status-${status}`}>{statusLabels[status]}</span>
          {agentRun ? (
            <span className={`assistant-agent-pill assistant-agent-${agentRun.status}`}>
              Agent: {agentStatusLabel(agentRun.status)}
            </span>
          ) : null}
        </div>
      </header>

      <section className="assistant-subhead">
        <p>{subhead}</p>
      </section>

      {latestFeedback ? (
        <section
          aria-live="polite"
          className={`assistant-feedback-banner assistant-feedback-${latestFeedback.type}`}
          role="status"
        >
          <span className="assistant-feedback-label">Current feedback</span>
          <p>{latestFeedback.message}</p>
        </section>
      ) : null}

      {agentRun ? (
        <section className="assistant-agent-panel" aria-label="Agent run status">
          <div className="assistant-agent-summary">
            <div>
              <span className="assistant-feedback-label">Current goal</span>
              <p>{agentRun.goal}</p>
            </div>
            <div>
              <span className="assistant-feedback-label">Progress</span>
              <p>
                {agentRun.completedSteps} of {agentRun.totalSteps} steps completed
              </p>
            </div>
            {agentRun.currentStepDescription ? (
              <div>
                <span className="assistant-feedback-label">Current step</span>
                <p>{agentRun.currentStepDescription}</p>
              </div>
            ) : null}
            {agentRun.blockedReason ? (
              <div>
                <span className="assistant-feedback-label">Blocked reason</span>
                <p>{agentRun.blockedReason}</p>
              </div>
            ) : null}
          </div>

          <div className="assistant-agent-actions">
            {agentRun.status !== "completed" && agentRun.status !== "cancelled" ? (
              <button className="assistant-text-button" onClick={() => void handleCancelAgent()} type="button">
                Cancel
              </button>
            ) : null}
          </div>

          <ol className="assistant-agent-step-list">
            {agentRun.steps.map((step) => (
              <li key={`${agentRun.id}-${step.index}`} className={`assistant-agent-step assistant-agent-step-${step.status}`}>
                <span className="assistant-agent-step-index">{step.index + 1}</span>
                <div>
                  <strong>{step.description}</strong>
                  <p>{step.resultMessage ?? step.status.replace(/_/g, " ")}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

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
