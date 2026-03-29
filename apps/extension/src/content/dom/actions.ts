import type { ExtensionCommandResult } from "@shared/index";
import { describeElement } from "./element-utils";
import { highlightElement } from "./highlight";

function dispatchTextEvents(element: HTMLElement) {
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

export function clickElement(commandId: string, element: HTMLElement): ExtensionCommandResult {
  highlightElement(element);
  element.click();

  return {
    commandId,
    ok: true,
    action: "click",
    matched: describeElement(element),
    message: "Clicked the matched element."
  };
}

export function fillElement(commandId: string, element: HTMLElement, value: string): ExtensionCommandResult {
  highlightElement(element);
  element.focus();

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.value = value;
    dispatchTextEvents(element);
  } else if (element instanceof HTMLSelectElement) {
    const options = Array.from(element.options);
    const matchingOption = options.find(
      (option) =>
        option.value.toLowerCase() === value.toLowerCase() ||
        option.text.toLowerCase() === value.toLowerCase()
    );

    if (matchingOption) {
      element.value = matchingOption.value;
      dispatchTextEvents(element);
    } else {
      return {
        commandId,
        ok: false,
        action: "fill_field",
        matched: describeElement(element),
        message: "The select field was found, but no matching option was available."
      };
    }
  } else {
    element.textContent = value;
    dispatchTextEvents(element);
  }

  return {
    commandId,
    ok: true,
    action: "fill_field",
    matched: describeElement(element),
    message: "Filled the matched field successfully."
  };
}
