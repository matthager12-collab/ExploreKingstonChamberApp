"use client";

// Client half of /portal/account: the profile (name/email) form and the
// change-password form. Deliberately plain (fetch + local state, no reload)
// in the same spirit as portal/forms.tsx. All authorization is server-side —
// both endpoints act only on the session's own user.

import { useState, type FormEvent } from "react";
import { Card, Section } from "@/components/ui";

const inputClass =
  "mt-1 block w-full rounded-lg border border-sand bg-white px-3 py-2 text-base";
const buttonClass =
  "rounded-full bg-sound px-6 py-2.5 font-semibold text-white hover:bg-sound-deep disabled:opacity-50";

export function AccountSettings({
  name: initialName,
  email: initialEmail,
}: {
  name: string;
  email: string;
}) {
  // ---------- profile form ----------

  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);

  async function saveProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setProfileBusy(true);
    setProfileError(null);
    setProfileSaved(false);
    try {
      const res = await fetch("/api/auth/account", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        name?: string;
        email?: string;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setProfileError(data.error ?? "Something went wrong");
        return;
      }
      // Reflect the server's canonical values (it trims and falls back).
      if (data.name) setName(data.name);
      if (data.email) setEmail(data.email);
      setProfileSaved(true);
    } catch {
      setProfileError("Network error — try again");
    } finally {
      setProfileBusy(false);
    }
  }

  // ---------- change-password form ----------

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSaved, setPwSaved] = useState(false);

  async function changePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPwError(null);
    setPwSaved(false);
    if (next.length < 8) {
      setPwError("New password must be 8+ characters.");
      return;
    }
    if (next !== confirm) {
      setPwError("New passwords don't match.");
      return;
    }
    setPwBusy(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current, next }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setPwError(data.error ?? "Something went wrong");
        return;
      }
      setPwSaved(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch {
      setPwError("Network error — try again");
    } finally {
      setPwBusy(false);
    }
  }

  // ---------- render ----------

  return (
    <>
      <Section title="Edit profile" subtitle="Your name and the email you sign in with.">
        <Card>
          <form onSubmit={saveProfile} className="max-w-sm space-y-4">
            <label className="block text-sm font-medium text-ink">
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoComplete="name"
                className={inputClass}
              />
            </label>
            <label className="block text-sm font-medium text-ink">
              Email
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                required
                autoComplete="email"
                className={inputClass}
              />
            </label>
            {profileError && (
              <p role="alert" className="text-sm font-medium text-coral-deep">{profileError}</p>
            )}
            {profileSaved && <p role="status" className="text-sm font-medium text-fern">Saved.</p>}
            <button type="submit" disabled={profileBusy} className={buttonClass}>
              {profileBusy ? "Saving…" : "Save profile"}
            </button>
          </form>
        </Card>
      </Section>

      <Section
        title="Change password"
        subtitle="You'll need your current password to set a new one."
      >
        <Card>
          <form onSubmit={changePassword} className="max-w-sm space-y-4">
            <label className="block text-sm font-medium text-ink">
              Current password
              <input
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                type="password"
                required
                autoComplete="current-password"
                className={inputClass}
              />
            </label>
            <label className="block text-sm font-medium text-ink">
              New password (8+ characters)
              <input
                value={next}
                onChange={(e) => setNext(e.target.value)}
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                className={inputClass}
              />
            </label>
            <label className="block text-sm font-medium text-ink">
              Confirm new password
              <input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                className={inputClass}
              />
            </label>
            {pwError && <p role="alert" className="text-sm font-medium text-coral-deep">{pwError}</p>}
            {pwSaved && (
              <p role="status" className="text-sm font-medium text-fern">
                Saved — use the new password next time you sign in.
              </p>
            )}
            <button type="submit" disabled={pwBusy} className={buttonClass}>
              {pwBusy ? "Saving…" : "Change password"}
            </button>
            <p className="text-xs text-ink-soft">
              We can&apos;t display your password — not even the Chamber can see it. Forget it?
              An admin can reset it for you.
            </p>
          </form>
        </Card>
      </Section>
    </>
  );
}
