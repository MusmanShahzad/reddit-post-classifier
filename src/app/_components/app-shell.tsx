"use client";

import { useState } from "react";
import { Dashboard } from "./dashboard";
import { Feed } from "./feed";
import { Settings } from "./settings";

type Tab = "dashboard" | "feed" | "settings";

export function AppShell() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");

  return (
    <div className="min-h-screen">
      {/* Top nav */}
      <header className="sticky top-0 z-50 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500 text-sm font-bold text-white">
              R
            </div>
            <h1 className="text-lg font-bold text-gray-900">Radarr</h1>
          </div>

          <nav className="flex gap-1">
            {(
              [
                { id: "dashboard", label: "📊 Dashboard" },
                { id: "feed", label: "📰 Feed" },
                { id: "settings", label: "⚙️ Settings" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? "bg-red-50 text-red-600"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-7xl p-4">
        {activeTab === "dashboard" && <Dashboard />}
        {activeTab === "feed" && <Feed />}
        {activeTab === "settings" && <Settings />}
      </main>
    </div>
  );
}
