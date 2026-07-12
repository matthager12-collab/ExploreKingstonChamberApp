// Admin site-content API — backs /admin/content.
//
// GET  — admin: { copyOverrides, pageSettings }.
// POST — admin: { action: "copy", key, text }  → save a copy override.
//        Empty text reverts the block to its code fallback (we store the
//        empty string; copyText treats empty/whitespace as "use fallback").
//        { action: "page", path, hidden } → show/hide one public page.
//
// 401 signed out · 403 signed in but not admin. The /admin layout gates the
// UI; these handlers re-check because API routes bypass layouts.

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  getCopyOverrides,
  getPageSettings,
  saveCopyOverride,
  setPageHidden,
} from "@/lib/stores/site-store";
import { COPY_BLOCKS } from "@/lib/site-copy-registry";
import { HIDEABLE_PAGES } from "@/lib/page-visibility";
import { RecordValidationError } from "@/lib/db/store-schemas";

const COPY_KEYS = new Set(COPY_BLOCKS.map((b) => b.key));
const HIDEABLE = new Set(HIDEABLE_PAGES.map((p) => p.path));
const MAX_TEXT_LENGTH = 2000;

/** Admin gate: returns the user when allowed, else the 401/403 response. */
async function requireAdmin(): Promise<
  { ok: true; user: { name: string; email: string } } | { ok: false; res: NextResponse }
> {
  const user = await getSessionUser();
  if (!user) return { ok: false, res: NextResponse.json({ error: "Sign in first" }, { status: 401 }) };
  if (user.role !== "admin") {
    return { ok: false, res: NextResponse.json({ error: "Chamber admins only" }, { status: 403 }) };
  }
  return { ok: true, user };
}

export async function GET() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;
  const [copyOverrides, pageSettings] = await Promise.all([
    getCopyOverrides(),
    getPageSettings(),
  ]);
  return NextResponse.json({ copyOverrides, pageSettings });
}

export async function POST(request: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;

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
    const text = body.text.slice(0, MAX_TEXT_LENGTH);
    try {
      await saveCopyOverride(key, text, { actor: gate.user.email, source: "admin" });
    } catch (err) {
      if (err instanceof RecordValidationError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
    return NextResponse.json({ ok: true, key, text });
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
      await setPageHidden(path, body.hidden, { actor: gate.user.email, source: "admin" });
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
