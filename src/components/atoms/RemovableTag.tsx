import { X } from "lucide-react";

/**
 * A badge with a small "×" remove button.
 *
 * Used in Settings to display keywords, subreddits, and other removable items.
 *
 * @param label       - The visible text inside the badge.
 * @param sublabel    - Optional secondary text shown in reduced opacity.
 * @param variant     - Badge style (defaults to `"default"`).
 * @param onRemove    - Called when the "×" button is clicked.
 *
 * @example
 * ```tsx
 * <RemovableTag label="Acme" sublabel="(acme, ACME)" onRemove={() => del(id)} />
 * ```
 */
export interface RemovableTagProps {
  label: string;
  sublabel?: string;
  variant?: "default" | "secondary" | "destructive" | "outline" | "ghost" | "link";
  onRemove: () => void;
}

export function RemovableTag({
  label,
  sublabel,
  variant = "default",
  onRemove,
}: RemovableTagProps) {
  return (
    <div className="flex items-center gap-1">
      <span className={`badge ${variant === "outline" ? "badge-outline" : "badge-ghost"}`}>
        {label}
        {sublabel && <span className="ml-1 opacity-70">{sublabel}</span>}
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="btn btn-ghost btn-xs"
        aria-label={`Remove ${label}`}
      >
        <X className="size-3" aria-hidden />
      </button>
    </div>
  );
}
