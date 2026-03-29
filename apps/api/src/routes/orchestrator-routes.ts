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
import { getExtensionBridgeState, getLastExtensionPageContext, requestFreshPageContext } from "../services/extension-bridge-service";
import { parseIntent } from "../services/intent-parser-service";
import { summarizePageContext } from "../services/page-summary-service";
import {
  buildSessionContextForParser,
  recordSessionIntentPlan
} from "../services/session-state-service";
import { transcribeAudio } from "../services/transcription-service";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024
  }
});

export const orchestratorRouter = express.Router();

function shouldRefreshPageContext(transcript: string) {
  const normalized = transcript.toLowerCase();

  return (
    /(this page|this site|this website|current tab|on this page|on this site|read this|summari[sz]e this|what is on this|what is written on this)/i.test(
      normalized
    ) ||
    /\b(it|this|that|here)\b/i.test(normalized) ||
    /\b(click|press|send|submit|continue|type|fill|read|summari[sz]e)\b/i.test(normalized)
  );
}

function buildPageContextSummary(pageContext: ReturnType<typeof getLastExtensionPageContext>) {
  if (!pageContext) {
    return null;
  }

  return `Title: ${pageContext.title}\nURL: ${pageContext.url}\nVisible text sample:\n${pageContext.textBlocks
    .slice(0, 12)
    .map((block) => `- ${block.text}`)
    .join("\n")}`;
}

async function resolvePageContextForTurn(transcript: string) {
  const bridgeState = getExtensionBridgeState();

  if (!bridgeState.extensionConnected || !shouldRefreshPageContext(transcript)) {
    return getLastExtensionPageContext();
  }

  return requestFreshPageContext();
}

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
    const { transcript, history, pendingConfirmation } = parseIntentRequestSchema.parse(request.body);
    const pageContext = await resolvePageContextForTurn(transcript);
    const sessionContext = buildSessionContextForParser();
    const intent = await parseIntent(transcript, {
      history,
      pendingConfirmation,
      lastIntent: sessionContext.lastIntent,
      lastPlan: sessionContext.lastPlan,
      lastExtensionResult: sessionContext.lastExtensionResult,
      currentPageContext: pageContext ?? sessionContext.currentPageContext,
      pageContextSummary: buildPageContextSummary(pageContext),
      sessionStateSummary: sessionContext.sessionStateSummary,
      lastIntentSummary: sessionContext.lastIntentSummary,
      lastPlanSummary: sessionContext.lastPlanSummary,
      lastExtensionResultSummary: sessionContext.lastExtensionResultSummary,
      currentPageContextSummary: buildPageContextSummary(pageContext) ?? sessionContext.currentPageContextSummary
    });

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
    const { transcript, history, pendingConfirmation } = orchestrateRequestSchema.parse(request.body);
    const pageContext = await resolvePageContextForTurn(transcript);
    const sessionContext = buildSessionContextForParser();
    const intent = await parseIntent(transcript, {
      history,
      pendingConfirmation,
      lastIntent: sessionContext.lastIntent,
      lastPlan: sessionContext.lastPlan,
      lastExtensionResult: sessionContext.lastExtensionResult,
      currentPageContext: pageContext ?? sessionContext.currentPageContext,
      pageContextSummary: buildPageContextSummary(pageContext),
      sessionStateSummary: sessionContext.sessionStateSummary,
      lastIntentSummary: sessionContext.lastIntentSummary,
      lastPlanSummary: sessionContext.lastPlanSummary,
      lastExtensionResultSummary: sessionContext.lastExtensionResultSummary,
      currentPageContextSummary: buildPageContextSummary(pageContext) ?? sessionContext.currentPageContextSummary
    });
    const plan = buildActionPlan(intent);
    recordSessionIntentPlan(intent, plan, pageContext);
    const wantsSummary =
      intent.type === "read_page" &&
      pageContext &&
      (intent.currentPage || transcript.toLowerCase().includes("this page") || transcript.toLowerCase().includes("this website")) &&
      /(overview|summary|summari[sz]e|brief|what is on this page|what's on this page|what is written on this page|what's written on this page)/i.test(
        transcript
      );

    const assistantMessage = wantsSummary
      ? await summarizePageContext(transcript, pageContext)
      : null;

    response.json(
      orchestratorResponseSchema.parse({
        transcript,
        intent,
        plan,
        statusMessages: [
          "Transcript received.",
          `Intent classified as ${intent.type}.`,
          `Generated ${plan.steps.length} extension-ready command${plan.steps.length === 1 ? "" : "s"}.`
        ],
        assistantMessage
      })
    );
  } catch (error) {
    next(error);
  }
});
