// Minimal outbound email seam (E20) — POSTs to Resend over plain fetch, no
// SDK. E21 (notifications) will absorb this module; keep it boring.
//
// Unset RESEND_API_KEY or EMAIL_FROM ⇒ a safe no-op that reports itself —
// dev, CI, and a not-yet-configured production all degrade to "no email"
// without throwing. Callers treat email as best-effort by design: a failed
// confirmation send never fails a signup.

export type SendEmailResult =
  | { sent: true; id?: string }
  | { sent: false; reason: "email-disabled" | "send-failed" };

export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return { sent: false, reason: "email-disabled" };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        ...(input.html ? { html: input.html } : {}),
      }),
    });
    if (!res.ok) return { sent: false, reason: "send-failed" };
    const body = (await res.json().catch(() => ({}))) as { id?: string };
    return { sent: true, ...(body.id ? { id: body.id } : {}) };
  } catch {
    return { sent: false, reason: "send-failed" };
  }
}
