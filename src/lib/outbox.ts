// The town's shared offline-write outbox (E13). One job: a write the visitor
// made with no signal reaches the server exactly once, later, without the
// calling component having to think about connectivity.
//
// ┌────────────────────────────────────────────────────────────────────────┐
// │ CONTRACT FOR FUTURE CONSUMERS (E20 volunteer check-in, E26 concierge).  │
// │                                                                        │
// │ • submitOrQueue(url, payload) is the only entry point most callers      │
// │   need. It returns { status: "sent" } whenever the SERVER WAS REACHED   │
// │   — including 4xx and 5xx — and { status: "queued" } only when fetch    │
// │   itself threw (genuinely offline). Retry policy for a 5xx belongs to   │
// │   the caller, not to the queue: re-queuing server errors is how         │
// │   poison-pill loops start.                                              │
// │ • Every submission carries a random UUID in the X-Idempotency-Key       │
// │   header, and a REPLAY REUSES THE SAME KEY — that is the whole reason   │
// │   a double delivery is harmless. The server half is                     │
// │   claimIdempotencyKey() (src/lib/db/idempotency.ts); an endpoint that   │
// │   does not claim the key is NOT safe to put behind this outbox.         │
// │ • POST + JSON only, by construction. A multipart/FormData endpoint      │
// │   (e.g. POST /api/hunts/submit) cannot be carried by this entry shape.  │
// │ • The queue is bounded: entries die after 7 days or 25 attempts, so     │
// │   nothing here holds a visitor's answer — or any PII — indefinitely.    │
// │ • Client-only. This module imports NOTHING from @/lib/db or             │
// │   @/lib/stores and must stay that way (a dependency-cruiser rule, an    │
// │   eslint rule, and an E13 acceptance grep all check it).                │
// └────────────────────────────────────────────────────────────────────────┘
//
// Every IndexedDB touch sits inside a function behind a
// `typeof indexedDB === "undefined"` guard. This module is imported by client
// components that ALSO render on the server, and under Node a bare
// `indexedDB` is a ReferenceError, not undefined — a module-scope reference
// (even `const x = indexedDB`) would break SSR and the unit tests alike.

/** A queued POST. `id` doubles as the IndexedDB key and the idempotency key. */
export type OutboxEntry = {
  id: string;
  url: string;
  body: string;
  contentType: "application/json";
  createdAt: number;
  attempts: number;
};

const DB_NAME = "vk-outbox";
const DB_VERSION = 1;
const STORE_NAME = "requests";

/** Web Locks name for a flush pass. Not an IndexedDB name — different registry. */
const LOCK_NAME = "vk-outbox";

/** The header both halves of the contract agree on. Mirrored server-side. */
const IDEMPOTENCY_HEADER = "X-Idempotency-Key";

// Bounds (pinned by tests/unit/outbox-policy.test.ts). They exist so the queue
// can never grow without limit and never holds a visitor's submission longer
// than the answer could plausibly still be wanted.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 25;

/* ── pure policy (the testable surface) ─────────────────────────────────── */

/** True when an entry has aged out or burned through its retry budget. */
export function shouldDrop(entry: OutboxEntry, nowMs: number): boolean {
  return nowMs - entry.createdAt > MAX_AGE_MS || entry.attempts > MAX_ATTEMPTS;
}

/**
 * True when a replay's HTTP status means "stop retrying, remove the entry".
 * Every member is here for a reason, and the non-members matter just as much:
 */
export function isDeliveredStatus(status: number): boolean {
  // 2xx — the server accepted it. The ordinary success path.
  if (status >= 200 && status < 300) return true;
  // 409 — already processed. This is the idempotent intake telling us a
  // previous pass (or another tab) got there first: delivered, not failed.
  if (status === 409) return true;
  // 400 — permanently malformed. No amount of retrying fixes the body, and a
  // stuck entry at the head of the queue blocks every entry behind it.
  if (status === 400) return true;
  // 413 — permanently too large (POST /api/survey caps bodies at 8 KB). Same
  // class as 400: the payload will never get smaller on its own.
  if (status === 413) return true;
  // Deliberately NOT 429: /api/survey rate-limits 5 per 10 minutes per IP, so
  // a device that queued 6+ answers offline would delete real submissions it
  // was merely being throttled on. 429 and 5xx increment attempts instead and
  // age out through shouldDrop() rather than being thrown away on the spot.
  return false;
}

/* ── IndexedDB plumbing (all guarded, all best-effort) ──────────────────── */

function promisifyRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** The outbox database, or null when IndexedDB is unavailable or refuses. */
function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    // Private-browsing Safari, denied quota, and a blocking older tab all land
    // here. The outbox is best-effort by design: a null database degrades to
    // "this write is lost", never to an exception inside a submit handler.
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

/**
 * Run one request against the object store. Returns null if the store could
 * not be reached — callers treat that as "nothing happened".
 */
async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const db = await openDb();
  if (db === null) return null;
  try {
    const tx = db.transaction(STORE_NAME, mode);
    return await promisifyRequest(run(tx.objectStore(STORE_NAME)));
  } catch {
    return null;
  } finally {
    // close() is deferred until in-flight transactions finish, so calling it
    // here does not cut the readwrite commit short.
    db.close();
  }
}

/** Every queued entry, oldest first — replay order is submission order. */
async function listEntries(): Promise<OutboxEntry[]> {
  const rows = await withStore("readonly", (store) => store.getAll() as IDBRequest<OutboxEntry[]>);
  if (rows === null) return [];
  return rows.slice().sort((a, b) => a.createdAt - b.createdAt);
}

