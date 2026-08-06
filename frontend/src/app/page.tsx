"use client";

import React, { useState } from "react";
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
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [chatMode, setChatMode] = useState<string>("direct");

  return (
    <>
      <main className="app-main relative flex h-screen w-full gap-2 md:gap-3 overflow-hidden">
        {/* Ambient glow */}
        <div className="glow-bg" style={{ top: "-150px", left: "-150px", opacity: 0.22 }} />
        <div className="glow-bg" style={{ bottom: "-150px", right: "-150px", opacity: 0.15, animationDelay: "5s" }} />
        <div className="glow-bg" style={{ top: "40%", left: "50%", opacity: 0.08, animationDelay: "2s", width: "800px", height: "800px", transform: "translate(-50%, -50%)" }} />

        {/* Sidebar — desktop only */}
        {isSidebarOpen && (
          <aside className="sidebar-desktop w-[320px] shrink-0 z-10 flex flex-col h-full overflow-y-auto">
            <Sidebar
              onStartSession={() => setActiveTab("chat")}
              chatMode={chatMode}
              setChatMode={setChatMode}
            />
          </aside>
        )}

        {/* Main column */}
        <div className="flex-1 min-w-0 z-10 flex flex-col gap-2 md:gap-3">
          {/* Header */}
          <header className="bg-transparent border-b border-white/5 px-4 py-2 md:px-6 md:py-2 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="hidden md:flex p-2 rounded-xl text-[var(--text-muted)] hover:text-white hover:bg-white/10 transition-all active:scale-95"
                title="Toggle sidebar"
              >
                {isSidebarOpen ? <PanelLeftClose size={20} /> : <PanelLeftOpen size={20} />}
              </button>

              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center">
                  <GraduationCap size={18} className="text-indigo-400" />
                </div>
                <h1 className="gradient-text text-sm md:text-base font-semibold leading-tight">
                  Multimodal AI Tutor
                </h1>
              </div>
            </div>

            {/* Desktop tab bar */}
            <nav
              className="desktop-tabs flex gap-1 rounded-xl"
              style={{ background: "rgba(15, 23, 42, 0.8)", border: "1px solid var(--border-color)" }}
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
          </header>

          {/* Tab panel */}
          <div className="flex-1 min-h-0 relative flex flex-col">
            <div key={activeTab} className="tab-content-enter h-full">
              {activeTab === "chat" && <Chat mode={chatMode} />}
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
