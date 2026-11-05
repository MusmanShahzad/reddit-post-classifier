/**
 * Radarr brand logo component.
 *
 * Renders the "R" circle mark used throughout the app header and onboarding screen.
 *
 * @param size - Diameter variant: `"sm"` (32px), `"md"` (40px — default), or `"lg"` (48px).
 *
 * @example
 * ```tsx
 * <Logo />
 * <Logo size="lg" />
 * ```
 */
export interface LogoProps {
  /** Diameter variant. */
  size?: "sm" | "md" | "lg";
}

const sizeMap = {
  sm: "h-8 w-8 text-sm",
  md: "h-10 w-10 text-lg",
  lg: "h-12 w-12 text-xl",
} as const;

export function Logo({ size = "md" }: LogoProps) {
  return (
    <div
      className={`flex items-center justify-center rounded-full bg-neutral font-bold text-neutral-content ${sizeMap[size]}`}
      aria-label="Radarr logo"
    >
      R
    </div>
  );
}
