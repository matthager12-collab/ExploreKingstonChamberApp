"use client";

// Client half of /portal/account: the profile (name/email) form and the
// change-password form. Deliberately plain (fetch + local state, no reload).
// All authorization is server-side — both endpoints act only on the session's
// own user.
//
// REBUILT ON THE PORTAL FORM PRIMITIVES (archetype D7). Every fetch, every
// validation rule, every endpoint and every autoComplete value below is
// unchanged from the pre-shell version; only the markup moved. That was the
// whole constraint on this screen: it is the account and password surface, so
// it gets restyled, never re-logicked.
//
// What the primitives changed, and why each mattered here:
//   - the wrapping <label> is gone. It made the accessible name of the new
//     password field "New password (8+ characters)"; the requirement is now a
//     hint, reached through aria-describedby, and the name is "New password".
//   - errors carry aria-invalid and role="alert" rather than only turning red.
//   - failure is --color-danger, not coral. Coral is the CTA colour, and having
//     one hue mean both "press this" and "that failed" on the same screen is
//     the kind of thing nobody notices until it matters.

import { useState, type FormEvent } from "react";
import {
  Button,
  FormSection,
  FormStatus,
  TextField,
} from "@/components/portal/form";

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

  // Which field an error belongs to. The two password rules are checked before
  // the request, so they can point at the field that broke rather than sitting
  // in a general status line the reader has to map back themselves.
  const mismatch = pwError === "New passwords don't match.";
  const tooShort = pwError === "New password must be 8+ characters.";
  const generalPwError = pwError && !mismatch && !tooShort ? pwError : null;

  // No container of its own — PortalPage owns the column and the gap, so this
  // returns a fragment. Nesting a second max-width here would silently narrow
  // these two sections relative to the profile panel above them.
  return (
    <>
      <FormSection
        title="Edit profile"
        description="Your name and the email you sign in with."
      >
        <form onSubmit={saveProfile} className="flex flex-col gap-5">
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoComplete="name"
          />
          <TextField
            label="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            required
            autoComplete="email"
          />
          <FormStatus
            error={profileError}
            success={profileSaved ? "Saved." : null}
          />
          <div>
            <Button type="submit" pending={profileBusy}>
              Save profile
            </Button>
          </div>
        </form>
      </FormSection>

      <FormSection
        title="Change password"
        description="You'll need your current password to set a new one."
      >
        <form onSubmit={changePassword} className="flex flex-col gap-5">
          <TextField
            label="Current password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            type="password"
            required
            autoComplete="current-password"
          />
          <TextField
            label="New password"
            hint="At least 8 characters."
            error={tooShort ? pwError : undefined}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
          />
          <TextField
            label="Confirm new password"
            error={mismatch ? pwError : undefined}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
          />
          <FormStatus
            error={generalPwError}
            success={
              pwSaved ? "Saved — use the new password next time you sign in." : null
            }
          />
          <div>
            <Button type="submit" pending={pwBusy}>
              Change password
            </Button>
          </div>
          <p className="app-measure text-sm text-ink-soft">
            We can&apos;t display your password — not even the Chamber can see it.
            Forget it? An admin can reset it for you.
          </p>
        </form>
      </FormSection>
    </>
  );
}
