const highlightClassName = "mo-access-highlight";

function ensureHighlightStyles() {
  if (document.getElementById("mo-access-highlight-style")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "mo-access-highlight-style";
  style.textContent = `
    .${highlightClassName} {
      outline: 4px solid #ff8f00 !important;
      outline-offset: 3px !important;
      box-shadow: 0 0 0 6px rgba(0, 0, 0, 0.84) !important;
      transition: outline 120ms ease;
    }
  `;

  document.documentElement.appendChild(style);
}

export function highlightElement(element: Element) {
  ensureHighlightStyles();
  element.classList.add(highlightClassName);
  (element as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });

  window.setTimeout(() => {
    element.classList.remove(highlightClassName);
  }, 1800);
}
