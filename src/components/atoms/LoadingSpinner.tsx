/**
 * An animated spinner used as a loading indicator throughout the app.
 *
 * @param size - Diameter: `"sm"` (16px), `"md"` (24px — default), `"lg"` (32px).
 *
 * @example
 * ```tsx
 * <LoadingSpinner />
 * <LoadingSpinner size="lg" />
 * ```
 */
export interface LoadingSpinnerProps {
  size?: "sm" | "md" | "lg";
}

const sizeMap = {
  sm: "h-4 w-4",
  md: "h-6 w-6",
  lg: "h-8 w-8",
} as const;

export function LoadingSpinner({ size = "md" }: LoadingSpinnerProps) {
  return (
    <div
      className={`animate-spin rounded-full border-2 border-red-500 border-t-transparent ${sizeMap[size]}`}
      role="status"
      aria-label="Loading"
    />
  );
}
