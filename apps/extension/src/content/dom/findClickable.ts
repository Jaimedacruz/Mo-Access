import type { ExtensionTarget } from "@shared/index";
import { includesNormalized, normalizeText } from "@extension/shared/normalize";
import { rankByScore } from "@extension/shared/scoring";
import { describeElement, getElementText, isVisible } from "./element-utils";

type RankedMatch = {
  element: Element;
  score: number;
};

function targetTextVariants(target: ExtensionTarget) {
  const rawValues = [target.text, target.ariaLabel, target.name].filter(Boolean) as string[];
  const variants = new Set<string>();

  for (const value of rawValues) {
    const normalized = normalizeText(value);
    if (!normalized) {
      continue;
    }

    variants.add(normalized);

    const stripped = normalized.replace(/\b(button|link|icon|tab|menu item|menu)\b/g, "").trim();
    if (stripped) {
      variants.add(stripped);
    }
  }

  return [...variants];
}

export function findClickable(target: ExtensionTarget) {
  const elements = Array.from(
    document.querySelectorAll("button, a[href], [role='button'], input[type='button'], input[type='submit']")
  ).filter((element) => isVisible(element));
  const textVariants = targetTextVariants(target);

  const matches: RankedMatch[] = [];

  for (const element of elements) {
    const htmlElement = element as HTMLElement;
    let score = 0;
    const text = getElementText(element);
    const ariaLabel = htmlElement.getAttribute("aria-label");
    const title = htmlElement.getAttribute("title");
    const normalizedText = normalizeText(text);
    const normalizedAriaLabel = normalizeText(ariaLabel);
    const normalizedTitle = normalizeText(title);

    if (target.selector) {
      try {
        if (element.matches(target.selector)) {
          score += 130;
        }
      } catch {
        score -= 10;
      }
    }

    for (const candidate of textVariants) {
      if (normalizedText === candidate) {
        score += 120;
        continue;
      }

      if (normalizedAriaLabel === candidate) {
        score += 110;
        continue;
      }

      if (normalizedTitle === candidate) {
        score += 95;
        continue;
      }

      if (
        includesNormalized(text, candidate) ||
        includesNormalized(ariaLabel, candidate) ||
        includesNormalized(title, candidate)
      ) {
        score += 70;
        continue;
      }

      if (
        candidate &&
        ((normalizedText && candidate.includes(normalizedText)) ||
          (normalizedAriaLabel && candidate.includes(normalizedAriaLabel)) ||
          (normalizedTitle && candidate.includes(normalizedTitle)))
      ) {
        score += 45;
      }
    }

    if (target.role && describeElement(element).role === target.role) {
      score += 18;
    }

    if (score > 0) {
      matches.push({ element, score });
    }
  }

  const ranked = rankByScore(matches);

  return {
    best: ranked[0] ?? null,
    candidates: ranked.slice(0, 5).map((match) => describeElement(match.element, match.score))
  };
}
