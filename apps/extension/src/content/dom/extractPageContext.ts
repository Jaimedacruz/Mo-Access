import type { ExtensionFormSummary, ExtensionPageContext, ExtensionTextBlock } from "@shared/index";
import { describeElement, getAssociatedLabel, getElementText, isVisible } from "./element-utils";

function collectTextBlocks() {
  const textSelectors = [
    "h1",
    "h2",
    "h3",
    "p",
    "li",
    "blockquote",
    "article",
    "section",
    "label",
    "button",
    "a"
  ].join(",");

  const blocks: ExtensionTextBlock[] = [];

  document.querySelectorAll(textSelectors).forEach((element) => {
    if (!isVisible(element)) {
      return;
    }

    const text = getElementText(element);
    if (!text || text.length < 2) {
      return;
    }

    blocks.push({
      index: blocks.length,
      tag: element.tagName.toLowerCase(),
      text
    });
  });

  return blocks.slice(0, 120);
}

function collectInteractiveElements() {
  const selectors = [
    "button",
    "a[href]",
    "input:not([type='hidden'])",
    "textarea",
    "select",
    "[role='button']",
    "[contenteditable='true']"
  ].join(",");

  return Array.from(document.querySelectorAll(selectors))
    .filter((element) => isVisible(element))
    .slice(0, 80)
    .map((element) => describeElement(element));
}

function collectFieldElements() {
  const selectors = [
    "input:not([type='hidden'])",
    "textarea",
    "select",
    "[contenteditable='true']"
  ].join(",");

  return Array.from(document.querySelectorAll(selectors))
    .filter((element) => isVisible(element))
    .slice(0, 80)
    .map((element) => describeElement(element));
}

function summarizeFieldLabel(element: Element) {
  return (
    getAssociatedLabel(element) ||
    (element as HTMLElement).getAttribute("placeholder") ||
    (element as HTMLElement).getAttribute("aria-label") ||
    (element as HTMLElement).getAttribute("name") ||
    (element as HTMLElement).id ||
    element.tagName.toLowerCase()
  ).trim();
}

function summarizeSubmitLabel(element: Element) {
  const text = getElementText(element);
  if (text) {
    return text;
  }

  return (element as HTMLElement).getAttribute("value") || element.tagName.toLowerCase();
}

function collectForms() {
  return Array.from(document.querySelectorAll("form"))
    .map((form, index) => {
      const formElement = form as HTMLFormElement;
      const fieldLabels = Array.from(
        form.querySelectorAll("input:not([type='hidden']), textarea, select, [contenteditable='true']")
      )
        .filter((element) => isVisible(element))
        .map((element) => summarizeFieldLabel(element))
        .filter(Boolean)
        .slice(0, 12);

      const submitLabels = Array.from(
        form.querySelectorAll("button, input[type='submit'], input[type='button'], [role='button']")
      )
        .filter((element) => isVisible(element))
        .map((element) => summarizeSubmitLabel(element))
        .filter(Boolean)
        .slice(0, 8);

      return {
        index,
        id: formElement.id || null,
        name: formElement.getAttribute("name"),
        action: formElement.getAttribute("action"),
        method: formElement.getAttribute("method"),
        fieldLabels,
        submitLabels
      } satisfies ExtensionFormSummary;
    })
    .slice(0, 12);
}

export function extractPageContext(): ExtensionPageContext {
  const textBlocks = collectTextBlocks();

  return {
    title: document.title,
    url: window.location.href,
    visibleText: textBlocks.map((block) => block.text).join("\n").slice(0, 8000),
    textBlocks,
    interactiveElements: collectInteractiveElements(),
    fieldElements: collectFieldElements(),
    forms: collectForms()
  };
}
