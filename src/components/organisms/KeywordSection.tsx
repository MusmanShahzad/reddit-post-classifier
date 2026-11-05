import { useState } from "react";
import { TagList } from "@/components/molecules";
import { AddItemInput } from "@/components/molecules";

/**
 * Settings section managing brand keywords, competitors, and topics.
 *
 * Displays three sub-sections separated by dividers, each with a list of
 * removable tags and a shared "add keyword" input at the bottom.
 *
 * @param brands       - Array of brand keyword objects.
 * @param competitors  - Array of competitor keyword objects.
 * @param topics       - Array of topic keyword objects.
 * @param onDeleteKeyword - Called with keyword ID to delete.
 * @param onAddKeyword    - Called with type and value to add.
 *
 * @example
 * ```tsx
 * <KeywordSection
 *   brands={brands}
 *   competitors={competitors}
 *   topics={topics}
 *   onDeleteKeyword={(id) => deleteKeyword.mutate({ id })}
 *   onAddKeyword={(type, value) => addKeyword.mutate({ companyId, type, value })}
 * />
 * ```
 */
export interface KeywordData {
  id: string;
  value: string;
  aliases: string;
}

export interface KeywordSectionProps {
  brands: KeywordData[];
  competitors: KeywordData[];
  topics: KeywordData[];
  onDeleteKeyword: (id: string) => void;
  onAddKeyword: (type: "brand" | "competitor" | "topic", value: string) => void;
}

export function KeywordSection({
  brands,
  competitors,
  topics,
  onDeleteKeyword,
  onAddKeyword,
}: KeywordSectionProps) {
  return (
    <div className="card card-border bg-base-100">
      <div className="card-body">
      <h3 className="card-title text-base">Brand keywords</h3>
      <TagList
        tags={brands.map((kw) => ({
          label: kw.value,
          sublabel:
            JSON.parse(kw.aliases).length > 0
              ? `(${(JSON.parse(kw.aliases) as string[]).join(", ")})`
              : undefined,
          onRemove: () => onDeleteKeyword(kw.id),
        }))}
      />

      <div className="divider" />

      <h3 className="card-title text-base">Competitors</h3>
      <TagList
        tags={competitors.map((kw) => ({
          label: kw.value,
          variant: "secondary" as const,
          onRemove: () => onDeleteKeyword(kw.id),
        }))}
      />

      <div className="divider" />

      <h3 className="card-title text-base">Topics</h3>
      <TagList
        tags={topics.map((kw) => ({
          label: kw.value,
          variant: "outline" as const,
          onRemove: () => onDeleteKeyword(kw.id),
        }))}
      />

      <div className="divider" />

      <KeywordAdder onAddKeyword={onAddKeyword} />
      </div>
    </div>
  );
}

function KeywordAdder({
  onAddKeyword,
}: {
  onAddKeyword: (type: "brand" | "competitor" | "topic", value: string) => void;
}) {
  const [type, setType] = useState<"brand" | "competitor" | "topic">("brand");

  return (
    <div className="flex gap-2">
      <select
        value={type}
        onChange={(e) =>
          setType(e.target.value as "brand" | "competitor" | "topic")
        }
        className="select"
      >
        <option value="brand">Brand</option>
        <option value="competitor">Competitor</option>
        <option value="topic">Topic</option>
      </select>
      <AddItemInput
        placeholder="Add keyword..."
        onAdd={(value) => onAddKeyword(type, value)}
      />
    </div>
  );
}
