"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  LoaderCircle,
  MessageCircle,
  Send,
} from "lucide-react";
import { authFetch } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import type { WhatsAppChat, WhatsAppMessage } from "@/lib/whatsapp/types";

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const r = await authFetch(url, { cache: "no-store", ...options });
  const data = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(data.error || "Unable to load WhatsApp");
  return data;
}
const key = (m: WhatsAppMessage) => `${m.id}:${m.fromMe}`;
export default function WhatsAppChats({ connected }: { connected: boolean }) {
  const [chats, setChats] = useState<WhatsAppChat[]>([]),
    [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]),
    [search, setSearch] = useState(""),
    [phone, setPhone] = useState(""),
    [draft, setDraft] = useState("");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [sending, setSending] = useState(false),
    [loading, setLoading] = useState(true),
    [older, setOlder] = useState(false);
  const scroll = useRef<HTMLDivElement>(null),
    active = useRef(selected);
  const lastMessageId = messages.at(-1)?.id;
  const refreshChats = useCallback(async (signal?: AbortSignal) => {
    const data = await request<{ chats: WhatsAppChat[] }>(
      "/api/whatsapp/chats",
      { signal },
    );
    setChats(data.chats);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    const load = async () => {
      if (running) return;
      running = true;
      try {
        await refreshChats(controller.signal);
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Unable to load chats");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
        running = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [refreshChats]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    let running = false;
    const load = async () => {
      if (running) return;
      running = true;
      try {
        const data = await request<{ messages: WhatsAppMessage[] }>(
          `/api/whatsapp/messages?jid=${encodeURIComponent(selected)}`,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted)
          setMessages((previous) => {
            const merged = new Map(previous.map((m) => [key(m), m]));
            for (const m of data.messages) merged.set(key(m), m);
            return [...merged.values()].sort(
              (a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id),
            );
          });
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Unable to load messages");
      } finally {
        running = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 2500);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [selected]);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [selected, lastMessageId]);
  function choose(jid: string) {
    active.current = jid;
    setSelected(jid);
    setMessages([]);
    setDraft("");
    setError("");
    setNotice("");
  }
  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !draft.trim() || sending || !connected) return;
    const jid = selected;
    setSending(true);
    setError("");
    try {
      await request("/api/whatsapp/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jid, text: draft }),
      });
      if (active.current === jid) {
        setDraft("");
        const data = await request<{ messages: WhatsAppMessage[] }>(
          `/api/whatsapp/messages?jid=${encodeURIComponent(jid)}`,
        );
        if (active.current === jid)
          setMessages((previous) => {
            const merged = new Map(previous.map((m) => [key(m), m]));
            for (const m of data.messages) merged.set(key(m), m);
            return [...merged.values()].sort(
              (a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id),
            );
          });
      }
      await refreshChats();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Unable to send. Check the conversation before retrying.",
      );
    } finally {
      setSending(false);
    }
  }
  async function loadOlder() {
    if (!selected || !messages.length) return;
    setOlder(true);
    setError("");
    const jid = selected;
    try {
      const data = await request<{ messages: WhatsAppMessage[] }>(
        `/api/whatsapp/messages?jid=${encodeURIComponent(jid)}&before=${messages[0].timestamp}`,
      );
      if (active.current !== jid) return;
      if (data.messages.length)
        setMessages((previous) => [...data.messages, ...previous]);
      else {
        await request("/api/whatsapp/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jid }),
        });
        setNotice(
          "Requested older messages from your phone. Keep WhatsApp connected, then check again.",
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load history");
    } finally {
      setOlder(false);
    }
  }
  async function syncHistory() {
    setOlder(true);
    setError("");
    try {
      await request("/api/whatsapp/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full: true }),
      });
      setNotice(
        "Requested up to 90 days of history from your phone. Keep WhatsApp online while chats arrive. Some phones may require a new QR link for initial history.",
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "History could not be requested",
      );
    } finally {
      setOlder(false);
    }
  }
  const chat = chats.find((c) => c.jid === selected);
  return (
    <section
      className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
      aria-label="WhatsApp conversations"
    >
      <div className="border-b border-slate-200 px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">Chats</h2>
          <Button
            size="sm"
            variant="outline"
            disabled={!connected || older}
            onClick={() => void syncHistory()}
          >
            {older ? "Requesting…" : "Sync history"}
          </Button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Chats are private to your Mailflare account. History fills as WhatsApp
          syncs from your phone.
        </p>
      </div>
      {notice && (
        <p
          role="status"
          className="border-b border-slate-200 px-5 py-3 text-sm text-slate-500"
        >
          {notice}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="border-b border-red-100 bg-red-50 px-5 py-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      <div className="flex min-h-[480px] max-h-[70dvh]">
        <aside
          className={`${selected ? "hidden md:flex" : "flex"} w-full shrink-0 flex-col border-r border-slate-200 md:w-64`}
          aria-label="Chat list"
        >
          <div className="space-y-3 border-b border-slate-200 p-3">
            <input
              aria-label="Search chats"
              placeholder="Search chats"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-transparent px-3 py-2 text-sm"
            />
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const number = phone.replace(/[+\s()-]/g, "");
                if (!/^\d{7,15}$/.test(number)) {
                  setError("Enter a phone number with country code.");
                  return;
                }
                choose(number + "@s.whatsapp.net");
                setPhone("");
              }}
            >
              <input
                aria-label="Phone number with country code"
                placeholder="New chat: +234…"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-transparent px-3 py-2 text-sm"
              />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                aria-label="Start chat"
              >
                <MessageCircle className="h-4 w-4" />
              </Button>
            </form>
          </div>
          <div className="overflow-y-auto" aria-label="Conversations">
            {loading ? (
              <p className="p-4 text-sm text-slate-500">Loading chats…</p>
            ) : !chats.length ? (
              <p className="p-4 text-sm leading-relaxed text-slate-500">
                No chats synced yet. New messages will appear here. For an
                account linked before chat syncing was added, you may need to
                disconnect and scan a new QR code to receive recent history.
              </p>
            ) : (
              chats
                .filter((c) =>
                  (c.name + " " + c.jid)
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((c) => (
                  <button
                    key={c.jid}
                    onClick={() => choose(c.jid)}
                    aria-pressed={selected === c.jid}
                    className={`block w-full border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 ${selected === c.jid ? "bg-emerald-50" : ""}`}
                  >
                    <span className="block truncate text-sm font-medium">
                      {c.name}
                    </span>
                    <span className="mt-1 block truncate text-xs text-slate-500">
                      {c.preview || "No messages yet"}
                    </span>
                  </button>
                ))
            )}
          </div>
        </aside>
        <div
          className={`${selected ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col`}
        >
          {selected ? (
            <>
              <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
                <button
                  className="md:hidden"
                  aria-label="Back to chats"
                  onClick={() => {
                    active.current = null;
                    setSelected(null);
                  }}
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <div className="min-w-0">
                  <h3 className="truncate font-medium">
                    {chat?.name || selected.split("@")[0]}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {selected.endsWith("@g.us")
                      ? "Group conversation"
                      : "Personal conversation"}
                  </p>
                </div>
              </div>
              <div
                ref={scroll}
                className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-4"
                aria-label="Messages"
              >
                {!!messages.length && (
                  <div className="mb-4 text-center">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={older || !connected}
                      onClick={() => void loadOlder()}
                    >
                      {older ? "Loading…" : "Load older messages"}
                    </Button>
                  </div>
                )}
                {!messages.length && (
                  <p className="py-12 text-center text-sm text-slate-500">
                    No messages stored for this chat yet.
                  </p>
                )}
                {messages.map((m) => (
                  <div
                    key={key(m)}
                    className={`mb-3 flex ${m.fromMe ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${m.fromMe ? "bg-emerald-100 text-emerald-950" : "border border-slate-200 bg-white text-slate-900"}`}
                    >
                      {!m.fromMe && selected.endsWith("@g.us") && (
                        <p className="mb-1 text-xs font-medium text-emerald-700">
                          {m.sender}
                        </p>
                      )}
                      {m.kind !== "text" && m.kind !== "deleted" && (
                        <p className="mb-1 text-xs font-medium capitalize text-slate-500">
                          {m.kind} · open in WhatsApp to view
                        </p>
                      )}
                      <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                        {m.text}
                      </p>
                      <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-slate-500">
                        <time
                          dateTime={new Date(m.timestamp * 1000).toISOString()}
                          title={new Date(m.timestamp * 1000).toLocaleString()}
                        >
                          {new Date(m.timestamp * 1000).toLocaleString(
                            undefined,
                            {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            },
                          )}
                        </time>
                        {m.fromMe &&
                          (m.status >= 3 ? (
                            <CheckCheck
                              aria-label={m.status >= 4 ? "Read" : "Delivered"}
                              className={`h-3 w-3 ${m.status >= 4 ? "text-sky-600" : ""}`}
                            />
                          ) : (
                            <Check aria-label="Sent" className="h-3 w-3" />
                          ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <form
                onSubmit={(e) => void send(e)}
                className="flex items-end gap-3 border-t border-slate-200 p-3"
              >
                <textarea
                  aria-label="Message"
                  placeholder={
                    connected
                      ? "Write a message…"
                      : "Reconnect to send messages"
                  }
                  value={draft}
                  maxLength={4096}
                  disabled={!connected || sending}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={2}
                  className="min-w-0 flex-1 resize-none rounded-xl border border-slate-200 bg-transparent px-3 py-2 text-sm"
                />
                <Button
                  type="submit"
                  disabled={!connected || !draft.trim() || sending}
                  aria-label="Send message"
                >
                  {sending ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </form>
            </>
          ) : (
            <div className="m-auto p-8 text-center text-slate-500">
              <MessageCircle className="mx-auto mb-3 h-10 w-10 text-emerald-600" />
              <p>Select a chat to read and reply.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
