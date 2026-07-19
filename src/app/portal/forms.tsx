"use client";

// Client forms for the portal auth flows: login, first-run setup, and
// invite redemption. Deliberately plain: fetch + reload on success.

import { useState, type FormEvent, type ReactNode } from "react";

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block text-sm font-medium text-ink">
      {label}
      {children}
    </label>
  );
}

const inputClass =
  "mt-1 block w-full rounded-lg border border-sand bg-white px-3 py-2 text-base";
const buttonClass =
  "rounded-full bg-sound px-6 py-2.5 font-semibold text-white hover:bg-sound-deep disabled:opacity-50";

function useSubmit(endpoint: string, redirectTo = "/portal") {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(payload: Record<string, string>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Something went wrong");
        setBusy(false);
        return;
      }
      window.location.href = redirectTo;
    } catch {
      setError("Network error — try again");
      setBusy(false);
    }
  }

  return { busy, error, submit };
}

function formValues(e: FormEvent<HTMLFormElement>): Record<string, string> {
  e.preventDefault();
  const data = new FormData(e.currentTarget);
  return Object.fromEntries(
    [...data.entries()].map(([k, v]) => [k, String(v)]),
  ) as Record<string, string>;
}

export function LoginForm() {
  const { busy, error, submit } = useSubmit("/api/auth/login");
  return (
    <form onSubmit={(e) => submit(formValues(e))} className="max-w-sm space-y-4">
      <Field label="Email">
        <input name="email" type="email" required autoComplete="email" className={inputClass} />
      </Field>
      <Field label="Password">
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className={inputClass}
        />
      </Field>
      {error && <p className="text-sm font-medium text-coral-deep">{error}</p>}
      <button type="submit" disabled={busy} className={buttonClass}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
      <p className="text-sm text-ink-soft">
        Have an invite code from the Chamber?{" "}
        <a href="/portal/join" className="font-medium text-tide-deep underline underline-offset-2">
          Create your account
        </a>
      </p>
    </form>
  );
}

export function SetupForm() {
  const { busy, error, submit } = useSubmit("/api/auth/setup");
  return (
    <form onSubmit={(e) => submit(formValues(e))} className="max-w-sm space-y-4">
      <Field label="Your name">
        <input name="name" required className={inputClass} />
      </Field>
      <Field label="Email">
        <input name="email" type="email" required className={inputClass} />
      </Field>
      <Field label="Password (8+ characters)">
        <input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={inputClass}
        />
      </Field>
      <Field label="Setup token">
        <input name="setupToken" required className={inputClass} />
      </Field>
      <p className="text-xs text-ink-soft">
        From the SETUP_TOKEN environment variable — see docs/DEPLOY.md.
      </p>
      {error && <p className="text-sm font-medium text-coral-deep">{error}</p>}
      <button type="submit" disabled={busy} className={buttonClass}>
        {busy ? "Creating…" : "Create admin account"}
      </button>
    </form>
  );
}

export function JoinForm() {
  const { busy, error, submit } = useSubmit("/api/auth/redeem");
  return (
    <form onSubmit={(e) => submit(formValues(e))} className="max-w-sm space-y-4">
      <Field label="Invite code">
        <input name="code" required className={inputClass} placeholder="from the Chamber" />
      </Field>
      <Field label="Your name">
        <input name="name" required className={inputClass} />
      </Field>
      <Field label="Email">
        <input
          name="email"
          type="email"
          required
          aria-describedby="join-email-hint"
          className={inputClass}
        />
        {/* Invites can be bound to a specific address (E06), and admin invites
            always are. Saying so here turns "This invite is bound to a
            different email address" from a dead end into an obvious fix. */}
        <p id="join-email-hint" className="mt-1 text-xs text-ink-soft">
          If the Chamber sent your invite to a particular address, use that one.
        </p>
      </Field>
      <Field label="Password (8+ characters)">
        <input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={inputClass}
        />
      </Field>
      {error && (
        <p role="alert" className="text-sm font-medium text-coral-deep">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy} className={buttonClass}>
        {busy ? "Creating…" : "Create account"}
      </button>
    </form>
  );
}

export function LogoutButton() {
  return (
    <button
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        window.location.href = "/portal";
      }}
      className="text-sm font-medium text-ink-soft underline underline-offset-2 hover:text-ink"
    >
      Sign out
    </button>
  );
}
