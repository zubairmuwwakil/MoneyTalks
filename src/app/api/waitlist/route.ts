import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const emailSchema = z.object({ email: z.string().email() });

export const ipSubmissions = new Map<string, { count: number; windowStart: number }>();
const MAX_SUBMISSIONS_PER_IP = 5;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") || "unknown";
  
  if (ip !== "unknown") {
    const now = Date.now();
    const record = ipSubmissions.get(ip) || { count: 0, windowStart: now };
    if (now - record.windowStart > WINDOW_MS) {
      record.count = 0;
      record.windowStart = now;
    }
    
    if (record.count >= MAX_SUBMISSIONS_PER_IP) {
      return NextResponse.json({ error: "Too many submissions" }, { status: 429 });
    }
    record.count++;
    ipSubmissions.set(ip, record);
  }

  try {
    const body = await req.json();
    const parsed = emailSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    const { email } = parsed.data;

    const existing = await prisma.waitlist.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ success: true, message: "Already on waitlist" });
    }

    await prisma.waitlist.create({ data: { email } });
    
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Waitlist error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
