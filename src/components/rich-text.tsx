// Minimal, safe inline formatter for admin-editable copy blocks. Lets the
// Chamber keep **bold** emphasis and [links](https://…) inside an editable
// text block instead of us pre-chopping every sentence into separate keys.
//
// Supported: **bold**, [label](url), and newlines → line breaks. Everything
// else renders as plain text. NO HTML injection — output is built as React
// nodes, so pasted markup is shown literally, never executed. Safe in server
// and client components (pure function, no hooks).

import { Fragment, type ReactNode } from "react";

const SAFE_URL = /^(https?:\/\/|mailto:|tel:|\/)/i;

/** Tokenize one line into bold / link / text React nodes. */
function renderLine(line: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Match **bold** or [label](url), whichever comes first, left to right.
  const pattern = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = pattern.exec(line)) !== null) {
    if (m.index > last) nodes.push(line.slice(last, m.index));
    if (m[1] !== undefined) {
      nodes.push(
        <strong key={`${keyPrefix}-b${i}`} className="font-medium text-ink">
          {m[1]}
        </strong>,
      );
    } else if (m[2] !== undefined && m[3] !== undefined && SAFE_URL.test(m[3])) {
      const external = /^https?:/i.test(m[3]);
      nodes.push(
        <a
          key={`${keyPrefix}-a${i}`}
          href={m[3]}
          {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          className="font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound"
        >
          {m[2]}
        </a>,
      );
    } else {
      // Unsafe URL or malformed — render the raw match as plain text.
      nodes.push(m[0]);
    }
    last = m.index + m[0].length;
    i++;
  }
  if (last < line.length) nodes.push(line.slice(last));
  return nodes;
}

export function RichText({ text }: { text: string }): ReactNode {
  const lines = text.split("\n");
  return lines.map((line, idx) => (
    <Fragment key={idx}>
      {idx > 0 && <br />}
      {renderLine(line, String(idx))}
    </Fragment>
  ));
}
