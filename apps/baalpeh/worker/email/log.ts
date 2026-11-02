import type { EmailMessage, EmailSender } from "./sender";

const OUTBOX_CAP = 50;

/** Messages "sent" by LogSender, newest last (tests and local dev read it). */
export const devOutbox: EmailMessage[] = [];

/** Development sender. Prints the email only for a localhost APP_ORIGIN; anywhere else it fails loudly. */
export class LogSender implements EmailSender {
  readonly kind = "log";

  constructor(private readonly printSecrets: boolean) {}

  async send(msg: EmailMessage): Promise<void> {
    if (!this.printSecrets) {
      console.error("RESEND_API_KEY is not set; login email NOT sent");
      throw new Error("no email provider configured");
    }
    // Only for localhost: the outbox holds live links and codes.
    devOutbox.push(msg);
    if (devOutbox.length > OUTBOX_CAP) devOutbox.splice(0, devOutbox.length - OUTBOX_CAP);
    console.log(`[dev email] to=${msg.to} subject=${msg.subject}\n${msg.text}`);
  }
}
