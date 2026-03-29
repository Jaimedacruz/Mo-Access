export const sampleCommands = [
  "Open the support page",
  "Open YouTube",
  "Open Google Drive",
  "Fill this form with my saved details",
  "Read this page aloud",
  "Write a message to support saying I can't log in",
  "Search lo-fi beats on YouTube"
] as const;

export const statusLabels = {
  idle: "Idle",
  transcribing: "Transcribing audio",
  parsing: "Parsing intent",
  planning: "Executing browser actions",
  ready: "Ready",
  error: "Error"
} as const;
