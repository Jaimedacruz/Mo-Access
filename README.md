# Voice Access Planner MVP

Local-first hackathon MVP for an accessibility-focused assistant that turns voice or typed browser requests into safe, browser-extension-ready commands.

This iteration does not automate the browser. It only:

- transcribes audio with OpenAI speech-to-text
- parses the request into a validated intent
- plans extension-ready commands
- surfaces transcript, intent, plan, and safety notes in a transparent UI

## What It Includes

- Accessible React + TypeScript frontend
- Express + TypeScript orchestration API
- Chrome extension execution layer built with Manifest V3
- Shared Zod schemas for request and response contracts
- Browser recording and audio upload support
- Typed command fallback for demos
- Deterministic action planner that stays separate from future execution logic

## Stack

- Frontend: React, Vite, TypeScript
- Backend: Node.js, Express, TypeScript
- Extension: Manifest V3, TypeScript, Vite
- Validation: Zod
- OpenAI API:
  - `gpt-4o-mini-transcribe` for speech-to-text
  - `gpt-5.4-mini` for structured intent parsing
  - `gpt-4o-mini-tts` for optional spoken feedback

## Project Structure

```text
.
|-- apps
|   |-- api
|   |   `-- src
|   |       |-- config.ts
|   |       |-- lib/openai.ts
|   |       |-- prompts/intent-parser-prompt.ts
|   |       |-- routes/extension-routes.ts
|   |       |-- routes/orchestrator-routes.ts
|   |       |-- services/action-planner-service.ts
|   |       |-- services/extension-bridge-service.ts
|   |       |-- services/intent-parser-service.ts
|   |       |-- services/transcription-service.ts
|   |       `-- server.ts
|   `-- extension
|       |-- public/manifest.json
|       |-- popup.html
|       |-- src
|       |   |-- background
|       |   |   |-- commandRouter.ts
|       |   |   |-- index.ts
|       |   |   `-- orchestratorClient.ts
|       |   |-- content
|       |   |   |-- dom/actions.ts
|       |   |   |-- dom/extractPageContext.ts
|       |   |   |-- dom/findClickable.ts
|       |   |   |-- dom/findField.ts
|       |   |   |-- dom/highlight.ts
|       |   |   `-- index.ts
|       |   |-- popup
|       |   |   |-- index.ts
|       |   |   `-- styles.css
|       |   `-- shared
|       |       |-- normalize.ts
|       |       |-- runtime.ts
|       |       `-- scoring.ts
|       `-- vite.config.ts
|   `-- web
|       |-- src
|       |   |-- api.ts
|       |   |-- App.tsx
|       |   |-- components/CopyButton.tsx
|       |   |-- main.tsx
|       |   `-- styles.css
|       |-- index.html
|       `-- vite.config.ts
|-- shared
|   |-- extension-schemas.ts
|   |-- index.ts
|   |-- sample-commands.ts
|   `-- schemas.ts
|-- .env.example
`-- README.md
```

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a root `.env` file from `.env.example`.

3. Add your OpenAI API key:

   ```env
   OPENAI_API_KEY=your_openai_api_key
   ```

4. Start the app:

   ```bash
   npm run dev
   ```

5. Open `http://localhost:5173`.

The API runs on `http://localhost:8787`.

## Environment Variables

```env
OPENAI_API_KEY=your_openai_api_key
OPENAI_REASONING_MODEL=gpt-5.4-mini
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TTS_VOICE=sage
PORT=8787
WEB_ORIGIN=http://localhost:5173
VITE_API_BASE_URL=http://localhost:8787
```

If the API key is missing, the server still starts, but transcription and orchestration endpoints will return a clear configuration error.

## Scripts

- `npm run dev` starts the API and frontend together
- `npm run build:extension` builds only the Chrome extension into `dist/extension`
- `npm run check` runs TypeScript checks
- `npm run build` builds the API, frontend, and Chrome extension into `dist/`

## API Endpoints

- `GET /api/health`
  - Returns API health and whether OpenAI is configured
- `POST /api/speech-to-text`
  - Multipart form-data with `audio`
  - Returns `{ transcript }`
- `POST /api/feedback/speech`
  - Body: `{ "text": "Opening the page now.", "voice": "sage" }`
  - Returns `audio/mpeg`
- `POST /api/parse-intent`
  - Body: `{ "transcript": "..." }`
  - Returns `{ intent }`
- `POST /api/plan`
  - Body: `{ "intent": { ... } }`
  - Returns `{ plan }`
- `POST /api/orchestrate`
  - Body: `{ "transcript": "..." }`
  - Returns transcript, parsed intent, action plan, and status messages

### Extension Bridge Endpoints

- `GET /api/extension/health`
  - Returns extension connection state, pending commands, last heartbeat, last result, and last page context
- `POST /api/extension/execute`
  - Body: `{ "command": { ... } }`
  - Queues one extension command for the background worker
- `GET /api/extension/next-command`
  - Polled by the extension background worker
- `POST /api/extension/heartbeat`
  - Receives extension version, readiness, and active tab metadata
- `POST /api/extension/result`
  - Receives structured command execution results
- `POST /api/extension/page-context`
  - Receives structured page context snapshots from the extension
- `GET /api/extension/state`
  - Returns the current in-memory extension bridge state

## Supported Intent Types

- `open_page`
- `fill_form`
- `read_page`
- `compose_message`
- `search_web`

## Supported Command Types

- `navigate`
- `click`
- `type`
- `extract_text`
- `confirm`
- `search`
- `compose_message`

## Demo Flow

1. Record or upload audio, or type a command.
2. The frontend sends audio to `/api/speech-to-text`.
3. The transcript is displayed immediately.
4. The frontend sends the transcript to `/api/orchestrate`.
5. The backend parses the intent using a strict JSON schema.
6. The backend builds a deterministic extension-ready plan.
7. The UI shows transcript, validated intent JSON, planned steps, status messages, and safety notes.

## Safety Model

- Requests with side effects are marked conservatively.
- Message drafting and form workflows require confirmation.
- The planner never executes the command.
- The output is designed for a later browser extension integration layer.

## Notes

- The planner is intentionally independent from execution.
- Voice and reasoning integrations are isolated in backend services.
- Shared Zod schemas keep the UI and API contracts aligned.
- Spoken feedback is optional, off by default, and generated server-side through OpenAI TTS.
- If TTS fails, the UI continues visually without blocking the workflow.

## Chrome Extension

The extension is the deterministic execution layer. It does not call OpenAI directly and does not perform planning. It polls the local API, executes one structured command at a time on the active tab, and posts results back to the API.

### Build the extension

```bash
npm install
npm run build:extension
```

The unpacked extension output is written to `dist/extension`.

### Load unpacked in Chrome

1. Open `chrome://extensions`
2. Turn on `Developer mode`
3. Click `Load unpacked`
4. Select the `dist/extension` folder

### Use it with the local app

1. Start the API with `npm run dev`
2. Load the unpacked extension from `dist/extension`
3. Open the extension popup
4. Use `Ping orchestrator` to confirm localhost connectivity
5. Use `Get page context`, `Run test click`, or `Run test fill` for demo/debug flows

### Queue a test command manually

You can queue a command for the extension through the local API:

```bash
curl -X POST http://localhost:8787/api/extension/execute ^
  -H "Content-Type: application/json" ^
  -d "{\"command\":{\"id\":\"cmd_1\",\"type\":\"get_page_context\"}}"
```

The background worker polls `/api/extension/next-command`, executes the command on the active tab, and posts results back to `/api/extension/result`.
