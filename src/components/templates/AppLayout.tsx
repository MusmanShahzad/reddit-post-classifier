import { useState } from "react";
import { Menu } from "lucide-react";
import { Logo, ThemeToggle } from "@/components/atoms";

/**
 * Main app layout: a sidebar with navigation and an optional extra section
 * (the session list), and a content area. On small screens the sidebar
 * opens from a menu button.
 *
 * @param tabs        - Navigation items (`{ id, label, icon }`).
 * @param activeTab   - The selected item.
 * @param onTabChange - Fires with the chosen item ID.
 * @param title       - Shown in the small-screen top bar (the current session).
 * @param sidebar     - Extra sidebar content under the navigation.
 * @param children    - Page content.
 *
 * @example
 * ```tsx
 * <AppLayout tabs={tabs} activeTab={tab} onTabChange={setTab} sidebar={<SessionSwitcher ... />}>
 *   <Dashboard />
 * </AppLayout>
 * ```
 */
export interface TabDefinition {
  id: string;
  label: string;
  icon?: React.ReactNode;
  /** A count shown beside the label. Hidden at zero. */
  badge?: number;
}

export interface AppLayoutProps {
  tabs: TabDefinition[];
  activeTab: string;
  onTabChange: (id: string) => void;
  title?: string;
  sidebar?: React.ReactNode;
  children: React.ReactNode;
}

const DRAWER_ID = "radarr-sidebar";

export function AppLayout({ tabs, activeTab, onTabChange, title, sidebar, children }: AppLayoutProps) {
  const [open, setOpen] = useState(false);
  const unseen = tabs.reduce((total, tab) => total + (tab.badge ?? 0), 0);

  return (
    <div className="drawer lg:drawer-open min-h-screen bg-base-200">
      <input
        id={DRAWER_ID}
        type="checkbox"
        className="drawer-toggle"
        checked={open}
        onChange={(event) => setOpen(event.target.checked)}
      />

      <div className="drawer-content flex min-w-0 flex-col">
        <div className="navbar sticky top-0 z-30 bg-base-100 shadow-sm lg:hidden">
          <label htmlFor={DRAWER_ID} aria-label="Open sidebar" className="btn btn-square btn-ghost drawer-button">
            <Menu className="size-5" aria-hidden />
          </label>
          <span className="truncate px-2 font-semibold">{title ?? "Radarr"}</span>
          {unseen > 0 && <span className="badge badge-primary badge-sm ml-auto">{unseen} new</span>}
        </div>

        <main className="mx-auto w-full max-w-6xl p-4 sm:p-6">
          <div key={activeTab} className="animate-rise-in">
            {children}
          </div>
        </main>
      </div>

      <div className="drawer-side z-40">
        <label htmlFor={DRAWER_ID} aria-label="Close sidebar" className="drawer-overlay" />
        <aside className="flex min-h-full w-72 flex-col gap-2 border-r border-base-300 bg-base-100 p-3">
          <div className="flex items-center gap-3 px-2 py-3">
            <Logo size="sm" />
            <span className="flex-1 text-lg font-bold">Radarr</span>
            <ThemeToggle />
          </div>

          <ul className="menu w-full gap-1 p-0">
            {tabs.map((tab) => (
              <li key={tab.id}>
                <button
                  type="button"
                  className={`gap-3 transition-colors duration-200 ${activeTab === tab.id ? "menu-active" : ""}`}
                  aria-current={activeTab === tab.id ? "page" : undefined}
                  onClick={() => {
                    onTabChange(tab.id);
                    setOpen(false);
                  }}
                >
                  {tab.icon}
                  {tab.label}
                  {Boolean(tab.badge) && (
                    <span className="badge badge-primary badge-sm ml-auto" aria-label={`${tab.badge} new`}>
                      {tab.badge}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>

          {sidebar && (
            <>
              <div className="divider my-1" />
              <div className="min-h-0 flex-1">{sidebar}</div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
