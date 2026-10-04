import type { ServiceDue } from "@reef/shared";
import { message } from "./service-due.js";

/**
 * The service reminder as an email.
 *
 * Nothing here sends anything. Rendering and sending are kept apart because the shape of the
 * message is the part that goes wrong in an inbox, and it is the part that can be checked
 * without a mail account. `Mailer` is the seam a provider plugs into later.
 *
 * Every choice below is a thing Outlook breaks. Outlook renders with Word, not a browser, so:
 * no external stylesheet, no background image, no flexbox and no grid; a table for the layout;
 * widths in pixels rather than percentages; inline styles only. A plain text alternative is
 * always sent, because a phone that refuses the HTML still has to show something readable.
 */

export type Email = { subject: string; text: string; html: string };

export interface Mailer {
  send(to: string, email: Email): Promise<void>;
}

/** The default. It records what would have gone out, so nothing is silently lost. */
export class LoggingMailer implements Mailer {
  sent: { to: string; email: Email }[] = [];
  constructor(private readonly log: (line: string) => void = console.log) {}
  async send(to: string, email: Email) {
    this.sent.push({ to, email });
    this.log(`email not sent (no provider configured): ${to} / ${email.subject}`);
  }
}

function escape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderServiceDue(due: ServiceDue, link: string): Email {
  const { subject, body } = message(due);

  const text = [
    body,
    "",
    `Open the maintenance screen: ${link}`,
    "",
    "You are receiving this because you manage equipment at REEF.",
  ].join("\n");

  // 600 pixels is the width that survives the Outlook reading pane, and a single column is the
  // only layout that also reads on a plant phone without pinching.
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f4f6f9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f6f9;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background-color:#ffffff;border:1px solid #d7dde6;">
<tr><td style="padding:20px 24px;background-color:#0e2841;">
<span style="font-family:Calibri,Arial,sans-serif;font-size:13px;font-weight:bold;color:#b0d016;">REEF OPERATIONS PLATFORM</span>
</td></tr>
<tr><td style="padding:24px;">
<p style="margin:0 0 12px 0;font-family:Calibri,Arial,sans-serif;font-size:20px;font-weight:bold;color:#0e2841;">${escape(subject)}</p>
<p style="margin:0 0 20px 0;font-family:Calibri,Arial,sans-serif;font-size:15px;line-height:22px;color:#45505e;">${escape(body)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="background-color:#3b43d7;padding:12px 22px;">
<a href="${escape(link)}" style="font-family:Calibri,Arial,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;">Open the maintenance screen</a>
</td></tr></table>
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #d7dde6;">
<p style="margin:0;font-family:Calibri,Arial,sans-serif;font-size:12px;color:#45505e;">You are receiving this because you manage equipment at REEF.</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;

  return { subject, text, html };
}
