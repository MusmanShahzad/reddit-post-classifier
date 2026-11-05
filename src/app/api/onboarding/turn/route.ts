import { NextResponse } from "next/server";
import { isSameSiteRequest } from "@/lib/request-guard";
import { db } from "@/server/db";
import { answerTurn, logTurn, TurnInputSchema, type TurnEvent } from "@/server/services/onboarding-turn";

export const dynamic = "force-dynamic";

/**
 * Streams one onboarding turn as newline-separated JSON events: each step
 * as it starts and ends, what the assistant is doing, the reply as GPT-4o
 * writes it, and the final result.
 */
export async function POST(request: Request) {
  // Each turn calls paid models, so another site must not be able to trigger one.
  if (!isSameSiteRequest(request.headers)) {
    return NextResponse.json({ error: "Cross-site requests are not allowed." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send the message as JSON." }, { status: 400 });
  }
  const parsed = TurnInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid message." }, { status: 400 });
  }
  const input = parsed.data;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const activity: string[] = [];
      const send = (event: TurnEvent) => {
        if (event.type === "activity") activity.push(event.text);
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The browser left. The turn still finishes so it is logged.
          open = false;
        }
      };

      try {
        const result = await answerTurn(input, send);
        await logTurn(db, input, result, activity);
        send({ type: "done", result });
      } catch (error) {
        console.error("[onboarding] turn failed:", error instanceof Error ? error.message : "Unknown");
        send({ type: "error", message: "Sorry, something went wrong. Could you try that again?" });
      } finally {
        if (open) controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
