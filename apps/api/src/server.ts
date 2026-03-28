import cors from "cors";
import express from "express";
import { ZodError } from "zod";
import { env } from "./config";
import { extensionRouter } from "./routes/extension-routes";
import { orchestratorRouter } from "./routes/orchestrator-routes";

const app = express();
const explicitlyAllowedOrigins = new Set(
  [env.WEB_ORIGIN, ...(env.WEB_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? [])]
);

function isPrivateIpv4(hostname: string) {
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    return true;
  }

  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    return true;
  }

  const match = hostname.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (!match) {
    return false;
  }

  const secondOctet = Number(match[1]);
  return secondOctet >= 16 && secondOctet <= 31;
}

function isAllowedBrowserOrigin(origin: string) {
  if (explicitlyAllowedOrigins.has(origin) || origin.startsWith("chrome-extension://")) {
    return true;
  }

  try {
    const parsed = new URL(origin);
    const isDevPort = parsed.port === "5173";
    const isLocalHost =
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname.endsWith(".local");

    return isDevPort && (isLocalHost || isPrivateIpv4(parsed.hostname));
  } catch {
    return false;
  }
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || isAllowedBrowserOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} is not allowed by CORS.`));
    }
  })
);
app.use(express.json({ limit: "1mb" }));

app.use("/api", orchestratorRouter);
app.use("/api/extension", extensionRouter);

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
