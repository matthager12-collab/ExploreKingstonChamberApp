"use client";

// E17 claim-signup disclosure — the self-serve successor to claim-listing.tsx
// (whose request-a-call path lives on INSIDE this component as the fallback
// mode). A quiet "Own this business?" link expands into:
//
//   signup mode (default): name + business email + password → POST
//     /api/claim/signup → 6-digit emailed code → POST /api/claim/verify →
//     the account exists, the user is signed in, and the claim either landed
//     (roster match) or sits with the Chamber. The response NEVER says
//     whether an email is on the roster before the code proves control of it.
//   request mode (fallback): the old name + phone + note form → POST
//     /api/claim → a worklist item; the Chamber calls to verify. For owners
//     without access to the on-file mailbox.
//
// A signed-in visitor gets the one-button variant when the PAGE knows the
// session (signedIn prop — only dynamic pages pass it; the ISR card pages
// cannot read cookies, so their forms submit blind and the SERVER answers
// mode:"signed-in" if a session cookie rode along).
//
// All public wording resolves through the copy registry (E07 rule); the only
// inline strings are admin-authored API error messages passed through.

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useCopy } from "@/lib/copy-context";

type Step = "form" | "code" | "done";
type DoneKind =
  | "approved"
  | "pending"
  | "requested"
  | "signed-in-approved"
  | "signed-in-pending";

const inputCls =
  "mt-1 block w-full rounded-lg border border-sand bg-white px-2 py-1.5 text-sm";
const hintCls = "text-xs font-normal text-ink-soft";
const primaryBtn =
  "rounded-full bg-sound px-4 py-1.5 text-xs font-semibold text-white hover:bg-sound-deep disabled:opacity-50";
const quietBtn =
  "rounded-full border border-sand bg-white px-4 py-1.5 text-xs font-medium text-ink hover:border-tide";

