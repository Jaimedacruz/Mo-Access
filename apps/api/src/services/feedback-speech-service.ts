import type { FeedbackSpeechVoice } from "../../../../shared/index";
import { env } from "../config";
import { getOpenAiClient } from "../lib/openai";

type SynthesizeFeedbackAudioOptions = {
  voice?: FeedbackSpeechVoice;
};

export async function synthesizeFeedbackAudio(
  text: string,
  options?: SynthesizeFeedbackAudioOptions
) {
  const normalizedText = text.trim();
  if (!normalizedText) {
    throw new Error("Feedback speech text cannot be empty.");
  }

  const openai = getOpenAiClient();
  const response = await openai.audio.speech.create({
    model: env.OPENAI_TTS_MODEL,
    voice: options?.voice ?? env.OPENAI_TTS_VOICE,
    input: normalizedText,
    response_format: "mp3",
    instructions: "Speak calmly, clearly, and concisely for accessibility feedback. Use plain language and avoid sounding rushed."
  });

  return Buffer.from(await response.arrayBuffer());
}
