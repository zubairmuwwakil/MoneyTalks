import { Resend } from "resend";

export const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}) {
  const from = process.env.EMAIL_FROM;
  if (!from) throw new Error("EMAIL_FROM missing");
  if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY missing");

  return resend.emails.send({
    from,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  });
}
