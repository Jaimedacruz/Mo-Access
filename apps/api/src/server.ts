import cors from "cors";
import express from "express";
import { ZodError } from "zod";
import { env } from "./config";
import { orchestratorRouter } from "./routes/orchestrator-routes";

const app = express();

app.use(
  cors({
    origin: env.WEB_ORIGIN
  })
);
app.use(express.json({ limit: "1mb" }));

app.use("/api", orchestratorRouter);

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error instanceof ZodError) {
    response.status(400).json({
      error: "Validation failed.",
      details: error.flatten()
    });
    return;
  }

  if (error instanceof Error) {
    response.status(500).json({
      error: error.message
    });
    return;
  }

  response.status(500).json({
    error: "Unexpected server error."
  });
});

app.listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`);
});
