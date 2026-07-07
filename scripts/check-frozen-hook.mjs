#!/usr/bin/env node
// Claude Code PreToolUse hook: block Edit/Write on paths listed in .agent-frozen
// (E02, decisions §6b). Reads the tool-call JSON on stdin; if the target file
// matches a frozen pattern, exits 2 to DENY the tool call (stderr is shown to the
// agent). Fails open (exit 0) on any parse/lookup problem so it never wedges work
// on non-frozen files. Manifest path may be passed as argv[2] (default .agent-frozen).

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function allow() {
  process.exit(0);
}

let raw = "";
try {
  raw = readFileSync(0, "utf8");
} catch {
  allow();
}

let input;
try {
  input = JSON.parse(raw);
} catch {
  allow();
}

const tool = input.tool_name;
if (!["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool)) allow();

const filePath = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
if (!filePath) allow();

const root = input.cwd || process.cwd();
const manifestPath = process.argv[2]
  ? path.resolve(root, process.argv[2])
  : path.join(root, ".agent-frozen");
if (!existsSync(manifestPath)) allow();

const rel = path.relative(root, path.resolve(root, filePath)).replace(/\\/g, "/");
if (rel.startsWith("..")) allow(); // outside the repo — not ours to guard

const patterns = readFileSync(manifestPath, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

function toRegex(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const body = escaped.replace(/\*\*/g, " ").replace(/\*/g, "[^/]*").replace(/ /g, ".*");
  return new RegExp(`^${body}$`);
}

const matched = patterns.some((p) => toRegex(p).test(rel));
if (!matched) allow();

console.error(
  `Blocked by .agent-frozen: "${rel}" is a frozen path (E02 guardrail, decisions §6b).\n` +
    `It requires explicit human approval to modify — see docs/TESTING.md. If this change is\n` +
    `chartered and approved, an operator can remove the entry from .agent-frozen (ask-first).`,
);
process.exit(2);
