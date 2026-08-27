import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/require-user";
import { z } from "zod";

const requestSchema = z.object({
  issuer: z.string().min(1),
  cardName: z.string().min(1),
  note: z.string().optional(),
});

export async function POST(req: NextRequest) {
  let userId;
  try {
    // We expect the request to be authenticated by Clerk, and requireUserId 
    // redirects to login, but since this is an API route, if it redirects,
    // we should probably just return 401. Let's get the user ID without redirecting.
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data" }, { status: 400 });
    }

    const { issuer, cardName, note } = parsed.data;

    const existing = await prisma.cardRequest.findFirst({
      where: { userId, issuer, cardName }
    });

    if (existing) {
      return NextResponse.json({ success: true, message: "Already requested" });
    }

    await prisma.cardRequest.create({
      data: { userId, issuer, cardName, note },
    });
    
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("CardRequest error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
