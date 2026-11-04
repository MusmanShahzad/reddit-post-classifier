"use client";

import { useState, useRef, useEffect } from "react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { Card } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Input } from "~/components/ui/input";
import { ScrollArea } from "~/components/ui/scroll-area";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface Config {
  companyName: string;
  brandKeywords: Array<{ value: string; aliases: string[] }>;
  competitorKeywords: Array<{ value: string }>;
  topicKeywords: Array<{ value: string }>;
  focusAreas?: string[];
}

const WELCOME_MESSAGE: ChatMessage = {
  role: "assistant",
  content:
    "Hi! I'm Radarr 🔴 — your Reddit monitoring assistant.\n\nTell me about your business. What company or product do you want to track? Who are your competitors? What kind of conversations matter to you?\n\nJust describe it naturally — I'll extract everything we need.",
};

export function OnboardingChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [config, setConfig] = useState<Config | null>(null);
  const [phase, setPhase] = useState<string>("initial");
  const [subreddits, setSubreddits] = useState<
    Array<{ name: string; subscribers: number; selected: boolean }>
  >([]);
  const [customSubreddit, setCustomSubreddit] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const utils = api.useUtils();

  const processMessage = api.onboarding.processMessage.useMutation();
  const saveConfig = api.onboarding.saveConfig.useMutation();
  const suggestSubs = api.onboarding.suggestSubreddits.useMutation();

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || processMessage.isPending) return;

    const userMessage = input.trim();
    setInput("");

    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);

    try {
      const result = await processMessage.mutateAsync({
        message: userMessage,
        conversationHistory: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      });

      if (result.reply) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: result.reply! },
        ]);
      }

      if (result.config) {
        setConfig(result.config as Config);
      }

      setPhase(result.phase);

      if (
        (result.phase === "confirming" || result.phase === "complete") &&
        result.config
      ) {
        const topics = [
          ...(result.config as Config).topicKeywords.map((t) => t.value),
          (result.config as Config).companyName,
        ];
        const suggested = await suggestSubs.mutateAsync({ topics });
        setSubreddits(
          suggested.map((s) => ({
            name: s.name,
            subscribers: s.subscribers,
            selected: true,
          })),
        );
      }

      if (result.phase === "complete" && result.config) {
        await handleSaveAndStart(result.config as Config);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "Sorry, something went wrong. Could you try rephrasing that?",
        },
      ]);
    }
  };

  const handleSaveAndStart = async (cfg: Config) => {
    try {
      await saveConfig.mutateAsync({
        companyName: cfg.companyName,
        brandKeywords: cfg.brandKeywords,
        competitorKeywords: cfg.competitorKeywords,
        topicKeywords: cfg.topicKeywords,
        subreddits: subreddits.filter((s) => s.selected).map((s) => s.name),
      });

      await utils.onboarding.getStatus.invalidate();
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Failed to save config. Please try again.",
        },
      ]);
    }
  };

  const toggleSubreddit = (name: string) => {
    setSubreddits((prev) =>
      prev.map((s) => (s.name === name ? { ...s, selected: !s.selected } : s)),
    );
  };

  const addCustomSubreddit = () => {
    const name = customSubreddit.trim().replace(/^r\//, "");
    if (!name) return;
    if (subreddits.some((s) => s.name.toLowerCase() === name.toLowerCase()))
      return;
    setSubreddits((prev) => [
      ...prev,
      { name, subscribers: 0, selected: true },
    ]);
    setCustomSubreddit("");
  };

  const formatSubscribers = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
    return String(n);
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col p-4">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3 pt-8">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500 text-lg font-bold text-white">
          R
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Radarr Setup</h1>
          <p className="text-sm text-gray-500">Reddit Monitoring Tool</p>
        </div>
      </div>

      {/* Chat messages */}
      <ScrollArea className="flex-1">
        <div className="space-y-4 pb-4">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                  msg.role === "user"
                    ? "bg-red-500 text-white"
                    : "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200"
                }`}
              >
                <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
              </div>
            </div>
          ))}

          {processMessage.isPending && (
            <div className="flex justify-start">
              <div className="rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-gray-200">
                <div className="flex gap-1">
                  <div className="h-2 w-2 animate-bounce rounded-full bg-gray-400" />
                  <div
                    className="h-2 w-2 animate-bounce rounded-full bg-gray-400"
                    style={{ animationDelay: "0.15s" }}
                  />
                  <div
                    className="h-2 w-2 animate-bounce rounded-full bg-gray-400"
                    style={{ animationDelay: "0.3s" }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Config review card */}
          {config && phase === "confirming" && (
            <Card className="mx-4 p-4">
              <h3 className="mb-3 font-semibold text-gray-900">
                📋 Extracted Configuration
              </h3>

              <div className="space-y-3 text-sm">
                <div>
                  <span className="font-medium text-gray-600">Company:</span>{" "}
                  <span className="font-semibold">{config.companyName}</span>
                </div>

                <div>
                  <span className="font-medium text-gray-600">
                    Brand Keywords:
                  </span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {config.brandKeywords.map((b, i) => (
                      <Badge key={i} variant="default">
                        {b.value}
                        {b.aliases.length > 0 && (
                          <span className="ml-1 opacity-70">
                            ({b.aliases.join(", ")})
                          </span>
                        )}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="font-medium text-gray-600">
                    Competitors:
                  </span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {config.competitorKeywords.map((c, i) => (
                      <Badge key={i} variant="secondary">
                        {c.value}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="font-medium text-gray-600">Topics:</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {config.topicKeywords.map((t, i) => (
                      <Badge key={i} variant="outline">
                        {t.value}
                      </Badge>
                    ))}
                  </div>
                </div>

                {/* Subreddit selection */}
                {subreddits.length > 0 && (
                  <div>
                    <span className="font-medium text-gray-600">
                      Suggested Subreddits:
                    </span>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {subreddits.map((s) => (
                        <button
                          key={s.name}
                          onClick={() => toggleSubreddit(s.name)}
                          className={`flex items-center gap-2 rounded-lg p-2 text-left text-sm transition-colors ${
                            s.selected
                              ? "bg-red-50 ring-1 ring-red-200"
                              : "bg-gray-50 ring-1 ring-gray-200"
                          }`}
                        >
                          <span className={s.selected ? "text-red-500" : "text-gray-300"}>
                            {s.selected ? "✓" : "○"}
                          </span>
                          <span className="font-medium">r/{s.name}</span>
                          {s.subscribers > 0 && (
                            <span className="ml-auto text-xs text-gray-400">
                              {formatSubscribers(s.subscribers)}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <Input
                        placeholder="Add custom subreddit..."
                        value={customSubreddit}
                        onChange={(e) => setCustomSubreddit(e.target.value)}
                        onKeyDown={(e) =>
                          e.key === "Enter" && addCustomSubreddit()
                        }
                        className="text-sm"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={addCustomSubreddit}
                      >
                        Add
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-4 flex gap-2">
                <Button
                  onClick={() => handleSaveAndStart(config)}
                  disabled={saveConfig.isPending}
                  className="bg-red-500 hover:bg-red-600"
                >
                  {saveConfig.isPending
                    ? "Saving..."
                    : "🚀 Start Monitoring"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setPhase("clarifying");
                    setMessages((prev) => [
                      ...prev,
                      {
                        role: "assistant",
                        content:
                          "What would you like to change? You can add or remove keywords, competitors, topics, or subreddits.",
                      },
                    ]);
                  }}
                >
                  Edit
                </Button>
              </div>
            </Card>
          )}

          <div ref={scrollRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="mt-4 flex gap-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder={
            phase === "initial"
              ? "Describe your company and what you want to monitor..."
              : "Type your response..."
          }
          className="min-h-[44px] resize-none"
          rows={1}
        />
        <Button
          onClick={() => void handleSend()}
          disabled={!input.trim() || processMessage.isPending}
          className="bg-red-500 hover:bg-red-600"
        >
          Send
        </Button>
      </div>
    </div>
  );
}
