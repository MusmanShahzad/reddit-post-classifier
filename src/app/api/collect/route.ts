import { NextResponse } from "next/server";
import { isSameSiteRequest } from "@/lib/request-guard";
import { db } from "@/server/db";
import { enqueueCollection } from "@/server/services/collection-runs";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // A run spends paid credits, so a page on another site must not be able to start one.
  if (!isSameSiteRequest(request.headers)) {
    return NextResponse.json({ error: "Cross-site requests are not allowed." }, { status: 403 });
  }

  try {
    const settings = await db.appSettings.findUnique({
      where: { id: "default" },
    });

    if (!settings?.activeCompanyId) {
      return NextResponse.json(
        { error: "No company configured. Complete onboarding first." },
        { status: 400 },
      );
    }

    const result = await enqueueCollection(db, settings.activeCompanyId);

    return NextResponse.json(
      {
        runId: result.runId,
        queued: result.queued,
      },
      { status: 202 },
    );
  } catch (error) {
    console.error(
      "[collect] could not start a run:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return NextResponse.json({ error: "Could not start the collection." }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ message: "Use POST to trigger collection" });
}
