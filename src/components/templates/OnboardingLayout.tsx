import { Logo } from "@/components/atoms";

/**
 * Layout for setting up a session: a narrow column with a header, and the
 * setup content below it.
 *
 * @param children - The progress panel and the config review card.
 * @param embedded - Inside the app shell as a new session.
 * @param actions  - Shown at the top right, for example a cancel button.
 *
 * @example
 * ```tsx
 * <OnboardingLayout actions={<button>Cancel</button>}>
 *   <ConfigReviewCard ... />
 * </OnboardingLayout>
 * ```
 */
export interface OnboardingLayoutProps {
  children: React.ReactNode;
  embedded?: boolean;
  actions?: React.ReactNode;
}

export function OnboardingLayout({ children, embedded = false, actions }: OnboardingLayoutProps) {
  return (
    <div
      className={`mx-auto flex w-full max-w-3xl flex-col ${embedded ? "min-h-[calc(100dvh-3rem)]" : "min-h-dvh px-4 sm:px-6"}`}
    >
      <header className={`flex items-center gap-3 pb-6 ${embedded ? "" : "pt-8"}`}>
        <Logo size="md" />
        <div className="flex-1">
          <h1 className="text-xl font-bold">{embedded ? "New session" : "Set up Radarr"}</h1>
          <p className="text-sm text-base-content/60">
            {embedded ? "A separate brief, searches, and feed" : "Tell me what to find on Reddit"}
          </p>
        </div>
        {actions}
      </header>

      <div className="flex flex-1 flex-col pb-8">{children}</div>
    </div>
  );
}
