// Transactional email — Resend client + console fallback for dev/no-key.
// Single sink for new-device verification, "wasn't me" alerts, password resets,
// and compliance notifications. All callers go through `sendEmail()` so we can
// swap providers (Postmark, SES) without touching downstream code.

import pino from "pino";

const log = pino({ name: "email" });

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Tag for analytics/audit grouping. */
  tag?:
    | "device_verify"
    | "device_alert"
    | "password_reset"
    | "compliance_alert";
}

export interface EmailSendResult {
  ok: boolean;
  /** Provider message id on success, error string on failure. */
  detail: string;
  /** True when the message was console-logged instead of sent. */
  stubbed: boolean;
}

const FROM_ADDRESS =
  process.env.EMAIL_FROM_ADDRESS ?? "MediCore <no-reply@medicore.local>";

export async function sendEmail(msg: EmailMessage): Promise<EmailSendResult> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    log.warn(
      { to: msg.to, subject: msg.subject, tag: msg.tag },
      "email_stubbed_no_api_key",
    );
    return { ok: true, detail: "stubbed (no RESEND_API_KEY)", stubbed: true };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [msg.to],
        subject: msg.subject,
        text: msg.text,
        html: msg.html ?? undefined,
        tags: msg.tag ? [{ name: "category", value: msg.tag }] : undefined,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      log.error(
        { to: msg.to, status: res.status, body, tag: msg.tag },
        "email_send_failed",
      );
      return { ok: false, detail: `${res.status}: ${body}`, stubbed: false };
    }

    const payload = (await res.json()) as { id?: string };
    return { ok: true, detail: payload.id ?? "unknown", stubbed: false };
  } catch (err) {
    log.error({ err, to: msg.to, tag: msg.tag }, "email_send_threw");
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
      stubbed: false,
    };
  }
}
