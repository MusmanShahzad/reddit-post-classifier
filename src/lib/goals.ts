/**
 * What a session is looking for. The goal decides which searches run and what
 * makes a post relevant, so "reviews of our product" and "potential clients"
 * are not judged the same way.
 */

export const GOALS = ["own_feedback", "competitor_feedback", "potential_clients"] as const;
export type Goal = (typeof GOALS)[number];

/** Reads stored goals. A session with none, or a damaged value, looks for everything. */
export function parseGoals(stored: string | null | undefined): Goal[] {
  try {
    const parsed: unknown = JSON.parse(stored ?? "[]");
    if (Array.isArray(parsed)) {
      const goals = GOALS.filter((goal) => parsed.includes(goal));
      if (goals.length > 0) return goals;
    }
  } catch {
    // Falls through to every goal.
  }
  return [...GOALS];
}
