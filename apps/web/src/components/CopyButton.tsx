import { useState } from "react";

type CopyButtonProps = {
  label: string;
  value: string;
};

export function CopyButton({ label, value }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <button className="copy-button" onClick={handleCopy} type="button">
      {copied ? "Copied" : label}
    </button>
  );
}
