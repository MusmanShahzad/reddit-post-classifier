"use client";

import { useEffect } from "react";
import { CircleAlert, RotateCcw } from "lucide-react";

/** Shown instead of a blank page when a screen fails to render. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="card card-border w-full max-w-md bg-base-100">
        <div className="card-body items-center gap-3 text-center">
          <CircleAlert className="size-8 text-error" aria-hidden />
          <h1 className="card-title">Something went wrong</h1>
          <p className="text-sm text-base-content/70">
            This screen could not load. Your posts and settings are safe, and collection keeps running in the background.
          </p>
          <button type="button" className="btn btn-primary" onClick={reset}>
            <RotateCcw className="size-4" aria-hidden />
            Try again
          </button>
        </div>
      </div>
    </main>
  );
}
