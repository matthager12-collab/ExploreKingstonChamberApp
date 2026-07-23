// Admin site-content API — backs /admin/content.
//
// GET  — admin: { copyOverrides, copyOverridesDetailed, pageSettings, githubEnabled }.
// POST — admin:
//        { action: "copy", key, text, expiresAt? } → save a copy override.
//          Empty text reverts the block to its code fallback (we store the
//          empty string; copyText treats empty/whitespace as "use fallback").
//          expiresAt (future "YYYY-MM-DD" or null) sets/clears the auto-restore
//          date — the override reverts to code wording on that date (site-store).
//        { action: "page", path, hidden } → show/hide one public page.
//        { action: "request-permanent", key, text, note? } → file a GitHub issue
//          proposing a permanent (code-level) wording change. 503 with no token.
//
// 401 signed out · 403 signed in but not admin. The /admin layout gates the
// UI; these handlers re-check because API routes bypass layouts.

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireAdmin } from "@/lib/auth";
import {
  getCopyOverrides,
  getCopyOverridesDetailed,
  getPageSettings,
  saveCopyOverride,
  setPageHidden,
} from "@/lib/stores/site-store";
import { COPY_BLOCKS } from "@/lib/site-copy-registry";
import { HIDEABLE_PAGES } from "@/lib/page-visibility";
import { RecordValidationError } from "@/lib/db/store-schemas";
import { createGithubIssue, githubConfigured } from "@/lib/github";
import { todayPacific } from "@/lib/time";

const COPY_KEYS = new Set<string>(COPY_BLOCKS.map((b) => b.key));
const COPY_BLOCK_BY_KEY = new Map<string, (typeof COPY_BLOCKS)[number]>(
  COPY_BLOCKS.map((b) => [b.key, b]),
);
const HIDEABLE = new Set(HIDEABLE_PAGES.map((p) => p.path));
const MAX_TEXT_LENGTH = 2000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  const [copyOverrides, copyOverridesDetailed, pageSettings] = await Promise.all([
    getCopyOverrides(),
    getCopyOverridesDetailed(),
    getPageSettings(),
  ]);
  return NextResponse.json({
    copyOverrides,
    copyOverridesDetailed,
    pageSettings,
    githubEnabled: githubConfigured(),
  });
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  // The gate proved a session exists — this only re-reads it for the audit actor.
  const actor = (await getSessionUser())!.email;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (body.action === "copy") {
    const key = typeof body.key === "string" ? body.key : "";
    if (!COPY_KEYS.has(key)) {
      return NextResponse.json({ error: "Unknown copy key" }, { status: 400 });
    }
    if (typeof body.text !== "string") {
      return NextResponse.json({ error: "text must be a string" }, { status: 400 });
    }
    // Optional auto-restore date: null/"" clears it; a value must be a future
    // YYYY-MM-DD (a past/today date would revert immediately, so reject it).
    let expiresAt: string | null = null;
    if (body.expiresAt != null && body.expiresAt !== "") {
      if (typeof body.expiresAt !== "string" || !DATE_RE.test(body.expiresAt)) {
        return NextResponse.json({ error: "Revert date must be YYYY-MM-DD" }, { status: 400 });
      }
      if (body.expiresAt <= todayPacific()) {
        return NextResponse.json({ error: "Revert date must be in the future" }, { status: 400 });
      }
      expiresAt = body.expiresAt;
    }
    const text = body.text.slice(0, MAX_TEXT_LENGTH);
    try {
      await saveCopyOverride(key, text, { expiresAt }, { actor, source: "admin" });
    } catch (err) {
      if (err instanceof RecordValidationError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
    return NextResponse.json({ ok: true, key, text, expiresAt });
  }

  // Ask a developer to make a wording change permanent — the default lives in
  // code (site-copy-registry.ts), so this files a GitHub issue rather than
  // writing an override. Admin-gated above; degrades to 503 with no token.
  if (body.action === "request-permanent") {
    const key = typeof body.key === "string" ? body.key : "";
    const block = COPY_BLOCK_BY_KEY.get(key);
    if (!block) {
      return NextResponse.json({ error: "Unknown copy key" }, { status: 400 });
    }
    if (typeof body.text !== "string" || body.text.trim() === "") {
      return NextResponse.json({ error: "Requested wording is required" }, { status: 400 });
    }
    if (!githubConfigured()) {
      return NextResponse.json({ error: "GitHub is not set up for this site" }, { status: 503 });
    }
    const requested = body.text.slice(0, MAX_TEXT_LENGTH);
    const note = typeof body.note === "string" ? body.note.slice(0, 1000).trim() : "";
    const title = `Copy change request: ${key}`;
    const bodyMd = [
      `**Requested by:** ${actor}`,
      `**Page:** ${block.page}`,
      `**Block:** ${block.label} (\`${key}\`)`,
      "",
      "**Current built-in wording:**",
      `> ${block.fallback.replace(/\n/g, "\n> ")}`,
      "",
      "**Requested wording:**",
      `> ${requested.replace(/\n/g, "\n> ")}`,
      ...(note ? ["", "**Note:**", `> ${note.replace(/\n/g, "\n> ")}`] : []),
      "",
      "—",
      "Filed from **/admin/content** on Explore Kingston. Making this permanent means updating the fallback in `src/lib/site-copy-registry.ts`.",
    ].join("\n");
    try {
      const { url, number } = await createGithubIssue({ title, body: bodyMd, labels: ["copy-change"] });
      return NextResponse.json({ ok: true, url, number });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not create the request";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  if (body.action === "page") {
    const path = typeof body.path === "string" ? body.path : "";
    if (!HIDEABLE.has(path)) {
      return NextResponse.json({ error: "That page can't be hidden" }, { status: 400 });
    }
    if (typeof body.hidden !== "boolean") {
      return NextResponse.json({ error: "hidden must be a boolean" }, { status: 400 });
    }
    try {
      await setPageHidden(path, body.hidden, { actor, source: "admin" });
    } catch (err) {
      if (err instanceof RecordValidationError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
    return NextResponse.json({ ok: true, path, hidden: body.hidden });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
