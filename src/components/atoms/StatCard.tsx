import { AnimatedNumber } from "./AnimatedValue";

/**
 * A compact stat card displaying a label, numeric value, and optional icon.
 *
 * Used in the Dashboard stats grid to show aggregate post counts.
 *
 * @param label - Short description (e.g. "Total Posts").
 * @param value - The numeric value to display.
 * @param icon  - Icon shown before the label.
 * @param color - Tailwind text colour class for the value (defaults to `text-gray-900`).
 *
 * @example
 * ```tsx
 * <StatCard label="Relevant" value={42} icon="✅" color="text-green-600" />
 * ```
 */
export interface StatCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  color?: string;
}

export function StatCard({ label, value, icon }: StatCardProps) {
  return (
    <div className="stats w-full bg-base-100 shadow-sm">
      <div className="stat">
        <div className="stat-title flex items-center gap-1.5">
          {icon}
          <span>{label}</span>
        </div>
        <div className="stat-value text-2xl">
          <AnimatedNumber value={value} />
        </div>
      </div>
    </div>
  );
}
