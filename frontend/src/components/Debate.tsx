"use client";

import React, { useState, useRef, useEffect } from "react";
import { Users, Send, RefreshCw, Trash2, Bot, GraduationCap } from "lucide-react";
import ReactMarkdown from "react-markdown";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface DebateMessage {
  role: "fellow" | "tutor" | "student";
  content: string;
}

export default function Debate() {
  const [topic, setTopic] = useState("");
  const [messages, setMessages] = useState<DebateMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const startDebate = async () => {
    if (!topic.trim()) return;
    
    setLoading(true);
    setMessages([]);
    setSessionActive(true);

    try {
      const res = await fetch(`${API_BASE}/debate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          fellow_student_history: [],
          tutor_history: [],
        }),
      });
      const data = await res.json();
      
      if (data.fellow) {
        setMessages([{ role: "fellow", content: data.fellow }]);
      }
    } catch (err) {
      alert("Failed to start debate. Is the backend running?");
      setSessionActive(false);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const studentText = input;
    setInput("");
    
    const newMessages: DebateMessage[] = [...messages, { role: "student", content: studentText }];
    setMessages(newMessages);
    setLoading(true);

    // Build history for backend
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
        body: JSON.stringify({
          topic,
          student_correction: studentText,
          fellow_student_history: fellowHistory,
          tutor_history: tutorHistory,
        }),
      });
      const data = await res.json();
      
      setMessages((prev) => {
        const updated = [...prev];
        if (data.tutor) {
          updated.push({ role: "tutor", content: data.tutor });
        }
        if (data.fellow) {
          updated.push({ role: "fellow", content: data.fellow });
        }
        return updated;
      });
    } catch (err) {
      alert("Failed to send message.");
    } finally {
      setLoading(false);
    }
  };

  const endDebate = () => {
    setSessionActive(false);
    setTopic("");
    setMessages([]);
  };

  return (
    <div className="flex flex-col h-[85vh] glass-panel p-4 relative">
      <div className="flex items-center justify-between pb-4 border-b border-[var(--border-color)]">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-indigo-400" />
          <h2 className="font-semibold text-lg gradient-text">Debate Arena (Feynman Technique)</h2>
        </div>
        {sessionActive && (
          <button
            onClick={endDebate}
            className="p-1.5 text-gray-400 hover:text-red-400 rounded-lg hover:bg-gray-800 transition"
            title="End Session"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {!sessionActive ? (
        <div className="flex-1 flex flex-col items-center justify-center py-8">
          <div className="max-w-md text-center space-y-6">
            <div className="mx-auto w-16 h-16 bg-indigo-900/30 rounded-full flex items-center justify-center border border-indigo-500/30">
              <Users className="w-8 h-8 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-xl font-medium text-gray-200 mb-2">Master by Teaching</h3>
              <p className="text-sm text-gray-400">
                A "Fellow Student" AI will explain a topic to you, but they'll make mistakes. 
                Your job is to correct them. A "Tutor" AI will grade your corrections.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Enter a topic to teach (e.g. Photosynthesis)"
                className="bg-[#1e293b]/80 border border-[var(--border-color)] rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-indigo-500 w-full text-center"
              />
              <button
                onClick={startDebate}
                disabled={loading || !topic.trim()}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white py-3 rounded-xl font-medium transition flex items-center justify-center gap-2 w-full"
              >
                {loading && <RefreshCw className="w-4 h-4 animate-spin" />}
                {loading ? "Starting..." : "Start Debate"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto py-4 space-y-4 pr-2">
            <div className="text-center text-xs text-indigo-300 font-medium pb-2">
              Topic: {topic}
            </div>
            
            {messages.map((m, idx) => (
              <div
                key={idx}
                className={`flex flex-col ${m.role === "student" ? "items-end" : "items-start"}`}
              >
                <div className="flex items-center gap-2 mb-1 px-1">
                  {m.role === "fellow" && (
                    <><Bot className="w-3.5 h-3.5 text-blue-400" /><span className="text-xs text-blue-400 font-medium">Fellow Student (AI)</span></>
                  )}
                  {m.role === "tutor" && (
                    <><GraduationCap className="w-3.5 h-3.5 text-emerald-400" /><span className="text-xs text-emerald-400 font-medium">Tutor Grader (AI)</span></>
                  )}
                  {m.role === "student" && (
                    <span className="text-xs text-indigo-400 font-medium">You</span>
                  )}
                </div>
                <div
                  className={`max-w-[85%] rounded-2xl p-4 ${
                    m.role === "student"
                      ? "bg-indigo-600/30 border border-indigo-500/30 text-white"
                      : m.role === "fellow"
                      ? "bg-blue-900/20 border border-blue-500/30 text-gray-100"
                      : "bg-emerald-900/20 border border-emerald-500/30 text-gray-100"
                  }`}
                >
                  <div className="prose prose-invert max-w-none text-sm leading-relaxed">
                    <ReactMarkdown>{m.content}</ReactMarkdown>
                  </div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          
          <div className="flex items-center gap-2 pt-3 border-t border-[var(--border-color)]">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="Correct the fellow student..."
              disabled={loading}
              className="flex-1 bg-[#1e293b]/80 border border-[var(--border-color)] rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 transition"
            />
            <button
              onClick={handleSend}
              disabled={loading || !input.trim()}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white p-2.5 rounded-xl transition"
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