export function ClaimSignup({
  store,
  id,
  subject,
  signedIn = false,
}: {
  /** Claimable content store: "restaurants" | "lodging" | "charities" | "directory". */
  store: string;
  /** Record id within the store. */
  id: string;
  /** Listing name — disambiguates the identical disclosure buttons for
   *  assistive tech (many cards render this component on one page). */
  subject?: string;
  /** Pass true ONLY from pages that actually read the session (dynamic
   *  pages). Renders the one-button request variant. */
  signedIn?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"signup" | "request">("signup");
  const [step, setStep] = useState<Step>("form");
  const [doneKind, setDoneKind] = useState<DoneKind>("pending");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [signupId, setSignupId] = useState("");
  const [emailSent, setEmailSent] = useState(true);

  const [contactName, setContactName] = useState("");
  const [contact, setContact] = useState("");
  const [message, setMessage] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formId = useId();
  const nameId = useId();
  const emailId = useId();
  const emailHintId = useId();
  const passwordId = useId();
  const passwordHintId = useId();
  const codeId = useId();
  const reqNameId = useId();
  const reqContactId = useId();
  const reqContactHintId = useId();
  const reqMessageId = useId();
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLParagraphElement>(null);

  const disclosureLabel = useCopy("claim.disclosure.label");
  const intro = useCopy("claimSignup.form.intro");
  const nameLabel = useCopy("claim.form.name.label");
  const emailLabel = useCopy("claimSignup.form.email.label");
  const emailHint = useCopy("claimSignup.form.email.hint");
  const passwordLabel = useCopy("claimSignup.form.password.label");
  const passwordHint = useCopy("claimSignup.form.password.hint");
  const submitLabel = useCopy("claimSignup.form.submit");
  const sendingLabel = useCopy("claimSignup.form.sending");
  const codeIntro = useCopy("claimSignup.code.intro");
  const codeDevHint = useCopy("claimSignup.code.devHint");
  const codeLabel = useCopy("claimSignup.code.label");
  const codeSubmit = useCopy("claimSignup.code.submit");
  const codeVerifying = useCopy("claimSignup.code.verifying");
  const successApproved = useCopy("claimSignup.success.approved");
  const successPending = useCopy("claimSignup.success.pending");
  const portalCta = useCopy("claimSignup.success.portalCta");
  const fallbackToggle = useCopy("claimSignup.fallback.toggle");
  const fallbackBack = useCopy("claimSignup.fallback.back");
  const signedInIntro = useCopy("claimSignup.signedIn.intro");
  const signedInSubmit = useCopy("claimSignup.signedIn.submit");
  const signedInApproved = useCopy("claimSignup.signedIn.approved");
  const signedInPending = useCopy("claimSignup.signedIn.pending");
  const cancelLabel = useCopy("claim.form.cancel");
  const genericError = useCopy("claim.form.error");
  // Fallback (request-a-call) mode reuses the original claim.* copy.
  const reqIntro = useCopy("claim.form.intro");
  const reqContactLabel = useCopy("claim.form.contact.label");
  const reqContactHint = useCopy("claim.form.contact.hint");
  const reqMessageLabel = useCopy("claim.form.message.label");
  const optionalMark = useCopy("claim.form.optional");
  const reqSubmit = useCopy("claim.form.submit");
  const reqSending = useCopy("claim.form.sending");
  const reqSuccess = useCopy("claim.form.success");

  // Focus moves at exactly three moments (the claim-listing.tsx rule, plus
  // one): the disclosure EXPANDING (land on the first field), the code step
  // APPEARING (land on the code field), and DONE (read the outcome). Nothing
  // else may move focus — errors announce via the role="alert" region.
  useEffect(() => {
    if (open) firstFieldRef.current?.focus();
  }, [open, mode]);
  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
    if (step === "done") doneRef.current?.focus();
  }, [step]);

  async function post(url: string, body: Record<string, unknown>) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
      error?: string;
    };
    return { ok: res.ok, data };
  }

  function finish(kind: DoneKind) {
    setDoneKind(kind);
    setStep("done");
  }

  async function submitSignup(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = signedIn
        ? { store, id }
        : { store, id, name, email, password };
      const { ok, data } = await post("/api/claim/signup", body);
      if (!ok) {
        setError(data.error ?? genericError);
        return;
      }
      if (data.mode === "signed-in") {
        finish(data.approved ? "signed-in-approved" : "signed-in-pending");
        return;
      }
      setSignupId(typeof data.signupId === "string" ? data.signupId : "");
      setEmailSent(data.emailSent !== false);
      setStep("code");
    } catch {
      setError(genericError);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { ok, data } = await post("/api/claim/verify", { signupId, code });
      if (!ok) {
        setError(data.error ?? genericError);
        return;
      }
      finish(data.approved ? "approved" : "pending");
    } catch {
      setError(genericError);
    } finally {
      setBusy(false);
    }
  }

  async function submitRequest(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { ok, data } = await post("/api/claim", {
        store,
        id,
        contactName,
        contact,
        ...(message.trim() ? { message } : {}),
      });
      if (!ok) {
        setError(data.error ?? genericError);
        return;
      }
      finish("requested");
    } catch {
      setError(genericError);
    } finally {
      setBusy(false);
    }
  }

  if (step === "done") {
    const text =
      doneKind === "approved"
        ? successApproved
        : doneKind === "pending"
          ? successPending
          : doneKind === "signed-in-approved"
            ? signedInApproved
            : doneKind === "signed-in-pending"
              ? signedInPending
              : reqSuccess;
    const showPortal = doneKind !== "requested";
    return (
      <div className="mt-2 space-y-2">
        <p ref={doneRef} tabIndex={-1} role="status" className="text-xs font-medium text-fern">
          {text}
        </p>
        {showPortal && (
          <Link
            href="/portal/business"
            className="inline-block rounded-full bg-sound px-4 py-1.5 text-xs font-semibold text-white hover:bg-sound-deep"
          >
            {portalCta}
          </Link>
        )}
      </div>
    );
  }

  const errorRegion = error && (
    <p className="text-xs font-medium text-coral-deep" role="alert">
      {error}
    </p>
  );

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={open ? formId : undefined}
        aria-label={subject ? `${disclosureLabel} — ${subject}` : undefined}
        className="text-xs font-medium text-ink-soft underline underline-offset-2 hover:text-ink"
      >
        {disclosureLabel}
      </button>

      {open && step === "form" && signedIn && (
        <form id={formId} onSubmit={submitSignup} className="mt-3 space-y-2 rounded-lg border border-sand bg-white/60 p-3">
          <p className="text-xs text-ink-soft">{signedInIntro}</p>
          {errorRegion}
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={primaryBtn}>
              {busy ? sendingLabel : signedInSubmit}
            </button>
            <button type="button" onClick={() => setOpen(false)} className={quietBtn}>
              {cancelLabel}
            </button>
          </div>
        </form>
      )}

      {open && step === "form" && !signedIn && mode === "signup" && (
        <form id={formId} onSubmit={submitSignup} className="mt-3 space-y-2 rounded-lg border border-sand bg-white/60 p-3">
          <p className="text-xs text-ink-soft">{intro}</p>
          <label htmlFor={nameId} className="block text-xs font-medium text-ink">
            {nameLabel}
            <input
              ref={firstFieldRef}
              id={nameId}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={200}
              autoComplete="name"
              className={inputCls}
            />
          </label>
          <label htmlFor={emailId} className="block text-xs font-medium text-ink">
            {emailLabel}
            <input
              id={emailId}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              maxLength={200}
              autoComplete="email"
              aria-describedby={emailHintId}
              className={inputCls}
            />
          </label>
          <p id={emailHintId} className={hintCls}>
            {emailHint}
          </p>
          <label htmlFor={passwordId} className="block text-xs font-medium text-ink">
            {passwordLabel}
            <input
              id={passwordId}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              aria-describedby={passwordHintId}
              className={inputCls}
            />
          </label>
          <p id={passwordHintId} className={hintCls}>
            {passwordHint}
          </p>
          {errorRegion}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !name.trim() || !email.trim() || password.length < 8}
              className={primaryBtn}
            >
              {busy ? sendingLabel : submitLabel}
            </button>
            <button type="button" onClick={() => setOpen(false)} className={quietBtn}>
              {cancelLabel}
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              setMode("request");
              setError(null);
            }}
            className="block text-xs font-medium text-ink-soft underline underline-offset-2 hover:text-ink"
          >
            {fallbackToggle}
          </button>
        </form>
      )}

      {open && step === "form" && !signedIn && mode === "request" && (
        <form id={formId} onSubmit={submitRequest} className="mt-3 space-y-2 rounded-lg border border-sand bg-white/60 p-3">
          <p className="text-xs text-ink-soft">{reqIntro}</p>
          <label htmlFor={reqNameId} className="block text-xs font-medium text-ink">
            {nameLabel}
            <input
              ref={firstFieldRef}
              id={reqNameId}
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              required
              maxLength={200}
              autoComplete="name"
              className={inputCls}
            />
          </label>
          <label htmlFor={reqContactId} className="block text-xs font-medium text-ink">
            {reqContactLabel}
            <input
              id={reqContactId}
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              required
              maxLength={200}
              autoComplete="tel"
              aria-describedby={reqContactHintId}
              className={inputCls}
            />
          </label>
          <p id={reqContactHintId} className={hintCls}>
            {reqContactHint}
          </p>
          <label htmlFor={reqMessageId} className="block text-xs font-medium text-ink">
            {reqMessageLabel} <span className="font-normal text-ink-soft">{optionalMark}</span>
            <textarea
              id={reqMessageId}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
              maxLength={1000}
              className={inputCls}
            />
          </label>
          {errorRegion}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !contactName.trim() || !contact.trim()}
              className={primaryBtn}
            >
              {busy ? reqSending : reqSubmit}
            </button>
            <button type="button" onClick={() => setOpen(false)} className={quietBtn}>
              {cancelLabel}
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              setMode("signup");
              setError(null);
            }}
            className="block text-xs font-medium text-ink-soft underline underline-offset-2 hover:text-ink"
          >
            {fallbackBack}
          </button>
        </form>
      )}

      {open && step === "code" && (
        <form id={formId} onSubmit={submitCode} className="mt-3 space-y-2 rounded-lg border border-sand bg-white/60 p-3">
          <p className="text-xs text-ink-soft">{codeIntro}</p>
          {!emailSent && <p className={hintCls}>{codeDevHint}</p>}
          <label htmlFor={codeId} className="block text-xs font-medium text-ink">
            {codeLabel}
            <input
              ref={codeRef}
              id={codeId}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              required
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoComplete="one-time-code"
              className={inputCls}
            />
          </label>
          {errorRegion}
          <div className="flex gap-2">
            <button type="submit" disabled={busy || code.length !== 6} className={primaryBtn}>
              {busy ? codeVerifying : codeSubmit}
            </button>
            <button type="button" onClick={() => setOpen(false)} className={quietBtn}>
              {cancelLabel}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
