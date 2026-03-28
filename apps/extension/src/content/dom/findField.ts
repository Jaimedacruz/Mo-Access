import type { ExtensionTarget } from "@shared/index";
import { includesNormalized, normalizeText } from "@extension/shared/normalize";
import { rankByScore } from "@extension/shared/scoring";
import { describeElement, getAssociatedLabel, isVisible } from "./element-utils";

type RankedField = {
  element: HTMLElement;
  score: number;
};

function fieldHintParts(target: ExtensionTarget) {
  const rawHints = [
    target.fieldHint,
    target.name,
    target.id,
    target.ariaLabel,
    target.placeholder
  ].filter(Boolean) as string[];

  const variants = new Set<string>();

  for (const hint of rawHints) {
    const normalized = normalizeText(hint);
    if (!normalized) {
      continue;
    }

    variants.add(normalized);

    const stripped = normalized
      .replace(/\b(input box|text box|textbox|text area|textarea|field|input|box)\b/g, "")
      .trim();

    if (stripped) {
      variants.add(stripped);
    }
  }

  return [...variants];
}

function isTextEntryElement(element: HTMLElement) {
  if (element instanceof HTMLTextAreaElement || element.isContentEditable) {
    return true;
  }

  if (element instanceof HTMLInputElement) {
    return !["hidden", "checkbox", "radio", "button", "submit"].includes(element.type);
  }

  return false;
}

export function findField(target: ExtensionTarget) {
  const elements = Array.from(
    document.querySelectorAll("input:not([type='hidden']), textarea, select, [contenteditable='true']")
  ).filter((element) => isVisible(element)) as HTMLElement[];

  const hints = fieldHintParts(target);
  const visibleTextEntryElements = elements.filter((element) => isTextEntryElement(element));
  const singleTextEntry = visibleTextEntryElements.length === 1 ? visibleTextEntryElements[0] : null;
  const ranked: RankedField[] = [];

  for (const element of elements) {
    let score = 0;
    const label = getAssociatedLabel(element);
    const id = element.id;
    const name = element.getAttribute("name");
    const ariaLabel = element.getAttribute("aria-label");
    const placeholder = element.getAttribute("placeholder");

    if (target.selector) {
      try {
        if (element.matches(target.selector)) {
          score += 130;
        }
      } catch {
        score -= 10;
      }
    }

    for (const hint of hints) {
      if (normalizeText(id) === normalizeText(hint)) {
        score += 115;
      }
      if (normalizeText(name) === normalizeText(hint)) {
        score += 105;
      }
      if (normalizeText(ariaLabel) === normalizeText(hint)) {
        score += 100;
      }
      if (normalizeText(label) === normalizeText(hint)) {
        score += 95;
      }
      if (includesNormalized(placeholder, hint)) {
        score += 70;
      }
      if (includesNormalized(label, hint) || includesNormalized(name, hint) || includesNormalized(id, hint)) {
        score += 55;
      }
    }

    if (
      singleTextEntry === element &&
      hints.some((hint) => /\b(prompt|message|chat|input|field|box|text)\b/.test(hint)) &&
      isTextEntryElement(element)
    ) {
      score += 80;
    }

    if (score > 0) {
      ranked.push({ element, score });
    }
  }

  const sorted = rankByScore(ranked);

  return {
    best: sorted[0] ?? null,
    candidates: sorted.slice(0, 5).map((item) => describeElement(item.element, item.score))
  };
}
