import type { ExtensionElementMatch } from "@shared/index";

export function isVisible(element: Element) {
  const htmlElement = element as HTMLElement;
  const style = window.getComputedStyle(htmlElement);
  const rect = htmlElement.getBoundingClientRect();

  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
    return false;
  }

  return rect.width > 0 && rect.height > 0;
}

export function getElementText(element: Element) {
  return (
    element.getAttribute("aria-label") ||
    (element as HTMLElement).innerText ||
    element.textContent ||
    ""
  ).trim();
}

export function getAssociatedLabel(element: Element) {
  if (!(element instanceof HTMLElement)) {
    return null;
  }

  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) {
    return ariaLabel.trim();
  }

  if ("labels" in element) {
    const labels = Array.from((element as HTMLInputElement).labels ?? [])
      .map((label) => label.textContent?.trim())
      .filter(Boolean);

    if (labels.length > 0) {
      return labels.join(" ");
    }
  }

  const label = element.closest("label");
  return label?.textContent?.trim() ?? null;
}

export function getElementRole(element: Element): ExtensionElementMatch["role"] {
  const tagName = element.tagName.toLowerCase();
  const explicitRole = element.getAttribute("role");

  if (explicitRole === "button") {
    return "button";
  }

  if (tagName === "button" || (tagName === "input" && ["button", "submit"].includes((element as HTMLInputElement).type))) {
    return "button";
  }

  if (tagName === "a") {
    return "link";
  }

  if (tagName === "textarea") {
    return "textarea";
  }

  if (tagName === "select") {
    return "select";
  }

  if (tagName === "input") {
    return "input";
  }

  if ((element as HTMLElement).isContentEditable) {
    return "contenteditable";
  }

  return "other";
}

export function getElementSelector(element: Element) {
  const htmlElement = element as HTMLElement;
  const id = htmlElement.id ? `#${htmlElement.id}` : "";
  const classes = [...htmlElement.classList]
    .slice(0, 2)
    .map((className) => `.${className}`)
    .join("");

  return `${htmlElement.tagName.toLowerCase()}${id}${classes}` || htmlElement.tagName.toLowerCase();
}

export function describeElement(element: Element, score?: number): ExtensionElementMatch {
  const htmlElement = element as HTMLElement;

  return {
    tag: element.tagName.toLowerCase(),
    role: getElementRole(element),
    text: getElementText(element) || null,
    label: getAssociatedLabel(element),
    name: htmlElement.getAttribute("name"),
    id: htmlElement.id || null,
    placeholder: htmlElement.getAttribute("placeholder"),
    ariaLabel: htmlElement.getAttribute("aria-label"),
    disabled: "disabled" in htmlElement ? Boolean((htmlElement as HTMLInputElement).disabled) : false,
    visible: isVisible(element),
    selector: getElementSelector(element),
    score: typeof score === "number" ? score : null
  };
}
