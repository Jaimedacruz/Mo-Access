import express from "express";
import {
  extensionBridgeStateSchema,
  extensionCommandResultSchema,
  extensionExecuteRequestSchema,
  extensionExecuteResponseSchema,
  extensionHeartbeatSchema,
  extensionPageContextSchema
} from "../../../../shared/index";
import {
  enqueueExtensionCommand,
  getExtensionBridgeState,
  getNextExtensionCommand,
  recordExtensionHeartbeat,
  recordExtensionPageContext,
  recordExtensionResult
} from "../services/extension-bridge-service";

export const extensionRouter = express.Router();

extensionRouter.get("/health", (_request, response) => {
  response.json(
    extensionBridgeStateSchema.parse(getExtensionBridgeState())
  );
});

extensionRouter.get("/next-command", (_request, response) => {
  response.json(getNextExtensionCommand());
});

extensionRouter.post("/execute", (request, response, next) => {
  try {
    const { command } = extensionExecuteRequestSchema.parse(request.body);

    response.json(
      extensionExecuteResponseSchema.parse(enqueueExtensionCommand(command))
    );
  } catch (error) {
    next(error);
  }
});

extensionRouter.post("/heartbeat", (request, response, next) => {
  try {
    const heartbeat = extensionHeartbeatSchema.parse(request.body);
    recordExtensionHeartbeat(heartbeat);

    response.json({
      ok: true
    });
  } catch (error) {
    next(error);
  }
});

extensionRouter.post("/result", (request, response, next) => {
  try {
    const result = extensionCommandResultSchema.parse(request.body);
    recordExtensionResult(result);

    response.json({
      ok: true
    });
  } catch (error) {
    next(error);
  }
});

extensionRouter.post("/page-context", (request, response, next) => {
  try {
    const pageContext = extensionPageContextSchema.parse(request.body);
    recordExtensionPageContext(pageContext);

    response.json({
      ok: true
    });
  } catch (error) {
    next(error);
  }
});

extensionRouter.get("/state", (_request, response) => {
  response.json(
    extensionBridgeStateSchema.parse(getExtensionBridgeState())
  );
});
