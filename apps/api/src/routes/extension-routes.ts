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
  getExtensionCommand,
  getExtensionBridgeState,
  getNextExtensionCommand,
  getExtensionResult,
  recordExtensionHeartbeat,
  recordExtensionPageContext,
  recordExtensionResult
} from "../services/extension-bridge-service";
import {
  recordSessionCommand,
  recordSessionHeartbeat,
  recordSessionPageContext,
  recordSessionResult
} from "../services/session-state-service";

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
    recordSessionCommand(command);

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
    recordSessionHeartbeat(heartbeat);

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
    recordSessionResult(result, getExtensionCommand(result.commandId));

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
    recordSessionPageContext(pageContext);

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

extensionRouter.get("/result/:commandId", (request, response) => {
  const result = getExtensionResult(request.params.commandId);

  if (!result) {
    response.status(404).json({
      error: `No result found for command ${request.params.commandId}.`
    });
    return;
  }

  response.json(result);
});
