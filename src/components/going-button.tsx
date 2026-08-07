"use client";

// "I'm going" — one tap, plus an optional question the Chamber genuinely needs
// an answer to.
//
// WHY IT ASKS INSTEAD OF SENSING. LTAC reporting wants where visitors travelled
// FROM. Browser geolocation reports where someone is STANDING, which for anyone
// tapping this at the market is Kingston, and IP lookup is wrong at ZIP level
// (src/lib/analytics-store.ts says so). So the honest instrument is a question.
// The pleasant side effect is that no coordinate is read, no consent card is
// needed, and the privacy notice did not have to change.
//
// WHAT LEAVES THE BROWSER: the event id, and the five digits if they typed
// them. No session id, no cookie, no coordinate. The server keeps a COUNT, not
// a row per person — see src/lib/stores/event-going-store.ts.
//
// Repeat taps are suppressed here, in localStorage, because the server has no
// identifier to dedupe against and this table exists precisely so that it
// never will. Someone determined can clear storage and tap again; the number
// is published as interest, not attendance.

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

const STORE_KEY = "vk-going";

/** Counts for the events on screen, fetched ONCE rather than per button.
 *
 *  /events is ISR, so a count cannot be baked into the cached HTML — it would
 *  be a number frozen at build time. Fetching it here after hydration keeps
 *  the page static and the number live. One request for the whole page, not
 *  one per card. */
const CountsContext = createContext<Record<string, number> | null>(null);

export function GoingCounts({ ids, children }: { ids: string[]; children: ReactNode }) {
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  // Joined so the effect keys off a stable primitive; a fresh array every
  // render would refetch on every keystroke elsewhere on the page.
  const key = ids.join(",");
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    fetch(`/api/events/going?ids=${encodeURIComponent(key)}`)
      .then((r) => (r.ok ? r.json() : { counts: {} }))
      .then((d: { counts?: Record<string, number> }) => {
        if (!cancelled) setCounts(d.counts ?? {});
      })
      // A failed count is not worth a visible error: the button still works,
      // the number just stays hidden.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [key]);
  return <CountsContext.Provider value={counts}>{children}</CountsContext.Provider>;
}

/** Event ids this browser has already counted. Storage throws in private
 *  modes, so every access is wrapped — a failure means we forget, which
 *  over-counts rather than losing the tap. */
function alreadyWent(eventId: string): boolean {
  try {
    return (JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]") as string[]).includes(
      eventId,
    );
  } catch {
    return false;
  }
}

function remember(eventId: string): void {
  try {
    const seen = JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]") as string[];
    if (!seen.includes(eventId)) {
      localStorage.setItem(STORE_KEY, JSON.stringify([...seen, eventId].slice(-500)));
    }
  } catch {
    /* private mode — the count still went through, we just can't remember */
  }
}

export function GoingButton({ eventId }: { eventId: string }) {
  const fetched = useContext(CountsContext);
  // The count is DERIVED, not synced: the page's fetched map is the source
  // until this browser taps, after which the server's fresh total wins. An
  // effect copying one into the other would be a second source of truth and
  // another cascading-render lint failure.
  const [tappedCount, setTappedCount] = useState<number | undefined>(undefined);
  // Read through useSyncExternalStore rather than an effect: localStorage is
  // an external store, the server snapshot is honestly "we can't know yet",
  // and setting state from inside an effect is what the cascading-render lint
  // rule is there to prevent. Nothing else mutates the key mid-session, so
  // there is nothing to subscribe to.
  const stored = useSyncExternalStore(
    () => () => {},
    () => alreadyWent(eventId),
    () => false,
  );
  const [justWent, setJustWent] = useState(false);
  const went = stored || justWent;
  const [asking, setAsking] = useState(false);
  const [zip, setZip] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(withZip: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/events/going", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, ...(withZip ? { zip: withZip } : {}) }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        count?: number;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Couldn't save that — try again.");
        return;
      }
      remember(eventId);
      setJustWent(true);
      setAsking(false);
      if (typeof data.count === "number") setTappedCount(data.count);
    } catch {
      setError("Couldn't reach the server — try again.");
    } finally {
      setBusy(false);
    }
  }

  const count = tappedCount ?? fetched?.[eventId];

  if (went) {
    return (
      <p className="mt-2 text-sm font-medium text-fern">
        You&rsquo;re going
        {typeof count === "number" && count > 1 && (
          <span className="font-normal text-ink-soft"> · {count} going</span>
        )}
      </p>
    );
  }

  return (
    <div className="mt-2">
      {!asking ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setAsking(true)}
            className="rounded-full border border-sound bg-white px-4 py-1.5 text-sm font-semibold text-sound-deep hover:bg-sound hover:text-white"
          >
            I&rsquo;m going
          </button>
          {typeof count === "number" && count > 0 && (
            <span className="text-sm text-ink-soft">{count} going</span>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-sand bg-white p-3">
          <label className="block text-sm font-medium text-sound-deep" htmlFor={`zip-${eventId}`}>
            Where are you visiting from?
          </label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input
              id={`zip-${eventId}`}
              value={zip}
              onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
              inputMode="numeric"
              autoComplete="postal-code"
              placeholder="ZIP"
              className="w-24 rounded-lg border border-sand bg-white px-3 py-1.5 text-sm text-ink"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => send(zip)}
              className="rounded-full bg-sound px-4 py-1.5 text-sm font-semibold text-white hover:bg-sound-deep disabled:opacity-60"
            >
              {busy ? "Saving…" : "Count me in"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => send("")}
              className="text-sm font-medium text-tide-deep underline decoration-seaglass underline-offset-2 hover:text-sound"
            >
              Skip
            </button>
          </div>
          <p className="mt-2 text-xs text-ink-soft">
            Optional. We collect your ZIP code for lodging-tax (LTAC) reporting only —
            it tells the Chamber how far people travel for Kingston events. It is
            counted, never linked to you.
          </p>
          {error && (
            <p className="mt-2 text-xs font-medium text-coral-deep" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
