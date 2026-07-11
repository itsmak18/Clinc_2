// SMS — fallback channel for new-device verification on privileged roles
// (super_admin / admin / compliance_officer) when the email link is not
// clicked within 5 min. Provider is intentionally pluggable — Twilio /
// MessageBird / local-gateway can all be slotted behind `sendSms()`.
//
// Until SMS_PROVIDER is configured, every call console-logs and reports
// `stubbed: true`. The device-trust service must treat a stubbed response
// as a no-op fallback — never assume the user actually received an SMS.

import { logger } from "../lib/logger";
import { config } from "../lib/config";

const log = logger.child({ module: "sms" });

export interface SmsMessage {
  to: string;
  body: string;
  tag?: "device_verify_fallback" | "compliance_alert";
}

export interface SmsSendResult {
  ok: boolean;
  detail: string;
  stubbed: boolean;
}

export async function sendSms(msg: SmsMessage): Promise<SmsSendResult> {
  const provider = config.smsProvider;

  if (!provider) {
    log.warn(
      { phone: msg.to, tag: msg.tag },
      "sms_stubbed_no_provider",
    );
    return { ok: true, detail: "stubbed (no SMS_PROVIDER)", stubbed: true };
  }

  // Twilio is the only provider we wire on first pass. Add more branches as
  // the platform team picks one.
  if (provider === "twilio") {
    const sid = config.twilioAccountSid;
    const token = config.twilioAuthToken;
    const from = config.twilioFromNumber;
    if (!sid || !token || !from) {
      log.error("sms_twilio_missing_credentials");
      return { ok: false, detail: "twilio_credentials_missing", stubbed: false };
    }
    try {
      const auth = Buffer.from(`${sid}:${token}`).toString("base64");
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ To: msg.to, From: from, Body: msg.body }),
        },
      );
      if (!res.ok) {
        const body = await res.text();
        log.error({ status: res.status }, "sms_send_failed");
        return { ok: false, detail: `${res.status}: ${body}`, stubbed: false };
      }
      const payload = (await res.json()) as { sid?: string };
      return { ok: true, detail: payload.sid ?? "unknown", stubbed: false };
    } catch (err) {
      log.error({ err }, "sms_send_threw");
      return {
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
        stubbed: false,
      };
    }
  }

  log.error({ provider }, "sms_unknown_provider");
  return { ok: false, detail: `unknown provider: ${provider}`, stubbed: false };
}
