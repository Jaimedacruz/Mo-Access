import type { ExtensionPageContext, ExtensionTextBlock } from "@shared/index";
import { describeElement, getElementText, isVisible } from "./element-utils";

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

export function extractPageContext(): ExtensionPageContext {
  const textBlocks = collectTextBlocks();

  return {
    title: document.title,
    url: window.location.href,
    visibleText: textBlocks.map((block) => block.text).join("\n").slice(0, 8000),
    textBlocks,
    interactiveElements: collectInteractiveElements()
  };
}
