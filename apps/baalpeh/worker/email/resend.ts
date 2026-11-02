import type { EmailMessage, EmailSender } from "./sender";

export const RESEND_URL = "https://api.resend.com/emails";

/** Resend HTTP API (no SDK). */
export class ResendSender implements EmailSender {
  readonly kind = "resend";

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(msg: EmailMessage): Promise<void> {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + this.apiKey,
        "Content-Type": "application/json",
        "Idempotency-Key": msg.idempotencyKey,
      },
      body: JSON.stringify({ from: this.from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
    });
    if (!res.ok) {
      // Status and provider response only; never the email content.
      const detail = (await res.text().catch(() => "")).slice(0, 500);
      console.error(`resend send failed: ${res.status} ${detail}`);
      throw new Error("resend " + res.status);
    }
  }
}
