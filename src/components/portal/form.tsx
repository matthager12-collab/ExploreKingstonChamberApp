"use client";

import { useId, type ComponentPropsWithoutRef, type ReactNode } from "react";

/* PORTAL FORM PRIMITIVES.
 *
 * The layer the portal never had. Before this file there were SIX separate
 * `const inputClass = "..."` constants — forms, account/settings,
 * business/editor, directory-editor, lodging-editor, nonprofit/editor — each
 * file styling its own controls, none of them wired for assistive tech, and the
 * largest editor at 797 lines. Every one of those is a place the next change
 * has to be made again.
 *
 * Each *Field owns its own label / hint / error / ARIA wiring, because that is
 * the part that is easy to skip and tedious to review:
 *
 *   - id from useId(), so it is unique without anyone thinking about it
 *   - htmlFor, never a WRAPPING <label>: a wrapper folds any hint text into the
 *     control's accessible name, which is how "New password (8+ characters)"
 *     ends up being read as the field's name
 *   - hint and error joined into aria-describedby
 *   - an error sets aria-invalid AND renders text — never colour alone (1.4.1)
 *
 * text-base is load-bearing, not cosmetic: iOS Safari zooms the viewport when a
 * focused control's font-size is under 16px. Never drop a control to text-sm.
 * (The fix is NOT maximum-scale=1 — that disables pinch-zoom and fails 1.4.4.) */

const CONTROL =
  "block w-full rounded-lg border border-border-strong bg-white px-3 py-2.5 " +
  "text-base text-ink placeholder:text-ink-soft " +
  "aria-[invalid=true]:border-danger aria-[invalid=true]:border-2 " +
  "disabled:bg-surface-sunken disabled:text-ink-soft disabled:cursor-not-allowed";

function describedBy(id: string, hint: unknown, error: unknown) {
  const ids = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean);
  return ids.length ? ids.join(" ") : undefined;
}

type FieldMeta = {
  label: string;
  hint?: ReactNode;
  error?: string;
};

function FieldShell({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="text-sm">
      <label htmlFor={id} className="block font-semibold text-ink">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="portal-measure mt-1 text-ink-soft">
          {hint}
        </p>
      )}
      <div className="mt-1.5">{children}</div>
      {error && (
        // role="alert" because these appear AFTER render, in response to a
        // submit — shown is not the same as announced.
        <p id={`${id}-error`} role="alert" className="mt-1.5 font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextField({
  label,
  hint,
  error,
  ...props
}: FieldMeta & ComponentPropsWithoutRef<"input">) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <input
        id={id}
        aria-describedby={describedBy(id, hint, error)}
        aria-invalid={error ? true : undefined}
        className={CONTROL}
        {...props}
      />
    </FieldShell>
  );
}

export function TextAreaField({
  label,
  hint,
  error,
  ...props
}: FieldMeta & ComponentPropsWithoutRef<"textarea">) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <textarea
        id={id}
        rows={4}
        aria-describedby={describedBy(id, hint, error)}
        aria-invalid={error ? true : undefined}
        className={CONTROL}
        {...props}
      />
    </FieldShell>
  );
}

export function SelectField({
  label,
  hint,
  error,
  children,
  ...props
}: FieldMeta & ComponentPropsWithoutRef<"select">) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <select
        id={id}
        aria-describedby={describedBy(id, hint, error)}
        aria-invalid={error ? true : undefined}
        className={CONTROL}
        {...props}
      >
        {children}
      </select>
    </FieldShell>
  );
}

/* --- Buttons --------------------------------------------------------------
 * min-h-11 is ~44px: a comfortable touch target, above the 24px WCAG 2.2 floor
 * rather than exactly at it. Always a real <button>. */

const VARIANTS = {
  primary: "bg-primary text-white hover:bg-primary-deep",
  secondary: "bg-secondary text-white hover:bg-secondary-deep",
  danger: "bg-danger text-white hover:brightness-90",
  ghost: "border border-border-strong text-ink hover:bg-surface-sunken",
} as const;

export function Button({
  variant = "primary",
  pending = false,
  pendingLabel = "Saving…",
  children,
  className = "",
  ...props
}: {
  variant?: keyof typeof VARIANTS;
  pending?: boolean;
  pendingLabel?: string;
  children: ReactNode;
} & ComponentPropsWithoutRef<"button">) {
  return (
    <button
      className={`inline-flex min-h-11 items-center justify-center rounded-full px-6 py-2.5 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]} ${className}`}
      disabled={pending || props.disabled}
      aria-busy={pending || undefined}
      {...props}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

/* --- FormSection ----------------------------------------------------------
 * The grouping unit of a form page. A heading every few fields gives the eye
 * somewhere to land, and somewhere to come back to after a break. */

export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-white p-5">
      <h2 className="font-display text-xl font-semibold text-primary-deep">{title}</h2>
      {description && (
        <p className="portal-measure mt-1 text-sm text-ink-soft">{description}</p>
      )}
      <div className="mt-4 flex flex-col gap-5">{children}</div>
    </section>
  );
}

/* --- FormStatus -----------------------------------------------------------
 * One component for the after-submit line, so success and failure cannot drift
 * apart in styling or in how they are announced.
 *
 * Error uses --color-danger, NOT coral. Coral is the CTA colour; using it for
 * failure too means the same hue says "do this" and "that went wrong" on the
 * same screen. */

export function FormStatus({
  error,
  success,
}: {
  error?: string | null;
  success?: string | null;
}) {
  if (error) {
    return (
      <p role="alert" className="text-sm font-semibold text-danger">
        {error}
      </p>
    );
  }
  if (success) {
    return (
      <p role="status" className="text-sm font-semibold text-success-deep">
        {success}
      </p>
    );
  }
  return null;
}
