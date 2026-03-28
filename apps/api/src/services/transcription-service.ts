import { env } from "../config";
import { getOpenAiClient } from "../lib/openai";

type AudioUpload = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
};

export async function transcribeAudio(audioFile: AudioUpload) {
  const openai = getOpenAiClient();
  const file = new File([new Uint8Array(audioFile.buffer)], audioFile.originalname, {
    type: audioFile.mimetype
  });

  const transcription = await openai.audio.transcriptions.create({
    file,
    model: env.OPENAI_TRANSCRIPTION_MODEL,
    response_format: "json"
  });

  return transcription.text.trim();
}
