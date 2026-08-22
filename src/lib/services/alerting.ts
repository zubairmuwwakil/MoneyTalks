import * as Sentry from "@sentry/nextjs";
import { resend } from "./email";

export interface ServiceFailureAlertOptions {
  serviceName: string;
  summary: string;
  error?: unknown;
  details?: Record<string, unknown>;
}

function resolveRecipient(): string | null {
  const custom = process.env.ADMIN_ALERT_EMAIL?.trim();
  if (custom) return custom;

  const allowed = process.env.ALLOWED_EMAILS?.split(",")[0]?.trim();
  if (allowed) return allowed;

  const admin = process.env.ADMIN_EMAIL?.trim();
  if (admin) return admin;

  return null;
}

function formatError(error: unknown): string {
  if (!error) return "No error object provided";
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\n${error.stack ?? ""}`.trim();
  }
  return String(error);
}

function renderHtmlBody(opts: ServiceFailureAlertOptions, timestamp: string): string {
  const detailsHtml = opts.details
    ? `<div style="margin: 16px 0; padding: 12px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px;">
        <h3 style="margin: 0 0 8px 0; font-size: 13px; text-transform: uppercase; color: #64748b; font-family: monospace;">Details</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 13px; font-family: monospace;">
          ${Object.entries(opts.details)
            .map(
              ([k, v]) =>
                `<tr>
                  <td style="padding: 4px 8px 4px 0; color: #475569; font-weight: bold; width: 140px; vertical-align: top;">${k}:</td>
                  <td style="padding: 4px 0; color: #0f172a; word-break: break-all;">${typeof v === "object" ? JSON.stringify(v) : String(v)}</td>
                </tr>`,
            )
            .join("")}
        </table>
      </div>`
    : "";

  const errorHtml = opts.error
    ? `<div style="margin: 16px 0;">
        <h3 style="margin: 0 0 8px 0; font-size: 13px; text-transform: uppercase; color: #dc2626; font-family: monospace;">Error Stack / Message</h3>
        <pre style="margin: 0; padding: 12px; background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; color: #991b1b; font-size: 12px; line-height: 1.5; overflow-x: auto; white-space: pre-wrap;">${formatError(
          opts.error,
        )}</pre>
      </div>`
    : "";

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px;">
      <div style="display: flex; align-items: center; border-bottom: 2px solid #ef4444; padding-bottom: 12px; margin-bottom: 16px;">
        <span style="font-size: 20px; font-weight: bold; color: #b91c1c;">⚠️ Service Failure Alert</span>
      </div>
      
      <p style="font-size: 15px; margin: 0 0 12px 0;">
        <strong>Service:</strong> <code style="background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 14px;">${opts.serviceName}</code>
      </p>
      
      <p style="font-size: 14px; margin: 0 0 16px 0; line-height: 1.5; color: #334155;">
        ${opts.summary}
      </p>

      ${detailsHtml}
      ${errorHtml}

      <div style="margin-top: 24px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8;">
        Timestamp: ${timestamp} UTC · MoneyTalks Diagnostic Monitor
      </div>
    </div>
  `.trim();
}

function renderTextBody(opts: ServiceFailureAlertOptions, timestamp: string): string {
  const lines = [
    `SERVICE FAILURE ALERT: [${opts.serviceName}]`,
    `Timestamp: ${timestamp} UTC`,
    `Summary: ${opts.summary}`,
    "",
  ];

  if (opts.details) {
    lines.push("DETAILS:");
    for (const [k, v] of Object.entries(opts.details)) {
      lines.push(`- ${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
    }
    lines.push("");
  }

  if (opts.error) {
    lines.push("ERROR:");
    lines.push(formatError(opts.error));
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Sends a service failure alert via Sentry and email (via Resend).
 * This function fails safely and will never throw or crash the caller.
 */
export async function sendServiceFailureAlert(opts: ServiceFailureAlertOptions): Promise<void> {
  const timestamp = new Date().toISOString();

  // 1. Log to server console
  console.error(`[alerting] [${opts.serviceName}] Failure: ${opts.summary}`, {
    details: opts.details,
    error: opts.error,
  });

  // 2. Report to Sentry
  try {
    if (opts.error) {
      Sentry.captureException(opts.error, {
        tags: { service: opts.serviceName },
        extra: { summary: opts.summary, ...opts.details },
      });
    } else {
      Sentry.captureMessage(`[${opts.serviceName}] ${opts.summary}`, {
        level: "error",
        tags: { service: opts.serviceName },
        extra: opts.details,
      });
    }
  } catch (sentryError) {
    console.warn("[alerting] Sentry capture failed:", sentryError);
  }

  // 3. Send email via Resend
  const recipient = resolveRecipient();
  const rawFrom = process.env.EMAIL_FROM || process.env.AUTH_EMAIL_FROM;
  const apiKey = process.env.RESEND_API_KEY || process.env.AUTH_RESEND_KEY;

  if (!recipient || !rawFrom || !apiKey) {
    console.warn(
      `[alerting] Email alert skipped for ${opts.serviceName}: missing ${[
        !recipient && "ADMIN_ALERT_EMAIL/ALLOWED_EMAILS",
        !rawFrom && "EMAIL_FROM/AUTH_EMAIL_FROM",
        !apiKey && "RESEND_API_KEY/AUTH_RESEND_KEY",
      ]
        .filter(Boolean)
        .join(", ")}`,
    );
    return;
  }

  try {
    const from = rawFrom.includes("<") ? rawFrom : `MoneyTalks Alerts <${rawFrom}>`;
    await resend.emails.send({
      from,
      to: recipient,
      subject: `⚠️ Service Alert: [${opts.serviceName}] ${opts.summary}`,
      html: renderHtmlBody(opts, timestamp),
      text: renderTextBody(opts, timestamp),
    });
  } catch (emailError) {
    console.warn(`[alerting] Failed to send email alert for ${opts.serviceName}:`, emailError);
  }
}
