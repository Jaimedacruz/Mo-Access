import type { FeedbackSpeechVoice } from "../index";
import { synthesizeFeedbackAudio } from "./api";

type SpeakFeedbackOptions = {
  priority?: "normal" | "high";
  voice?: FeedbackSpeechVoice;
  interrupt?: boolean;
};

export class FeedbackSpeechController {
  private audio: HTMLAudioElement | null = null;
  private audioUrl: string | null = null;
  private requestController: AbortController | null = null;
  private queuedRequest: { text: string; options?: SpeakFeedbackOptions } | null = null;
  private lastSpokenText = "";
  private lastSpokenAt = 0;

  private flushQueuedRequest() {
    if (!this.queuedRequest) {
      return;
    }

    const nextRequest = this.queuedRequest;
    this.queuedRequest = null;
    void this.speakFeedback(nextRequest.text, nextRequest.options).catch(() => {
      // Ignore queued speech failures because visual feedback remains available.
    });
  }

  private cleanupAudio() {
    if (this.audio) {
      this.audio.pause();
      this.audio.src = "";
      this.audio = null;
    }

    if (this.audioUrl) {
      URL.revokeObjectURL(this.audioUrl);
      this.audioUrl = null;
    }
  }

  cancel() {
    this.requestController?.abort();
    this.requestController = null;
    this.queuedRequest = null;
    this.cleanupAudio();
  }

  destroy() {
    this.cancel();
  }

  async speakFeedback(text: string, options?: SpeakFeedbackOptions) {
    const normalizedText = text.trim();
    if (!normalizedText) {
      return false;
    }

    const now = Date.now();
    const isDuplicate = normalizedText === this.lastSpokenText && now - this.lastSpokenAt < 6000;
    const minimumSpacingMs = options?.priority === "high" ? 350 : 1400;
    if (isDuplicate || now - this.lastSpokenAt < minimumSpacingMs) {
      return false;
    }

    if (options?.interrupt ?? false) {
      this.cancel();
    } else if ((this.audio && !this.audio.paused) || this.requestController) {
      this.queuedRequest = {
        text: normalizedText,
        options
      };
      return true;
    }

    const controller = new AbortController();
    this.requestController = controller;

    try {
      const audioBlob = await synthesizeFeedbackAudio(
        {
          text: normalizedText,
          voice: options?.voice
        },
        { signal: controller.signal }
      );

      if (controller.signal.aborted) {
        return false;
      }

      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);

      this.audio = audio;
      this.audioUrl = audioUrl;

      audio.onended = () => {
        this.cleanupAudio();
        this.flushQueuedRequest();
      };
      audio.onerror = () => {
        this.cleanupAudio();
        this.flushQueuedRequest();
      };

      await audio.play();

      this.lastSpokenText = normalizedText;
      this.lastSpokenAt = Date.now();
      return true;
    } catch (error) {
      if (controller.signal.aborted) {
        return false;
      }

      this.cleanupAudio();
      throw error;
    } finally {
      if (this.requestController === controller) {
        this.requestController = null;
      }
    }
  }
}
