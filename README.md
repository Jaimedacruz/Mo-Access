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
- Shared Zod schemas for request and response contracts
- Browser recording and audio upload support
- Typed command fallback for demos
- Deterministic action planner that stays separate from future execution logic

## Stack

- Frontend: React, Vite, TypeScript
- Backend: Node.js, Express, TypeScript
- Validation: Zod
- OpenAI API:
  - `gpt-4o-mini-transcribe` for speech-to-text
  - `gpt-4o-mini` for structured intent parsing

## Project Structure

```text
.
|-- apps
|   |-- api
|   |   `-- src
|   |       |-- config.ts
|   |       |-- lib/openai.ts
|   |       |-- prompts/intent-parser-prompt.ts
|   |       |-- routes/orchestrator-routes.ts
|   |       |-- services/action-planner-service.ts
|   |       |-- services/intent-parser-service.ts
|   |       |-- services/transcription-service.ts
|   |       `-- server.ts
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
OPENAI_REASONING_MODEL=gpt-4o-mini
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
PORT=8787
WEB_ORIGIN=http://localhost:5173
VITE_API_BASE_URL=http://localhost:8787
```

If the API key is missing, the server still starts, but transcription and orchestration endpoints will return a clear configuration error.

## Scripts

- `npm run dev` starts the API and frontend together
- `npm run check` runs TypeScript checks
- `npm run build` builds the API bundle and frontend assets into `dist/`

## API Endpoints

- `GET /api/health`
  - Returns API health and whether OpenAI is configured
- `POST /api/speech-to-text`
  - Multipart form-data with `audio`
  - Returns `{ transcript }`
- `POST /api/parse-intent`
  - Body: `{ "transcript": "..." }`
  - Returns `{ intent }`
- `POST /api/plan`
  - Body: `{ "intent": { ... } }`
  - Returns `{ plan }`
- `POST /api/orchestrate`
  - Body: `{ "transcript": "..." }`
  - Returns transcript, parsed intent, action plan, and status messages

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
