import {
  extensionCommandSchema,
  type ExtensionCommand,
  type ExtensionCommandResult
} from "@shared/index";
import type { ContentAction } from "@extension/shared/runtime";
import { clickElement, fillElement, selectOptionElement } from "./dom/actions";
import { describeElement } from "./dom/element-utils";
import { extractPageContext } from "./dom/extractPageContext";
import { findClickable } from "./dom/findClickable";
import { findField } from "./dom/findField";
import {
  handleCalendarCommand,
  handleDocsCommand,
  handleDriveCommand,
  handleYouTubeCommand
} from "./dom/google-app-controllers";
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

function resolveTargetMatch(command: Extract<ExtensionCommand, { type: "wait_for_element" | "scroll" }>) {
  const clickableMatch = command.target ? findClickable(command.target) : null;
  const fieldMatch = command.target ? findField(command.target) : null;

  if (command.type === "wait_for_element" && command.matchType === "clickable") {
    return clickableMatch?.best
      ? { element: clickableMatch.best.element as HTMLElement, score: clickableMatch.best.score, candidates: clickableMatch.candidates }
      : null;
  }

  if (command.type === "wait_for_element" && command.matchType === "field") {
    return fieldMatch?.best
      ? { element: fieldMatch.best.element, score: fieldMatch.best.score, candidates: fieldMatch.candidates }
      : null;
  }

  const bestClickable = clickableMatch?.best ?? null;
  const bestField = fieldMatch?.best ?? null;
  if (!bestClickable && !bestField) {
    return null;
  }

  if (bestClickable && (!bestField || bestClickable.score >= bestField.score)) {
    return {
      element: bestClickable.element as HTMLElement,
      score: bestClickable.score,
      candidates: clickableMatch?.candidates
    };
  }

  return {
    element: bestField!.element,
    score: bestField!.score,
    candidates: fieldMatch?.candidates
  };
}

async function waitForElement(command: Extract<ExtensionCommand, { type: "wait_for_element" }>) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < command.timeoutMs) {
    const match = resolveTargetMatch(command);
    if (match?.element && match.score >= 75) {
      return {
        commandId: command.id,
        ok: true,
        action: "wait_for_element",
        matched: describeElement(match.element),
        message: "Found the requested element."
      } satisfies ExtensionCommandResult;
    }

    await new Promise((resolve) => window.setTimeout(resolve, command.intervalMs));
  }

  const finalMatch = resolveTargetMatch(command);

  return ambiguousResult(
    command,
    "Timed out waiting for the requested element.",
    finalMatch?.candidates
  );
}

function scrollPage(command: Extract<ExtensionCommand, { type: "scroll" }>) {
  if (command.target) {
    const match = resolveTargetMatch(command);
    if (match?.element) {
      match.element.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });

      return {
        commandId: command.id,
        ok: true,
        action: "scroll",
        message: "Scrolled to the requested element.",
        matched: describeElement(match.element)
      } satisfies ExtensionCommandResult;
    }
  }

  const amount = command.amount ?? Math.max(240, Math.round(window.innerHeight * 0.7));
  switch (command.direction) {
    case "top":
      window.scrollTo({ top: 0, behavior: "smooth" });
      break;
    case "bottom":
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
      break;
    case "up":
      window.scrollBy({ top: -amount, behavior: "smooth" });
      break;
    case "down":
    default:
      window.scrollBy({ top: amount, behavior: "smooth" });
      break;
  }

  return {
    commandId: command.id,
    ok: true,
    action: "scroll",
    message: `Scrolled ${command.direction}.`
  } satisfies ExtensionCommandResult;
}

function pressKey(command: Extract<ExtensionCommand, { type: "press_key" }>) {
  const target = (document.activeElement as HTMLElement | null) ?? document.body;

  const eventInit = {
    key: command.key,
    altKey: command.altKey,
    ctrlKey: command.ctrlKey,
    shiftKey: command.shiftKey,
    metaKey: command.metaKey,
    bubbles: true
  };

  target.dispatchEvent(new KeyboardEvent("keydown", eventInit));
  target.dispatchEvent(new KeyboardEvent("keyup", eventInit));

  return {
    commandId: command.id,
    ok: true,
    action: "press_key",
    message: `Pressed ${command.key}.`
  } satisfies ExtensionCommandResult;
}

async function runCommand(command: ExtensionCommand): Promise<ExtensionCommandResult> {
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
    case "select_option": {
      const match = findField(command.target);
      if (!match.best || match.best.score < 75) {
        return ambiguousResult(command, "No high-confidence field match was found for the select target.", match.candidates);
      }

      return selectOptionElement(command.id, match.best.element, command.value);
    }
    case "wait_for_element":
      return waitForElement(command);
    case "scroll":
      return scrollPage(command);
    case "press_key":
      return pressKey(command);
    case "open_search_result":
    case "play_video":
    case "pause_video":
    case "mute_video":
    case "unmute_video":
    case "seek_forward":
    case "seek_backward":
    case "fullscreen_video":
      return handleYouTubeCommand(command);
    case "edit_event":
    case "delete_event":
    case "add_guest":
    case "set_time":
      return handleCalendarCommand(command);
    case "rename_doc":
    case "insert_text":
    case "select_text":
    case "apply_format":
    case "open_doc":
      return handleDocsCommand(command);
    case "open_folder":
    case "upload_file":
    case "rename_file":
    case "move_file":
      return handleDriveCommand(command);
    case "navigate":
    case "open_new_tab":
    case "switch_tab":
    case "search_youtube":
    case "create_event":
    case "open_date":
    case "create_doc":
    case "create_doc_from_drive":
      return {
        commandId: command.id,
        ok: false,
        action: command.type,
        message: `${command.type} commands are handled in the background worker.`
      };
  }
}

chrome.runtime.onMessage.addListener((message: ContentAction, _sender, sendResponse) => {
  if (message?.type !== "extension:run-command") {
    return false;
  }

  void (async () => {
    try {
      const command = extensionCommandSchema.parse(message.command);
      sendResponse(await runCommand(command));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown command error.";
      sendResponse({
        commandId: message.command?.id ?? "unknown",
        ok: false,
        action: message.command?.type ?? "unknown",
        message: errorMessage
      } satisfies ExtensionCommandResult);
    }
  })();

  return true;
});

void mountAssistantOverlay().catch(() => {
  // Ignore stale content-script startup failures after extension reloads.
});
