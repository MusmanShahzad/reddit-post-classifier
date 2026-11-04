import { NextResponse } from "next/server";
import { db } from "~/server/db";
import { runCollection } from "~/server/services/collector";

export const dynamic = "force-dynamic";

export async function POST() {
  const settings = await db.appSettings.findUnique({
    where: { id: "default" },
  });

  if (!settings?.activeCompanyId) {
    return NextResponse.json(
      { error: "No company configured. Complete onboarding first." },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of runCollection(db, settings.activeCompanyId!)) {
          const data = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(data));
        }
      } catch (error) {
        const errorEvent = `data: ${JSON.stringify({
          type: "error",
          error: error instanceof Error ? error.message : "Unknown error",
          message: "Collection failed",
        })}\n\n`;
        controller.enqueue(encoder.encode(errorEvent));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export async function GET() {
  return NextResponse.json({ message: "Use POST to trigger collection" });
}
