import { Resend } from "resend";

const apiKey = process.env.RESEND_API_KEY || process.env.AUTH_RESEND_KEY;
export const resend = new Resend(apiKey || "re_dummy");

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}) {
  const rawFrom = process.env.EMAIL_FROM || process.env.AUTH_EMAIL_FROM;
  if (!rawFrom) throw new Error("EMAIL_FROM missing");
  if (!apiKey) throw new Error("RESEND_API_KEY missing");

  const from = rawFrom.includes("<") ? rawFrom : `PickMe <${rawFrom}>`;

  return resend.emails.send({
    from,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  });
}

