import express from "express";
import multer from "multer";
import {
  actionPlanResponseSchema,
  intentSchema,
  orchestrateRequestSchema,
  orchestratorResponseSchema,
  parseIntentRequestSchema,
  parseIntentResponseSchema,
  planRequestSchema,
  transcriptionResponseSchema
} from "../../../../shared/index";
import { env } from "../config";
import { buildActionPlan } from "../services/action-planner-service";
import { parseIntent } from "../services/intent-parser-service";
import { transcribeAudio } from "../services/transcription-service";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024
  }
});

export const orchestratorRouter = express.Router();

orchestratorRouter.get("/health", (_request, response) => {
  response.json({
    ok: true,
    openAiConfigured: Boolean(env.OPENAI_API_KEY)
  });
});

orchestratorRouter.post(
  "/speech-to-text",
  upload.single("audio"),
  async (request, response, next) => {
    try {
      if (!request.file) {
        response.status(400).json({
          error: "No audio file was provided."
        });
        return;
      }

      const transcript = await transcribeAudio(request.file);

      response.json(
        transcriptionResponseSchema.parse({
          transcript
        })
      );
    } catch (error) {
      next(error);
    }
  }
);

orchestratorRouter.post("/parse-intent", async (request, response, next) => {
  try {
    const { transcript } = parseIntentRequestSchema.parse(request.body);
    const intent = await parseIntent(transcript);

    response.json(
      parseIntentResponseSchema.parse({
        intent
      })
    );
  } catch (error) {
    next(error);
  }
});

orchestratorRouter.post("/plan", async (request, response, next) => {
  try {
    const { intent } = planRequestSchema.parse(request.body);
    const validatedIntent = intentSchema.parse(intent);
    const plan = buildActionPlan(validatedIntent);

    response.json(
      actionPlanResponseSchema.parse({
        plan
      })
    );
  } catch (error) {
    next(error);
  }
});

orchestratorRouter.post("/orchestrate", async (request, response, next) => {
  try {
    const { transcript } = orchestrateRequestSchema.parse(request.body);
    const intent = await parseIntent(transcript);
    const plan = buildActionPlan(intent);

    response.json(
      orchestratorResponseSchema.parse({
        transcript,
        intent,
        plan,
        statusMessages: [
          "Transcript received.",
          `Intent classified as ${intent.type}.`,
          `Generated ${plan.steps.length} extension-ready command${plan.steps.length === 1 ? "" : "s"}.`
        ]
      })
    );
  } catch (error) {
    next(error);
  }
});
