import type { ReactNode } from "react";

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*|_[^_\n]+_)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if ((part.startsWith("*") && part.endsWith("*")) || (part.startsWith("_") && part.endsWith("_"))) return <em key={index}>{part.slice(1, -1)}</em>;
    return part;
  });
}

export function ReviewText({ body }: { body: string }) {
  return <div className="review-prose">{body.trim().split(/\n\s*\n/).map((block, index) => {
    const lines = block.split("\n");
    if (lines.every((line) => line.startsWith("- "))) return <ul key={index}>{lines.map((line, item) => <li key={item}>{inline(line.slice(2))}</li>)}</ul>;
    if (lines.every((line) => line.startsWith("> "))) return <blockquote key={index}>{lines.map((line, item) => <span key={item}>{inline(line.slice(2))}</span>)}</blockquote>;
    if (lines.length === 1 && lines[0].startsWith("# ")) return <h3 key={index}>{inline(lines[0].slice(2))}</h3>;
    return <p key={index}>{lines.map((line, item) => <span key={item}>{inline(line)}{item < lines.length - 1 ? <br /> : null}</span>)}</p>;
  })}</div>;
}
