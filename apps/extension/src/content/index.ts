import {
  extensionCommandSchema,
  type ExtensionCommand,
  type ExtensionCommandResult
} from "@shared/index";
import type { ContentAction } from "@extension/shared/runtime";
import { clickElement, fillElement } from "./dom/actions";
import { extractPageContext } from "./dom/extractPageContext";
import { findClickable } from "./dom/findClickable";
import { findField } from "./dom/findField";
import { mountAssistantOverlay } from "./overlay";

function ambiguousResult(command: ExtensionCommand, message: string, candidates: ExtensionCommandResult["candidates"]) {
  return {
    commandId: command.id,
    ok: false,
    action: command.type,
    message,
    candidates
  } satisfies ExtensionCommandResult;
}

function runCommand(command: ExtensionCommand): ExtensionCommandResult {
  switch (command.type) {
    case "ping":
      return {
        commandId: command.id,
        ok: true,
        action: "ping",
        message: "Content script is responsive.",
        data: {
          title: document.title,
          url: window.location.href
        }
      };
    case "get_page_context": {
      const pageContext = extractPageContext();

      return {
        commandId: command.id,
        ok: true,
        action: "get_page_context",
        message: "Extracted page context successfully.",
        pageContext
      };
    }
    case "extract_text_blocks": {
      const pageContext = extractPageContext();

      return {
        commandId: command.id,
        ok: true,
        action: "extract_text_blocks",
        message: "Extracted visible text blocks successfully.",
        pageContext
      };
    }
    case "click": {
      const match = findClickable(command.target);
      if (!match.best || match.best.score < 85) {
        return ambiguousResult(command, "No high-confidence match found for the click target.", match.candidates);
      }

      return clickElement(command.id, match.best.element as HTMLElement);
    }
    case "fill_field": {
      const match = findField(command.target);
      if (!match.best || match.best.score < 75) {
        return ambiguousResult(command, "No high-confidence field match was found.", match.candidates);
      }

      return fillElement(command.id, match.best.element, command.value);
    }
    case "fill_form": {
      const filled: string[] = [];
      const unresolved: { fieldHint: string; candidates: ExtensionCommandResult["candidates"] }[] = [];
      let lastMatched = undefined;

      for (const field of command.fields) {
        const match = findField({ fieldHint: field.fieldHint });
        if (!match.best || match.best.score < 75) {
          unresolved.push({
            fieldHint: field.fieldHint,
            candidates: match.candidates
          });
          continue;
        }

        const result = fillElement(command.id, match.best.element, field.value);
        if (result.ok) {
          filled.push(field.fieldHint);
          lastMatched = result.matched;
        }
      }

      return {
        commandId: command.id,
        ok: unresolved.length === 0,
        action: "fill_form",
        matched: lastMatched,
        message:
          unresolved.length === 0
            ? `Filled ${filled.length} field${filled.length === 1 ? "" : "s"} successfully.`
            : `Filled ${filled.length} field${filled.length === 1 ? "" : "s"}, but some fields were ambiguous.`,
        candidates: unresolved.flatMap((entry) => entry.candidates ?? []).slice(0, 5),
        data: {
          filled,
          unresolved
        }
      };
    }
    case "navigate":
      return {
        commandId: command.id,
        ok: false,
        action: "navigate",
        message: "Navigate commands are handled in the background worker."
      };
  }
}

chrome.runtime.onMessage.addListener((message: ContentAction, _sender, sendResponse) => {
  if (message?.type !== "extension:run-command") {
    return false;
  }

  try {
    const command = extensionCommandSchema.parse(message.command);
    sendResponse(runCommand(command));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown command error.";
    sendResponse({
      commandId: message.command?.id ?? "unknown",
      ok: false,
      action: message.command?.type ?? "unknown",
      message: errorMessage
    } satisfies ExtensionCommandResult);
  }

  return true;
});

void mountAssistantOverlay().catch(() => {
  // Ignore stale content-script startup failures after extension reloads.
});
