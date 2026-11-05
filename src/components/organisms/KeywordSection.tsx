import { useState } from "react";
import { RemovableTag } from "@/components/atoms";
import { TagList } from "@/components/molecules";
import { AddItemInput } from "@/components/molecules";
import { aliasList } from "@/lib/post-tags";

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
 * @param onChangeAliases - Called with keyword ID and its full new list of other names.
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
  onChangeAliases?: (id: string, aliases: string[]) => void;
}

/** The other names people use for one brand or competitor, each searched as well. */
function AliasEditor({
  keyword,
  onChange,
}: {
  keyword: KeywordData;
  onChange: (id: string, aliases: string[]) => void;
}) {
  const aliases = aliasList(keyword.aliases);
  return (
    <div className="flex flex-col gap-1.5" data-testid={`aliases-${keyword.value}`}>
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="font-medium">{keyword.value}</span>
        {aliases.length === 0 && <span className="text-xs text-base-content/60">No other names yet</span>}
        {aliases.map((alias) => (
          <RemovableTag
            key={alias}
            label={alias}
            variant="outline"
            onRemove={() => onChange(keyword.id, aliases.filter((name) => name !== alias))}
          />
        ))}
      </div>
      <AddItemInput
        placeholder={`Add another name for ${keyword.value}`}
        onAdd={(name) => {
          const known = [keyword.value, ...aliases].some((item) => item.toLowerCase() === name.toLowerCase());
          if (!known) onChange(keyword.id, [...aliases, name]);
        }}
      />
    </div>
  );
}

export function KeywordSection({
  brands,
  competitors,
  topics,
  onDeleteKeyword,
  onAddKeyword,
  onChangeAliases,
}: KeywordSectionProps) {
  const named = [...brands, ...competitors];
  return (
    <div className="card card-border bg-base-100">
      <div className="card-body">
      <h3 className="card-title text-base">Brand keywords</h3>
      <TagList
        tags={brands.map((kw) => ({
          label: kw.value,
          sublabel: aliasList(kw.aliases).length > 0 ? `(${aliasList(kw.aliases).join(", ")})` : undefined,
          onRemove: () => onDeleteKeyword(kw.id),
        }))}
      />

      <div className="divider" />

      <h3 className="card-title text-base">Competitors</h3>
      <TagList
        tags={competitors.map((kw) => ({
          label: kw.value,
          sublabel: aliasList(kw.aliases).length > 0 ? `(${aliasList(kw.aliases).join(", ")})` : undefined,
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

      {onChangeAliases && named.length > 0 && (
        <>
          <div className="divider" />
          <h3 className="card-title text-base">Other names</h3>
          <p className="text-sm text-base-content/70">
            Spellings and short names people use, such as &quot;QBO&quot; for QuickBooks Online. Changing them updates the
            searches and how posts are judged. Two-letter names are too ambiguous to search, so they are only used when judging a post.
          </p>
          <div className="flex flex-col gap-4">
            {named.map((keyword) => (
              <AliasEditor key={keyword.id} keyword={keyword} onChange={onChangeAliases} />
            ))}
          </div>
        </>
      )}
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
