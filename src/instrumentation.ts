import { registerOTel } from "@vercel/otel";

/**
 * Register one service identity for traces and metrics on every Next.js
 * instance. Exporters remain environment-configured, so local development does
 * not need an observability backend to boot.
 */
export function register() {
  registerOTel({ serviceName: process.env.OTEL_SERVICE_NAME || "in-unity" });
}