async function putEntry(entry: OutboxEntry): Promise<void> {
  await withStore("readwrite", (store) => store.put(entry));
}

async function removeEntry(id: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(id));
}

/* ── submit + replay ────────────────────────────────────────────────────── */

/**
 * A fresh idempotency key. Random per submission and NEVER derived from or
 * joined to any user, device, or session identifier (MHMDA/privacy floor:
 * the outbox must not become a tracking mechanism). Shaped to satisfy the
 * server's /^[A-Za-z0-9-]{8,64}$/ validation.
 */
function newIdempotencyKey(): string {
  const webCrypto = typeof crypto === "undefined" ? undefined : crypto;
  if (webCrypto?.randomUUID) return webCrypto.randomUUID();
  // randomUUID needs a secure context; getRandomValues does not (http:// on a
  // LAN address, which is how a volunteer's tablet can end up loading this).
  if (webCrypto?.getRandomValues) {
    const bytes = webCrypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  // No WebCrypto at all. A collision here would cost one dropped duplicate,
  // never a corrupted record, so "random enough" genuinely is enough.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function requestInitFor(entry: OutboxEntry): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": entry.contentType, [IDEMPOTENCY_HEADER]: entry.id },
    body: entry.body,
  };
}

/**
 * POST `payload` to `url` now, or queue it for the next flush if the device
 * is offline. See the contract block at the top of this file — in particular,
 * an HTTP response of ANY status counts as "sent".
 *
 * `httpStatus` on the "sent" branch is how a caller ACTS on the contract's
 * "retry policy for a 5xx belongs to the caller" clause — before it existed,
 * the caller was handed responsibility for a decision it had no input to, so
 * every non-2xx (a 429 from the rate limiter, a 400 from validation) rendered
 * as success and the visitor was told their submission landed when it had
 * not. Purely additive: callers that only read `.status` are unaffected.
 *
 * `body` is the same kind of addition, for the same kind of reason. The
 * feedback route answers `{ok, moderated}`, and the widget has to know which
 * thank-you to render — without the parsed body it would be reduced to
 * guessing from a status code that says nothing about it. Parsed leniently:
 * a non-JSON or empty response yields `undefined` rather than rejecting,
 * because a caller that only wants `.status` must not start failing on a
 * route that answers with an empty 204.
 */
export async function submitOrQueue(
  url: string,
  payload: unknown,
): Promise<{ status: "sent"; httpStatus: number; body?: unknown } | { status: "queued" }> {
  const entry: OutboxEntry = {
    id: newIdempotencyKey(),
    url,
    body: JSON.stringify(payload),
    contentType: "application/json",
    createdAt: Date.now(),
    attempts: 0,
  };
  try {
    const res = await fetch(url, requestInitFor(entry));
    // Reached the server. Even a 500 stays out of the queue: the caller owns
    // that retry decision, and blind re-queueing of server errors is how a
    // poison-pill loop starts.
    const body = await res.json().catch(() => undefined);
    return { status: "sent", httpStatus: res.status, body };
  } catch {
    // fetch threw — DNS/transport failure, i.e. genuinely offline.
    await putEntry(entry);
    // putEntry is best-effort: with IndexedDB unavailable the write really is
    // lost. We still say "queued" because the only other answer ("sent") is a
    // strictly stronger false claim, and the caller's copy for queued is the
    // honest one of the two.
    return { status: "queued" };
  }
}

/** One replay pass. Oldest first; stops at the first entry that can't land. */
async function runFlushPass(): Promise<void> {
  const entries = await listEntries();
  const now = Date.now();
  for (const entry of entries) {
    if (shouldDrop(entry, now)) {
      await removeEntry(entry.id);
      continue;
    }
    let res: Response;
    try {
      // The STORED id, never a fresh one — reusing the original key is the
      // entire mechanism that makes a re-delivery a no-op server-side.
      res = await fetch(entry.url, requestInitFor(entry));
    } catch {
      // Still offline. Count the attempt and stop: every remaining entry
      // would fail identically, and burning 25 attempts in one pass would
      // discard real submissions over a single tunnel.
      await putEntry({ ...entry, attempts: entry.attempts + 1 });
      return;
    }
    if (isDeliveredStatus(res.status)) {
      await removeEntry(entry.id);
      continue;
    }
    // 429 or 5xx: the server was reached but is throttled or unhealthy.
    // Keep the entry, count the attempt, and stop the pass — pushing the rest
    // of the queue at a struggling server is the wrong instinct.
    await putEntry({ ...entry, attempts: entry.attempts + 1 });
    return;
  }
}

/**
 * Replay the queue. Safe to call on every mount and on every `online` event —
 * that is exactly how src/components/pwa.tsx drives it.
 */
export async function flushOutbox(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  // Typed as always-present, genuinely absent on iOS < 15.4 and in insecure
  // contexts — hence the runtime check and the widened type.
  const locks =
    typeof navigator === "undefined" ? undefined : (navigator.locks as LockManager | undefined);
  if (locks?.request) {
    // ifAvailable: if another tab is already flushing, our callback runs with
    // a null lock and we skip this pass instead of queueing behind it.
    await locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
      if (lock) await runFlushPass();
    });
    return;
  }
  // No Web Locks: run unguarded. A rare double flush replays entries with
  // their stored idempotency keys, so the server collapses the duplicate —
  // tolerating that is the whole point of the design.
  await runFlushPass();
}
