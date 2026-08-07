"use client";

import React, { useState, useRef, useEffect } from "react";
import { Users, Send, RefreshCw, Trash2, Bot, GraduationCap, Sparkles, Square } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface DebateMessage {
  role: "fellow" | "tutor" | "student";
  content: string;
}

const TOPIC_SUGGESTIONS = [
  "Photosynthesis",
  "Newton's Laws",
  "The French Revolution",
  "Binary Search Trees",
];

const STEPS = [
  { icon: Bot, title: "Pick a topic", desc: "Enter any concept you want to master." },
  { icon: GraduationCap, title: "Fellow Student explains it", desc: "An AI peer gives an explanation that deliberately contains mistakes." },
  { icon: Users, title: "You correct the mistakes", desc: "Read carefully, then message back what is wrong and what the correct version should be." },
  { icon: Sparkles, title: "Tutor grades your understanding", desc: "A Tutor AI checks your corrections and tells you what you got right or missed." },
];

export default function Debate() {
  const [topic, setTopic] = useState("");
  const [messages, setMessages] = useState<DebateMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const startDebate = async () => {
    if (!topic.trim() || loading) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setError(null);
    setLoading(true);
    setMessages([]);
    setSessionActive(true);

    try {
      const res = await fetch(`${API_BASE}/debate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortRef.current.signal,
        body: JSON.stringify({ topic, fellow_student_history: [], tutor_history: [] }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.fellow) setMessages([{ role: "fellow", content: data.fellow }]);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to start debate. Is the backend running?");
      setSessionActive(false);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setError(null);
    const studentText = input;
    setInput("");

    const newMessages: DebateMessage[] = [...messages, { role: "student", content: studentText }];
    setMessages(newMessages);
    setLoading(true);

    const fellowHistory = newMessages
      .filter((m) => m.role === "fellow" || m.role === "student")
      .map((m) => ({ role: m.role === "fellow" ? "assistant" : "user", content: m.content }));

    const tutorHistory = newMessages
      .filter((m) => m.role === "tutor" || m.role === "student")
      .map((m) => ({ role: m.role === "tutor" ? "assistant" : "user", content: m.content }));

    try {
      const res = await fetch(`${API_BASE}/debate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortRef.current.signal,
        body: JSON.stringify({
          topic,
          student_correction: studentText,
          fellow_student_history: fellowHistory,
          tutor_history: tutorHistory,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `HTTP ${res.status}`);
      }
      const data = await res.json();

      setMessages((prev) => {
        const updated = [...prev];
        if (data.tutor) updated.push({ role: "tutor", content: data.tutor });
        if (data.fellow) updated.push({ role: "fellow", content: data.fellow });
        return updated;
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to send message.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const endDebate = () => {
    setSessionActive(false);
    setTopic("");
    setMessages([]);
  };

  const roleStyles = {
    fellow: {
      bg: "bg-blue-950/40 border-blue-500/30",
      label: "Fellow Student",
      labelColor: "text-blue-400",
      icon: Bot,
    },
    tutor: {
      bg: "bg-emerald-950/40 border-emerald-500/30",
      label: "Tutor Grader",
      labelColor: "text-emerald-400",
      icon: GraduationCap,
    },
    student: {
      bg: "bg-pink-950/40 border-pink-500/30",
      label: "You",
      labelColor: "text-pink-400",
      icon: null,
    },
  };

  return (
    <div className="flex flex-col h-full glass-panel overflow-hidden">
      <div className="panel-header px-5 pt-5 shrink-0">
        <Users className="w-5 h-5 text-pink-400" />
        <div className="flex-1">
          <h2 className="gradient-text">Debate Arena</h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">Feynman Technique — learn by teaching</p>
        </div>
        {sessionActive && (
          <button
            onClick={endDebate}
            className="p-2 text-[var(--text-muted)] hover:text-red-400 rounded-xl hover:bg-white/5 transition"
            title="End session"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {!sessionActive ? (
        <div className="flex-1 flex flex-col items-center justify-center px-5 py-8 overflow-y-auto">
          <div className="max-w-md w-full text-center space-y-6 animate-fade-in-up">
            <div className="mx-auto w-20 h-20 rounded-full flex items-center justify-center border border-pink-500/30"
              style={{ background: "linear-gradient(135deg, rgba(236,72,153,0.15), rgba(139,92,246,0.1))" }}
            >
              <Users className="w-10 h-10 text-pink-400" />
            </div>

            <div>
              <h3 className="text-xl font-bold text-white mb-2">Master by Teaching</h3>
              <p className="text-sm text-[var(--text-muted)] leading-relaxed">
                A &quot;Fellow Student&quot; AI explains a topic — but makes mistakes.
                Your job is to spot and correct them. A Tutor AI then grades your understanding.
              </p>
            </div>

            {/* How it works */}
            <div className="space-y-2 text-left">
              <p className="text-[0.7rem] uppercase tracking-wider text-pink-300/80 font-semibold mb-1.5 text-center">How it works</p>
              {STEPS.map(({ icon: Icon, title, desc }, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-slate-800/40 border border-[var(--border-color)]">
                  <div className="w-7 h-7 rounded-full bg-pink-500/15 border border-pink-500/30 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-xs font-bold text-pink-400">{i + 1}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <Icon size={14} className="text-pink-300 shrink-0" />
                      <span className="text-xs font-semibold text-[var(--text-main)]">{title}</span>
                    </div>
                    <p className="text-[0.75rem] text-[var(--text-muted)] leading-snug">{desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-3">
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && startDebate()}
                placeholder="Enter a topic (e.g. Photosynthesis)"
                className="input-field text-center"
              />

              <div className="flex flex-wrap justify-center gap-2">
                {TOPIC_SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => setTopic(s)} className="suggestion-chip text-[0.75rem] py-1.5">
                    <Sparkles className="w-3 h-3" />
                    {s}
                  </button>
                ))}
              </div>

              <button
                onClick={startDebate}
                disabled={loading || !topic.trim()}
                className="w-full btn-primary py-3"
                style={{ background: "linear-gradient(135deg, #db2777, #ec4899)" }}
              >
                {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
                {loading ? "Starting…" : "Start Debate Session"}
              </button>

              {error && (
                <div className="px-4 py-2.5 rounded-xl text-xs font-medium text-red-200 bg-red-500/10 border border-red-500/20">
                  {error}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="px-5 py-2 border-b border-[var(--border-color)] shrink-0">
            <div className="text-center">
              <span className="text-xs font-medium text-pink-300/80 bg-pink-500/10 border border-pink-500/20 px-3 py-1 rounded-full">
                Topic: {topic}
              </span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            <div className="max-w-3xl lg:max-w-4xl mx-auto space-y-5">
            {messages.map((m, idx) => {
              const style = roleStyles[m.role];
              const Icon = style.icon;
              return (
                <div
                  key={idx}
                  className={`flex flex-col animate-fade-in-up ${m.role === "student" ? "items-end" : "items-start"}`}
                  style={{ animationDelay: `${idx * 0.04}s` }}
                >
                  <div className={`flex items-center gap-1.5 mb-1.5 px-1 ${style.labelColor}`}>
                    {Icon && <Icon className="w-3.5 h-3.5" />}
                    <span className="text-xs font-semibold">{style.label}</span>
                  </div>
                  <div className={`max-w-[88%] rounded-2xl p-4 border ${style.bg}`}>
                    <div className="prose prose-invert max-w-none text-sm leading-relaxed">
                      <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>
                        {m.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>
              );
            })}

            {loading && (
              <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] pl-1">
                <span className="typing-dot" />
                <span className="typing-dot" style={{ animationDelay: "0.15s" }} />
                <span className="typing-dot" style={{ animationDelay: "0.3s" }} />
                <span className="ml-1">Thinking…</span>
              </div>
            )}
            <div ref={messagesEndRef} />
            </div>
          </div>

          <div className="shrink-0 px-4 py-3 border-t border-[var(--border-color)] bg-slate-900/40">
            {error && (
              <div className="max-w-3xl mx-auto mb-2 px-4 py-2.5 rounded-xl text-xs font-medium text-red-200 bg-red-500/10 border border-red-500/20">
                {error}
              </div>
            )}
            <div className="flex items-end gap-2 max-w-3xl mx-auto">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !loading && handleSend()}
                placeholder="Correct the fellow student…"
                disabled={loading}
                className="input-field flex-1"
              />
              <button
                onClick={loading ? handleCancel : handleSend}
                disabled={!loading && !input.trim()}
                className="btn-primary p-2.5 shrink-0"
                style={{ background: "linear-gradient(135deg, #db2777, #ec4899)" }}
              >
                {loading ? <Square className="w-4 h-4 fill-current" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
