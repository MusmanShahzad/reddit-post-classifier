import { RemovableTag, type RemovableTagProps } from "@/components/atoms";

/**
 * A horizontal list of removable tags.
 *
 * Wraps multiple `RemovableTag` atoms in a flex container. Used in Settings
 * to display brand keywords, competitors, topics, and subreddits.
 *
 * @param tags - Array of tag props (label, sublabel, variant, onRemove).
 *
 * @example
 * ```tsx
 * <TagList tags={[
 *   { label: "Acme", sublabel: "(acme)", onRemove: () => del(1) },
 *   { label: "DataBox", variant: "secondary", onRemove: () => del(2) },
 * ]} />
 * ```
 */
export interface TagListProps {
  tags: RemovableTagProps[];
}

export function TagList({ tags }: TagListProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((tag, i) => (
        <RemovableTag key={i} {...tag} />
      ))}
    </div>
  );
}
