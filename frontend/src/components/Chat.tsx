"use client";

import React, { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Send, Image as ImageIcon, Sparkles, Trash2, X, User, Square, Copy, Check, Bot, Calculator, Target } from "lucide-react";
import { setStoredSessionId, withSessionHeaders } from "@/lib/session";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Message {
  role: "user" | "assistant";
  content: string;
  image?: string;
  timestamp?: string;
}

const SUGGESTIONS = [
  "Explain photosynthesis step by step",
  "Solve x² − 5x + 6 = 0",
  "Teach me integration by parts",
  "Summarize Newton's laws of motion",
  "What is the Krebs cycle?",
];

// Maps UI mode ids to backend AGENT_MODES keys from backend/tutor_engine.py:
//   socratic -> socratic_peer, direct -> tutor, exam -> quiz_master
interface Mode {
  id: string;
  label: string;
  desc: string;
  agentMode: string;
}

const MODES: Mode[] = [
  { id: "socratic", label: "Socratic", desc: "Guided questions", agentMode: "socratic_peer" },
  { id: "direct", label: "Direct", desc: "Clear explanations", agentMode: "tutor" },
  { id: "exam", label: "Exam Prep", desc: "Test-focused", agentMode: "quiz_master" },
];

const formatTime = (date: Date) =>
  date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [agentMode, setAgentMode] = useState("direct");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isStreaming]);

  // Handle Clipboard Paste (Ctrl+V)
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = (event) => {
            setImagePreview(event.target?.result as string);
          };
          reader.readAsDataURL(file);
        }
      }
    }
  };

  // Handle File Upload Select
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setImagePreview(event.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // Auto-grow textarea up to a max height
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.currentTarget;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Stop the in-flight stream, keeping whatever tokens arrived so far
  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleCopy = async (idx: number, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx((prev) => (prev === idx ? null : prev)), 2000);
    } catch {
      // Clipboard unavailable — ignore silently
    }
  };

  const handleSend = async (override?: string) => {
    const userText = (override ?? input).trim();
    if ((!userText && !imagePreview) || isStreaming) return;

    const userImg = imagePreview;
    setInput("");
    setImagePreview(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.focus();
    }

    const newMessages: Message[] = [
      ...messages,
      { role: "user", content: userText || "(Sent an image)", image: userImg || undefined, timestamp: formatTime(new Date()) },
    ];
    setMessages(newMessages);
    setIsStreaming(true);

    // Prepare assistant streaming placeholder
    setMessages((prev) => [...prev, { role: "assistant", content: "", timestamp: formatTime(new Date()) }]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Strip 'data:image/...;base64,' prefix before sending
      const imageBase64 = userImg ? userImg.split(",")[1] : undefined;
      const imageMediaType = userImg ? userImg.split(";")[0].split(":")[1] : undefined;

      const response = await fetch(`${API_BASE}/ask/stream`, {
        method: "POST",
        headers: withSessionHeaders({ "Content-Type": "application/json" }),
body: JSON.stringify({
          question: userText,
          agent_mode: MODES.find((m) => m.id === agentMode)?.agentMode ?? "tutor",
          image_base64: imageBase64,
          image_media_type: imageMediaType,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
        signal: controller.signal,
      });

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          try {
            const msg = JSON.parse(raw);
            if (msg.type === "session" && msg.session_id) {
              setStoredSessionId(msg.session_id);
              continue;
            }
            if (msg.type === "done") break;
            if (msg.type === "token" && msg.text) {
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                return [...prev.slice(0, -1), { ...last, content: last.content + msg.text }];
              });
            }
          } catch {
            if (raw === "[DONE]") break;
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              const addition = raw.startsWith("[ERROR:") ? `\n\n⚠️ ${raw}` : raw;
              return [...prev.slice(0, -1), { ...last, content: last.content + addition }];
            });
          }
        }
      }
    } catch (err) {
      // If the user pressed Stop, keep the partial response silently.
      if (err instanceof DOMException && err.name === "AbortError") return;
      const errorMessage = err instanceof Error ? err.message : String(err);
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        return [...prev.slice(0, -1), { ...last, content: `⚠️ Network Error: ${errorMessage}. Please make sure you are connected to the internet and the AI server is online.` }];
      });
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  };

  return (
    <div className="chat-shell flex flex-col h-full glass-panel relative overflow-hidden" onPaste={handlePaste}>
      <div className="chat-toolbar shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-white leading-tight">
            <Sparkles className="w-4 h-4 text-indigo-300 shrink-0" />
            <span>Chat</span>
          </div>
          <p className="chat-toolbar-subtitle">Ask questions, upload screenshots, get step-by-step help</p>
        </div>

        <div className="flex items-center gap-3 flex-wrap justify-between md:justify-end">
          <div className="flex items-center gap-1.5 flex-wrap">
          {MODES.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setAgentMode(id)}
              className={`mode-pill ${agentMode === id ? "active" : ""}`}
              title={MODES.find((m) => m.id === id)?.desc}
            >
              {label}
            </button>
          ))}
          </div>
          <button
            onClick={() => setMessages([])}
            className="p-2 text-[var(--text-muted)] hover:text-red-400 rounded-xl hover:bg-white/5 transition-colors"
            title="Clear chat"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages List */}
      <div className="chat-stage flex-1 overflow-y-auto px-4 py-6 md:px-8 bg-transparent">
        <div className="chat-stage-inner max-w-4xl mx-auto flex flex-col space-y-8">
          {messages.length === 0 ? (
            <div className="chat-empty flex flex-col items-center justify-center min-h-[62vh] text-center text-gray-400 gap-5 animate-fade-in-up px-2">
              <div className="relative p-6 rounded-full bg-gradient-to-br from-indigo-500/20 to-purple-600/10 border border-indigo-500/30 shadow-[0_0_80px_rgba(99,102,241,0.18)]">
                <Bot className="w-14 h-14 text-indigo-300" />
                <span className="absolute inset-0 rounded-full animate-ping bg-indigo-500/10" />
              </div>
              <h3 className="gradient-text text-3xl font-semibold text-white">How can I help you learn today?</h3>
              <p className="max-w-lg text-sm text-gray-400 leading-relaxed">
                Ask any math, physics, or general subject question. You can also paste screenshots directly into the chat!
              </p>

              {/* Quick-start suggestions */}
              <div className="chat-empty-suggestions flex flex-wrap justify-center gap-2 max-w-2xl mt-5">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => handleSend(s)} className="suggestion-chip">
                    <Sparkles className="w-3 h-3 shrink-0" />
                    <span>{s}</span>
                  </button>
                ))}
              </div>

              {/* Feature highlights */}
              <div className="chat-feature-grid grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6 max-w-lg w-full">
                {[
                  { icon: ImageIcon, label: "Paste screenshots", sub: "Ctrl+V any image" },
                  { icon: Calculator, label: "Live math", sub: "LaTeX rendering" },
                  { icon: Target, label: "3 tutor modes", sub: "Socratic · Direct · Exam" },
                ].map(({ icon: Icon, label, sub }) => (
                  <div key={label} className="chat-feature-card group flex flex-col items-center gap-1.5 p-3 rounded-xl transition-all hover:-translate-y-1 hover:border-indigo-500/30 hover:shadow-[0_8px_24px_rgba(99,102,241,0.15)]">
                    <Icon className="w-5 h-5 text-indigo-400 group-hover:text-indigo-300 transition-colors" />
                    <span className="text-xs font-medium text-[var(--text-main)]">{label}</span>
                    <span className="text-[0.65rem] text-[var(--text-dim)]">{sub}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, idx) => {
              const isLastStreaming = isStreaming && m.role === "assistant" && idx === messages.length - 1;
              const showTyping = isLastStreaming && m.content === "";
              const showCaret = isLastStreaming && m.content !== "";
              return (
                <div
                  key={idx}
                  className={`group flex gap-4 animate-fade-in-up w-full ${m.role === "user" ? "flex-row-reverse" : "flex-row"}`}
                  style={{ animationDelay: `${Math.min(idx * 0.05, 0.3)}s` }}
                >
                  {/* Avatar */}
                  <div className="flex-shrink-0 mt-1">
                    <div className={`chat-avatar w-9 h-9 rounded-full flex items-center justify-center shadow-md ${
                      m.role === "user"
                        ? "bg-gradient-to-br from-indigo-500 to-purple-600 border border-indigo-400/50"
                        : "bg-[#1e293b] border border-[var(--border-color)]"
                    }`}>
                      {m.role === "user" ? (
                        <User className="w-5 h-5 text-white" />
                      ) : (
                        <Sparkles className="w-5 h-5 text-indigo-400" />
                      )}
                    </div>
                  </div>

                  {/* Message Bubble */}
                  <div
                    className={`flex flex-col max-w-[85%] md:max-w-[75%] ${
                      m.role === "user" ? "items-end" : "items-start"
                    }`}
                  >
                    <div
                      className={`chat-bubble relative p-5 shadow-lg backdrop-blur-xl transition-all duration-300 ${
                        m.role === "user"
                          ? "bg-gradient-to-br from-indigo-500/80 to-purple-600/80 border border-indigo-400/40 text-white rounded-[24px] rounded-tr-[4px]"
                          : "bg-[#0f172a]/70 border border-white/10 text-gray-100 rounded-[24px] rounded-tl-[4px]"
                      } ${isLastStreaming ? "is-streaming" : ""}`}
                    >
                      {/* Copy button (assistant messages only) */}
                      {m.role === "assistant" && m.content && (
                        <button
                          onClick={() => handleCopy(idx, m.content)}
                          className="absolute top-2.5 right-2.5 p-1.5 rounded-lg text-gray-500 hover:text-indigo-300 hover:bg-white/5 transition-colors opacity-100 md:opacity-0 md:group-hover:opacity-100"
                          title={copiedIdx === idx ? "Copied!" : "Copy response"}
                          aria-label={copiedIdx === idx ? "Copied" : "Copy response"}
                        >
                          {copiedIdx === idx ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      )}

                      {m.image && (
                        <img
                          src={m.image}
                          alt="Uploaded problem"
                          className="max-w-sm w-full object-contain rounded-xl mb-4 border border-white/10 shadow-lg"
                        />
                      )}

                      <div className="prose prose-invert max-w-none text-[0.95rem] leading-relaxed break-words">
                        {showTyping ? (
                          <div className="flex items-center gap-1.5 py-1.5">
                            <span className="typing-dot" />
                            <span className="typing-dot" style={{ animationDelay: "0.15s" }} />
                            <span className="typing-dot" style={{ animationDelay: "0.3s" }} />
                          </div>
                        ) : (
                          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                            {showCaret ? `${m.content} ▍` : m.content}
                          </ReactMarkdown>
                        )}
                      </div>
                    </div>

                    {/* Timestamp */}
                    {m.timestamp && (
                      <span className="text-[10px] text-gray-500 mt-1.5 px-1 tracking-wide">{m.timestamp}</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} className="h-4" />
        </div>
      </div>

      {/* Input Bar Area (Pinned to Bottom of Chat) */}
      <div className="chat-composer-shell flex-shrink-0 p-4 z-20">
        <div className="max-w-4xl mx-auto flex flex-col gap-2">

          {/* Image Preview Thumbnail */}
          {imagePreview && (
            <div className="relative inline-block self-start mb-1 bg-[#1f2937] p-2 rounded-2xl border border-white/10 shadow-xl">
              <img src={imagePreview} alt="Preview" className="h-16 w-16 object-cover rounded-xl border border-indigo-500/50 shadow-inner" />
              <button
                onClick={() => setImagePreview(null)}
                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-400 shadow-lg transition-transform hover:scale-110"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Solid Input Pill */}
          <div
            className="chat-composer chat-input-wrap flex items-end relative rounded-[32px] p-2 shadow-2xl transition-all"
          >
            <label className="ml-1 p-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-full cursor-pointer transition-colors flex items-center justify-center">
              <ImageIcon className="w-5 h-5" />
              <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
            </label>

            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              placeholder="Message AI Tutor..."
              disabled={isStreaming}
              rows={1}
              className="flex-1 bg-transparent border-none px-3 py-2 text-[0.95rem] text-white placeholder-gray-400 focus:outline-none focus:ring-0 resize-none max-h-[132px]"
            />

            <button
              onClick={isStreaming ? handleStop : () => handleSend()}
              disabled={!isStreaming && !input.trim() && !imagePreview}
              className="mr-1 p-2.5 rounded-full transition-all shadow-md flex items-center justify-center text-white active:scale-95"
              title={isStreaming ? "Stop generating" : "Send"}
              style={{
                backgroundColor: isStreaming ? "#dc2626" : !input.trim() && !imagePreview ? "#374151" : "#4f46e5",
                color: isStreaming ? "#ffffff" : !input.trim() && !imagePreview ? "#9ca3af" : "#ffffff",
                cursor: isStreaming ? "pointer" : !input.trim() && !imagePreview ? "not-allowed" : "pointer",
              }}
            >
              {isStreaming ? <Square className="w-4 h-4" /> : <Send className="w-4 h-4" />}
            </button>
          </div>

          <div className="text-center mt-1">
            <span className="chat-composer-note text-[10px] text-gray-400 font-medium tracking-wide uppercase opacity-70">AI can make mistakes. Verify important information.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

