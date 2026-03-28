import OpenAI from "openai";
import { env } from "../config";

let openaiClient: OpenAI | null = null;

export function getOpenAiClient() {
  if (!env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is not configured. Add it to the root .env file before using transcription or orchestration endpoints."
    );
  }

  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: env.OPENAI_API_KEY
    });
  }

  return openaiClient;
}
