import { cn } from "cn";

/**
 * Base skeleton primitive — an animated shimmer placeholder.
 *
 * Uses a subtle pulse animation with a gradient shimmer effect.
 */
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "skeleton",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
