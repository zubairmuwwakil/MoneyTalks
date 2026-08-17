import { Resend } from "resend";

export const resend = new Resend(process.env.RESEND_API_KEY || "re_dummy");

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}) {
  const rawFrom = process.env.EMAIL_FROM;
  if (!rawFrom) throw new Error("EMAIL_FROM missing");
  if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY missing");

  const from = rawFrom.includes("<") ? rawFrom : `PickMe <${rawFrom}>`;

  return resend.emails.send({
    from,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  });
}
