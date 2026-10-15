// Sections of the Email Marketing panel, each at /email-marketing/<tab>.
// Shared by the client panel and the server [tab] route, so it lives in
// its own plain (non-"use client") module.

export type Tab = "overview" | "compose" | "history" | "lists" | "forms" | "subscribers" | "templates" | "settings";

/** Old section URLs that now live inside another section. */
export const MOVED_TABS: Record<string, string> = {
  unsubscribes: "/email-marketing/subscribers?view=unsubscribed",
};

export const TABS: Tab[] = ["overview", "compose", "history", "lists", "forms", "subscribers", "templates", "settings"];
