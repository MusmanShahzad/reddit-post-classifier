import type { PostMentions as Mentions } from "@/lib/mentions";

/** The tracked names and Reddit users a post mentions. Renders nothing when there are none. */
export function PostMentions({ mentions }: { mentions?: Mentions | null }) {
  if (!mentions || (mentions.names.length === 0 && mentions.people.length === 0)) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-base-content/60">
      <span>Mentions</span>
      {mentions.names.map((name) => (
        <span
          key={name.value}
          className={`badge badge-sm ${name.type === "brand" ? "badge-primary badge-soft" : "badge-outline"}`}
        >
          {name.value}
        </span>
      ))}
      {mentions.people.map((person) => (
        <a
          key={person}
          href={`https://www.reddit.com/user/${encodeURIComponent(person)}`}
          target="_blank"
          rel="noreferrer"
          className="badge badge-ghost badge-sm"
        >
          u/{person}
        </a>
      ))}
    </div>
  );
}
