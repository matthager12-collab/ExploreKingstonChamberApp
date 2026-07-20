// E09 shared client-side vocabulary for the audit surfaces: entry shape as
// served by GET /api/admin/audit, plain-language verbs, badge tones, date
// formatting, and the one restore POST helper both the record-history panel
// and the pinned /admin/audit browser go through. Client-safe: no IO beyond
// fetch, no server-only imports.

export type AuditEntryView = {
  id: number;
  ts: string;
  actor: string;
  action: string;
  store: string;
  recordId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  source: string;
  metadataOnly: boolean;
  /** Server-computed: this row's snapshot can be restored for this store. */
  restorable: boolean;
};

export type RecordMetaView = {
  status: string;
  source: string;
  externalId: string | null;
  updatedAt: string;
  updatedBy: string | null;
  deleted: boolean;
};

export type AuditPage = {
  entries: AuditEntryView[];
  nextCursor: number | null;
  recordMeta?: RecordMetaView | null;
};

/** Plain-language verb per audit action — volunteers read these, not enums.
 *  Unknown actions fall back to the raw string. */
export const ACTION_VERBS: Record<string, string> = {
  create: "created",
  update: "edited",
  delete: "deleted",
  import: "imported",
  restore: "restored",
  "status-change": "changed status",
  verify: "marked verified",
};

export function actionVerb(action: string): string {
  return ACTION_VERBS[action] ?? action;
}

export function actionTone(
  action: string,
): "navy" | "teal" | "coral" | "green" | "sand" {
  switch (action) {
    case "create":
      return "green";
    case "update":
      return "teal";
    case "delete":
      return "coral";
    case "restore":
      return "navy";
    default:
      return "sand";
  }
}

const SOURCE_TONES: Record<string, "navy" | "teal" | "coral" | "green" | "sand"> = {
  seed: "navy",
  admin: "teal",
  portal: "sand",
  public: "sand",
  import: "green",
  sync: "green",
};

export function sourceTone(source: string): "navy" | "teal" | "coral" | "green" | "sand" {
  return SOURCE_TONES[source] ?? "sand";
}

/** House date style (hunts precedent): viewer-local, en-US. */
export function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "3 days ago" — coarse on purpose; the exact stamp rides the title attr. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const s = Math.max(0, Math.floor((now.getTime() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  if (d < 45) return `${d} day${d === 1 ? "" : "s"} ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? "" : "s"} ago`;
  const y = Math.floor(d / 365);
  return `${y} year${y === 1 ? "" : "s"} ago`;
}

/** The confirm-dialog copy, per restore flavor, in the runbook's voice. */
export function restoreConfirmText(
  entry: Pick<AuditEntryView, "action" | "ts">,
  currentlyDeleted: boolean,
): string {
  const when = fmtWhen(entry.ts);
  if (entry.action === "delete") {
    return `This deletes the record again, as it was deleted on ${when}. It's saved as a new change — nothing is lost, and you can undo this too.`;
  }
  if (currentlyDeleted) {
    return `This brings the record back, as it was on ${when}. It's saved as a new change — nothing is lost, and you can undo this too.`;
  }
  return `This puts the record back to how it was on ${when}. It's saved as a new change — nothing is deleted, and you can undo this too.`;
}

/** Fired on window after a successful restore so the provenance strip (and
 *  anything else showing this record) can refetch without coupling. */
export const RESTORED_EVENT = "vk:audit-restored";

export async function postRestore(args: {
  store: string;
  recordId: string;
  auditId: number;
  expectedUpdatedAt: string | null;
}): Promise<{ ok: true; recordMeta: RecordMetaView | null } | { ok: false; error: string }> {
  const res = await fetch("/api/admin/audit/restore", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    recordMeta?: RecordMetaView | null;
  };
  if (!res.ok || !data.ok) {
    return { ok: false, error: data.error ?? `Restore failed (HTTP ${res.status})` };
  }
  window.dispatchEvent(
    new CustomEvent(RESTORED_EVENT, {
      detail: { store: args.store, recordId: args.recordId },
    }),
  );
  return { ok: true, recordMeta: data.recordMeta ?? null };
}

export function historyUrl(store: string, recordId?: string): string {
  const params = new URLSearchParams({ store });
  if (recordId) params.set("recordId", recordId);
  return `/admin/audit?${params.toString()}`;
}

/** Where "open this record's editor" goes, per store. Stores whose editors
 *  are frozen monoliths (maps, parking) or have no per-record deep link get
 *  their store-level page. */
export function editorHref(store: string, recordId: string): string | null {
  switch (store) {
    case "restaurants":
    case "lodging":
    case "webcams":
      return "/admin/listings";
    case "itineraries":
      return "/admin/itineraries";
    case "custom-hunts":
      return `/admin/hunts?hunt=${encodeURIComponent(recordId)}#editor`;
    case "hunt-submissions":
      return "/admin/hunts";
    case "site-copy":
    case "site-pages":
      return "/admin/content";
    case "ferry-info":
    case "ferry-prediction":
    case "boarding-pass-override":
    case "ferry-accuracy":
      return "/admin/ferry-info";
    case "parking-zones":
      return "/admin/map";
    case "map-views":
    case "map-features":
      return "/admin/maps";
    case "users":
    case "orgs":
    case "invites":
    case "auth-users":
    case "auth-invites":
      return "/admin/accounts";
    case "worklist":
      return "/admin/worklist";
    default:
      return null;
  }
}
