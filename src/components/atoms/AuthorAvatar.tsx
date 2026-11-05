import { useState } from "react";

export interface AuthorAvatarProps {
  username: string;
  iconUrl?: string | null;
  /** `sm` for feed cards, `lg` for an opened post. */
  size?: "sm" | "lg";
}

const SIZES = { sm: "size-7 text-xs", lg: "size-12 text-base" };

/**
 * A Reddit user's picture. Shows their first letter when there is no picture
 * yet or it does not load.
 *
 * It is a plain `img` because pictures come from several Reddit hosts, and the
 * referrer is dropped so opening the feed does not tell Reddit about this app.
 */
export function AuthorAvatar({ username, iconUrl, size = "sm" }: AuthorAvatarProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = Boolean(iconUrl) && failedUrl !== iconUrl;
  const classes = `${SIZES[size]} shrink-0 rounded-full`;

  if (showImage) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={iconUrl!}
        alt=""
        referrerPolicy="no-referrer"
        className={`${classes} bg-base-200 object-cover`}
        onError={() => setFailedUrl(iconUrl!)}
      />
    );
  }

  const letter = username.replace(/^\[|\]$/g, "").charAt(0).toUpperCase() || "?";
  return (
    <span aria-hidden className={`${classes} inline-flex items-center justify-center bg-base-300 font-medium`}>
      {letter}
    </span>
  );
}
