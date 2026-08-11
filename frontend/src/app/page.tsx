"use client";

import React, { useState, useEffect } from "react";
import Chat from "@/components/Chat";
import Quiz from "@/components/Quiz";
import Flashcards from "@/components/Flashcards";
import Debate from "@/components/Debate";
import Sidebar from "@/components/Sidebar";
import {
  MessageSquare,
  HelpCircle,
  BookOpen,
  Users,
  GraduationCap,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { setStoredSessionId } from "@/lib/session";

type Tab = "chat" | "quiz" | "flashcards" | "debate";

const tabs: {
  id: Tab;
  label: string;
  shortLabel: string;
  Icon: React.ElementType;
}[] = [
  {
    id: "chat",
    label: "Chat",
    shortLabel: "Chat",
    Icon: MessageSquare,
  },
  {
    id: "quiz",
    label: "Quiz",
    shortLabel: "Quiz",
    Icon: HelpCircle,
  },
  {
    id: "flashcards",
    label: "Flashcards",
    shortLabel: "Cards",
    Icon: BookOpen,
  },
  {
    id: "debate",
    label: "Debate",
    shortLabel: "Debate",
    Icon: Users,
  },
];

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("chat");
  // Start sidebar closed always — useEffect opens it on desktop after mount
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);
  const [chatMode, setChatMode] = useState<string>("direct");
  const [sessionKey, setSessionKey] = useState<number>(0);

  // After mount: open sidebar only on true desktop screens
  useEffect(() => {
    const isDesktop = window.matchMedia("(min-width: 768px)").matches;
    if (isDesktop) {
      setIsSidebarOpen(true);
    }
  }, []);

  const handleStartSession = () => {
    // Clear frontend local storage for chat
    try {
      window.localStorage.removeItem("multimodal-edu-tutor-chat");
    } catch {}
    
    // Clear backend session ID
    setStoredSessionId(null);
    
    // Force Chat component to remount with empty state
    setSessionKey(prev => prev + 1);
    
    setActiveTab("chat");
    if (!window.matchMedia("(min-width: 768px)").matches) {
      setIsSidebarOpen(false);
    }
  };

  return (
    <>
      <main className="app-main relative flex w-full gap-2 md:gap-3 overflow-hidden">
        {/* Ambient glow */}
        <div className="glow-bg" style={{ top: "-150px", left: "-150px", opacity: 0.22 }} />
        <div className="glow-bg" style={{ bottom: "-150px", right: "-150px", opacity: 0.15, animationDelay: "5s" }} />
        <div className="glow-bg" style={{ top: "40%", left: "50%", opacity: 0.08, animationDelay: "2s", width: "800px", height: "800px", transform: "translate(-50%, -50%)" }} />

        {/* Mobile Sidebar Backdrop */}
        {isSidebarOpen && (
          <div 
            className="md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        {isSidebarOpen && (
          <aside className="sidebar-container fixed md:relative left-0 top-0 bottom-0 z-50 w-[85%] max-w-[320px] md:w-[320px] shrink-0 flex flex-col h-full overflow-y-auto shadow-2xl md:shadow-none">
            <Sidebar
              onStartSession={handleStartSession}
              chatMode={chatMode}
              setChatMode={setChatMode}
            />
          </aside>
        )}

        {/* Main column */}
        <div className="flex-1 min-w-0 z-10 flex flex-col overflow-hidden">
          {/* Header — sticky, never scrolls away */}
          <header className="flex-shrink-0 bg-gradient-to-b from-[rgba(3,7,18,0.95)] to-[rgba(3,7,18,0.85)] backdrop-blur-2xl border-b-2 border-white/8 px-3 py-3 md:px-6 md:py-3 flex items-center justify-between gap-3 md:gap-4 shadow-lg" style={{ position: 'sticky', top: 0, zIndex: 30 }}>
            <div className="flex items-center gap-3 min-w-0 flex-shrink-0">
              <button
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="flex-shrink-0 p-2 rounded-xl text-[var(--text-muted)] hover:text-white hover:bg-white/10 transition-all active:scale-95 z-50"
                title="Toggle sidebar"
              >
                {isSidebarOpen ? <PanelLeftClose size={20} /> : <PanelLeftOpen size={20} />}
              </button>

              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2 rounded-xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center flex-shrink-0 shadow-lg">
                  <GraduationCap size={20} className="text-indigo-300" />
                </div>
                <h1 className="gradient-text text-base md:text-lg font-bold leading-tight whitespace-nowrap">
                  AI Tutor
                </h1>
              </div>
            </div>

            {/* Desktop tab bar */}
            <nav
              className="desktop-tabs flex-shrink-0 flex gap-1 rounded-xl hidden md:flex"
              style={{ background: "rgba(15, 23, 42, 0.9)", border: "1px solid var(--border-color)" }}
            >
              {tabs.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  data-tab={id}
                  onClick={() => setActiveTab(id)}
                  className={`tab-pill ${activeTab === id ? "active" : ""}`}
                >
                  <Icon size={15} />
                  {label}
                </button>
              ))}
            </nav>

            {/* Mobile tab indicator */}
            <div className="mobile-tab-indicator md:hidden flex-shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: "rgba(99, 102, 241, 0.15)", border: "1px solid rgba(99, 102, 241, 0.3)" }}>
              {tabs.find(t => t.id === activeTab)?.Icon && React.createElement(tabs.find(t => t.id === activeTab)!.Icon, { size: 16, className: "text-indigo-300" })}
              <span className="text-sm font-semibold text-indigo-200">{tabs.find(t => t.id === activeTab)?.label}</span>
            </div>
          </header>

          {/* Tab panel */}
          <div className="flex-1 min-h-0 relative flex flex-col">
            <div key={activeTab} className="tab-content-enter h-full">
              {activeTab === "chat" && <Chat key={sessionKey} mode={chatMode} />}
              {activeTab === "quiz" && <Quiz />}
              {activeTab === "flashcards" && <Flashcards />}
              {activeTab === "debate" && <Debate />}
            </div>
          </div>
        </div>
      </main>

      {/* Mobile bottom navigation */}
      <nav className="mobile-nav">
        {tabs.map(({ id, shortLabel, Icon }) => (
          <button
            key={id}
            data-tab={id}
            onClick={() => setActiveTab(id)}
            className={`mobile-nav-item ${activeTab === id ? "active" : ""}`}
          >
            <Icon size={20} />
            {shortLabel}
          </button>
        ))}
      </nav>
    </>
  );
}
