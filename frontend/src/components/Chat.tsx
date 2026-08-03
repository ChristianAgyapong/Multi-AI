"use client";

import React, { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Send, Image as ImageIcon, Sparkles, Trash2, X } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Message {
  role: "user" | "assistant";
  content: string;
  image?: string;
}

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [agentMode, setAgentMode] = useState("socratic");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  const handleSend = async () => {
    if ((!input.trim() && !imagePreview) || isStreaming) return;

    const userText = input;
    const userImg = imagePreview;
    setInput("");
    setImagePreview(null);

    const newMessages: Message[] = [
      ...messages,
      { role: "user", content: userText || "(Sent an image)", image: userImg || undefined },
    ];
    setMessages(newMessages);
    setIsStreaming(true);

    // Prepare assistant streaming placeholder
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      // Strip 'data:image/...;base64,' prefix before sending
      const imageBase64 = userImg ? userImg.split(',')[1] : undefined;

      const response = await fetch(`${API_BASE}/ask/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: userText,
          agent_mode: agentMode,
          image_base64: imageBase64,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.replace("data: ", "").trim();
            if (data === "[DONE]") break;
            if (data.startsWith("[ERROR:")) {
              assistantText += `\n\n⚠️ ${data}`;
            } else {
              assistantText += data;
            }
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1].content = assistantText;
              return updated;
            });
          }
        }
      }
    } catch (err: any) {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1].content = `⚠️ Network Error: ${err.message}. Make sure the FastAPI server is running.`;
        return updated;
      });
    } finally {
      setIsStreaming(false);
    }
  };

  return (
    <div className="flex flex-col h-[85vh] glass-panel p-4 relative" onPaste={handlePaste}>
      {/* Top Header / Mode Selector */}
      <div className="flex items-center justify-between pb-4 border-b border-[var(--border-color)]">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-indigo-400" />
          <h2 className="font-semibold text-lg gradient-text">AI Tutor</h2>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={agentMode}
            onChange={(e) => setAgentMode(e.target.value)}
            className="bg-[#1e293b] text-sm text-gray-200 border border-[var(--border-color)] rounded-lg px-3 py-1.5 focus:outline-none focus:border-indigo-500"
          >
            <option value="socratic">Socratic Tutor (Guided)</option>
            <option value="direct">Direct Explainer</option>
            <option value="exam">Exam Prep Coach</option>
          </select>
          <button
            onClick={() => setMessages([])}
            className="p-1.5 text-gray-400 hover:text-red-400 rounded-lg hover:bg-gray-800 transition"
            title="Clear Chat"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages List */}
      <div className="flex-1 overflow-y-auto py-4 space-y-4 pr-2">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-gray-400 gap-3">
            <Sparkles className="w-12 h-12 text-indigo-400 opacity-50 animate-pulse" />
            <h3 className="text-xl font-medium text-gray-200">How can I help you learn today?</h3>
            <p className="max-w-md text-sm text-gray-400">
              Ask any math, physics, or general subject question. You can also paste screenshots directly into the chat!
            </p>
          </div>
        ) : (
          messages.map((m, idx) => (
            <div
              key={idx}
              className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl p-4 ${
                  m.role === "user"
                    ? "bg-indigo-600/30 border border-indigo-500/30 text-white"
                    : "bg-[#1e293b]/70 border border-[var(--border-color)] text-gray-100"
                }`}
              >
                {m.image && (
                  <img
                    src={m.image}
                    alt="Uploaded problem"
                    className="max-w-xs rounded-lg mb-3 border border-gray-700"
                  />
                )}
                <div className="prose prose-invert max-w-none text-sm leading-relaxed">
                  <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                    {m.content}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Image Preview Thumbnail */}
      {imagePreview && (
        <div className="relative inline-block mb-2 self-start">
          <img src={imagePreview} alt="Preview" className="h-16 w-16 object-cover rounded-lg border border-indigo-500" />
          <button
            onClick={() => setImagePreview(null)}
            className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-0.5 hover:bg-red-600"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Input Bar */}
      <div className="flex items-center gap-2 pt-3 border-t border-[var(--border-color)]">
        <label className="p-2 text-gray-400 hover:text-indigo-400 cursor-pointer hover:bg-gray-800 rounded-lg transition">
          <ImageIcon className="w-5 h-5" />
          <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
        </label>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Ask a question or press Ctrl+V to paste an image..."
          disabled={isStreaming}
          className="flex-1 bg-[#1e293b]/80 border border-[var(--border-color)] rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 transition"
        />
        <button
          onClick={handleSend}
          disabled={isStreaming || (!input.trim() && !imagePreview)}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white p-2.5 rounded-xl transition"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
