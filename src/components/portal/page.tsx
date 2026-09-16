import type { ReactNode } from "react";

/* The page frame inside the portal shell.
 *
 * The shell renders ONLY navigation — same split as AdminShell, so titles are
 * never doubled and each page owns its own <h1>.
 *
 * Two widths, and the choice is not cosmetic:
 *   "form" — a column. A text input stretched across a wide screen is miserable
 *            to scan back along, and the label-to-field distance grows with it.
 *   "wide" — tables, dashboards, anything genuinely two-dimensional.
 *
 * Deliberately NOT the public site's <PageHeader>: that one is tuned for the
 * marketing pages (max-w-5xl, uppercase eyebrow, 4xl/5xl display type) and
 * mixing its width with a form column produced a heading that visibly
 * overhung the fields beneath it. */

export function PortalPage({
  title,
  intro,
  actions,
  width = "form",
  children,
}: {
  title: string;
  intro?: ReactNode;
  actions?: ReactNode;
  width?: "form" | "wide";
  children: ReactNode;
}) {
  return (
    <div
      className={`mx-auto flex w-full flex-col gap-5 px-4 py-8 sm:px-6 ${
        width === "form" ? "max-w-3xl" : "max-w-5xl"
      }`}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {/* Sentence case, not the public site's uppercase eyebrow: all-caps
              strips the ascender/descender pattern word-shape recognition
              depends on, and this is a surface people work in daily. */}
          <h1 className="font-display text-3xl font-semibold text-primary-deep">
            {title}
          </h1>
          {intro && <p className="app-measure mt-2 text-ink">{intro}</p>}
        </div>
        {actions}
      </header>
      {children}
    </div>
  );
}

/* A read-only panel — the "here are the facts" counterpart to FormSection. */
export function PortalPanel({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-white p-5">
      {title && (
        <h2 className="font-display text-xl font-semibold text-primary-deep">
          {title}
        </h2>
      )}
      <div className={title ? "mt-4" : undefined}>{children}</div>
    </section>
  );
}

/* Label/value pairs. Subgrid keeps the values aligned down the column instead
 * of each row finding its own indent. */
export function FieldList({
  fields,
}: {
  fields: { label: string; value: ReactNode }[];
}) {
  return (
    <dl className="grid gap-3 sm:grid-cols-[11rem_1fr]">
      {fields.map((f) => (
        <div
          key={f.label}
          className="grid gap-0.5 sm:col-span-2 sm:grid-cols-subgrid"
        >
          <dt className="text-sm font-semibold text-ink-soft">{f.label}</dt>
          <dd className="m-0 text-ink">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}
