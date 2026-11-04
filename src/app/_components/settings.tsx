"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import { Card } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";

export function Settings() {
  const { data: company, refetch } = api.settings.getCompany.useQuery();
  const addKeyword = api.settings.addKeyword.useMutation({ onSuccess: () => void refetch() });
  const deleteKeyword = api.settings.deleteKeyword.useMutation({ onSuccess: () => void refetch() });
  const addSubreddit = api.settings.addSubreddit.useMutation({ onSuccess: () => void refetch() });
  const removeSubreddit = api.settings.removeSubreddit.useMutation({ onSuccess: () => void refetch() });
  const addCustomQuery = api.settings.addCustomQuery.useMutation({ onSuccess: () => void refetch() });
  const deleteQuery = api.settings.deleteSearchQuery.useMutation({ onSuccess: () => void refetch() });

  const [newKeyword, setNewKeyword] = useState({ type: "brand" as string, value: "" });
  const [newSubreddit, setNewSubreddit] = useState("");
  const [newQuery, setNewQuery] = useState("");

  if (!company) {
    return (
      <div className="py-12 text-center text-gray-500">
        No company configured. Complete onboarding first.
      </div>
    );
  }

  const brands = company.keywords.filter((k) => k.type === "brand");
  const competitors = company.keywords.filter((k) => k.type === "competitor");
  const topics = company.keywords.filter((k) => k.type === "topic");

  return (
    <div className="space-y-6 py-4">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Settings</h2>
        <p className="text-sm text-gray-500">
          Manage your monitoring configuration for{" "}
          <span className="font-semibold">{company.name}</span>
        </p>
      </div>

      {/* Keywords */}
      <Card className="p-5">
        <h3 className="mb-4 text-sm font-semibold text-gray-900">
          🏷️ Brand Keywords
        </h3>
        <div className="mb-3 flex flex-wrap gap-2">
          {brands.map((kw) => (
            <div key={kw.id} className="flex items-center gap-1">
              <Badge variant="default">
                {kw.value}
                {JSON.parse(kw.aliases).length > 0 && (
                  <span className="ml-1 opacity-70">
                    ({(JSON.parse(kw.aliases) as string[]).join(", ")})
                  </span>
                )}
              </Badge>
              <button
                onClick={() => deleteKeyword.mutate({ id: kw.id })}
                className="text-xs text-red-400 hover:text-red-600"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <Separator className="my-4" />

        <h3 className="mb-4 text-sm font-semibold text-gray-900">
          ⚔️ Competitors
        </h3>
        <div className="mb-3 flex flex-wrap gap-2">
          {competitors.map((kw) => (
            <div key={kw.id} className="flex items-center gap-1">
              <Badge variant="secondary">{kw.value}</Badge>
              <button
                onClick={() => deleteKeyword.mutate({ id: kw.id })}
                className="text-xs text-red-400 hover:text-red-600"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <Separator className="my-4" />

        <h3 className="mb-4 text-sm font-semibold text-gray-900">
          🔍 Topics
        </h3>
        <div className="mb-3 flex flex-wrap gap-2">
          {topics.map((kw) => (
            <div key={kw.id} className="flex items-center gap-1">
              <Badge variant="outline">{kw.value}</Badge>
              <button
                onClick={() => deleteKeyword.mutate({ id: kw.id })}
                className="text-xs text-red-400 hover:text-red-600"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <Separator className="my-4" />

        {/* Add keyword */}
        <div className="flex gap-2">
          <select
            value={newKeyword.type}
            onChange={(e) =>
              setNewKeyword((p) => ({ ...p, type: e.target.value }))
            }
            className="rounded-md border px-3 py-2 text-sm"
          >
            <option value="brand">Brand</option>
            <option value="competitor">Competitor</option>
            <option value="topic">Topic</option>
          </select>
          <Input
            value={newKeyword.value}
            onChange={(e) =>
              setNewKeyword((p) => ({ ...p, value: e.target.value }))
            }
            placeholder="Add keyword..."
            className="flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter" && newKeyword.value.trim()) {
                addKeyword.mutate({
                  companyId: company.id,
                  type: newKeyword.type as "brand" | "competitor" | "topic",
                  value: newKeyword.value.trim(),
                });
                setNewKeyword((p) => ({ ...p, value: "" }));
              }
            }}
          />
          <Button
            size="sm"
            onClick={() => {
              if (newKeyword.value.trim()) {
                addKeyword.mutate({
                  companyId: company.id,
                  type: newKeyword.type as "brand" | "competitor" | "topic",
                  value: newKeyword.value.trim(),
                });
                setNewKeyword((p) => ({ ...p, value: "" }));
              }
            }}
            disabled={!newKeyword.value.trim()}
          >
            Add
          </Button>
        </div>
      </Card>

      {/* Subreddits */}
      <Card className="p-5">
        <h3 className="mb-4 text-sm font-semibold text-gray-900">
          📍 Subreddits
        </h3>
        <div className="mb-3 flex flex-wrap gap-2">
          {company.subreddits.map((sub) => (
            <div key={sub.id} className="flex items-center gap-1">
              <Badge variant="outline">r/{sub.name}</Badge>
              <button
                onClick={() => removeSubreddit.mutate({ id: sub.id })}
                className="text-xs text-red-400 hover:text-red-600"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            value={newSubreddit}
            onChange={(e) => setNewSubreddit(e.target.value)}
            placeholder="Add subreddit..."
            onKeyDown={(e) => {
              if (e.key === "Enter" && newSubreddit.trim()) {
                addSubreddit.mutate({
                  companyId: company.id,
                  name: newSubreddit.trim().replace(/^r\//, ""),
                });
                setNewSubreddit("");
              }
            }}
          />
          <Button
            size="sm"
            onClick={() => {
              if (newSubreddit.trim()) {
                addSubreddit.mutate({
                  companyId: company.id,
                  name: newSubreddit.trim().replace(/^r\//, ""),
                });
                setNewSubreddit("");
              }
            }}
            disabled={!newSubreddit.trim()}
          >
            Add
          </Button>
        </div>
      </Card>

      {/* Search queries */}
      <Card className="p-5">
        <h3 className="mb-4 text-sm font-semibold text-gray-900">
          🔎 Search Queries
        </h3>
        <div className="mb-3 space-y-1">
          {company.searchQueries.map((sq) => (
            <div
              key={sq.id}
              className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-2">
                <code className="text-gray-700">{sq.query}</code>
                {sq.isCustom && (
                  <Badge variant="outline" className="text-xs">
                    custom
                  </Badge>
                )}
              </div>
              {sq.isCustom && (
                <button
                  onClick={() => deleteQuery.mutate({ id: sq.id })}
                  className="text-xs text-red-400 hover:text-red-600"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>

        <Label className="mb-2 block text-xs text-gray-500">
          Auto-generated queries update when you change keywords. Custom queries
          are preserved.
        </Label>

        <div className="flex gap-2">
          <Input
            value={newQuery}
            onChange={(e) => setNewQuery(e.target.value)}
            placeholder="Add custom search query..."
            onKeyDown={(e) => {
              if (e.key === "Enter" && newQuery.trim()) {
                addCustomQuery.mutate({
                  companyId: company.id,
                  query: newQuery.trim(),
                });
                setNewQuery("");
              }
            }}
          />
          <Button
            size="sm"
            onClick={() => {
              if (newQuery.trim()) {
                addCustomQuery.mutate({
                  companyId: company.id,
                  query: newQuery.trim(),
                });
                setNewQuery("");
              }
            }}
            disabled={!newQuery.trim()}
          >
            Add
          </Button>
        </div>
      </Card>
    </div>
  );
}
