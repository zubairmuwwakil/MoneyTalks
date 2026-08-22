import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { resend } from "./email";
import { sendServiceFailureAlert } from "./alerting";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock("./email", () => ({
  resend: {
    emails: {
      send: vi.fn(),
    },
  },
}));

describe("sendServiceFailureAlert", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      ADMIN_ALERT_EMAIL: "admin@example.com",
      EMAIL_FROM: "alerts@example.com",
      RESEND_API_KEY: "re_test_key",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("captures Sentry exception and sends email on Error failure", async () => {
    const error = new Error("Database connection timed out");
    await sendServiceFailureAlert({
      serviceName: "cron/prices",
      summary: "Snapshot capture failed",
      error,
      details: { users: 5, failed: 2 },
    });

    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      tags: { service: "cron/prices" },
      extra: { summary: "Snapshot capture failed", users: 5, failed: 2 },
    });

    expect(resend.emails.send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "MoneyTalks Alerts <alerts@example.com>",
        to: "admin@example.com",
        subject: "⚠️ Service Alert: [cron/prices] Snapshot capture failed",
        html: expect.stringContaining("Snapshot capture failed"),
        text: expect.stringContaining("Database connection timed out"),
      }),
    );
  });

  it("captures Sentry message when no Error object is provided", async () => {
    await sendServiceFailureAlert({
      serviceName: "cron/fx",
      summary: "Bank of Canada returned zero rates",
      details: { currencies: ["USD", "EUR"] },
    });

    expect(Sentry.captureMessage).toHaveBeenCalledWith("[cron/fx] Bank of Canada returned zero rates", {
      level: "error",
      tags: { service: "cron/fx" },
      extra: { currencies: ["USD", "EUR"] },
    });

    expect(resend.emails.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "admin@example.com",
        subject: "⚠️ Service Alert: [cron/fx] Bank of Canada returned zero rates",
      }),
    );
  });

  it("falls back to ALLOWED_EMAILS when ADMIN_ALERT_EMAIL is not set", async () => {
    delete process.env.ADMIN_ALERT_EMAIL;
    process.env.ALLOWED_EMAILS = "owner@example.com, second@example.com";

    await sendServiceFailureAlert({
      serviceName: "cron/digest",
      summary: "Digest build failed",
    });

    expect(resend.emails.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "owner@example.com",
      }),
    );
  });

  it("fails safely without throwing when email credentials are missing", async () => {
    delete process.env.ADMIN_ALERT_EMAIL;
    delete process.env.ALLOWED_EMAILS;
    delete process.env.RESEND_API_KEY;

    await expect(
      sendServiceFailureAlert({
        serviceName: "cron/notify",
        summary: "Notification sweep failed",
      }),
    ).resolves.not.toThrow();

    expect(resend.emails.send).not.toHaveBeenCalled();
  });

  it("fails safely without throwing when Resend throws an error", async () => {
    vi.mocked(resend.emails.send).mockRejectedValueOnce(new Error("Resend rate limit exceeded"));

    await expect(
      sendServiceFailureAlert({
        serviceName: "cron/prices",
        summary: "Service down",
      }),
    ).resolves.not.toThrow();
  });
});
