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

  return (
    <>
      <main className="app-main relative flex h-screen max-w-[1600px] mx-auto gap-5 md:gap-8 p-4 md:p-8 overflow-hidden">
        {/* Ambient glow */}
        <div className="glow-bg" style={{ top: "-150px", left: "-150px", opacity: 0.22 }} />
        <div className="glow-bg" style={{ bottom: "-150px", right: "-150px", opacity: 0.15, animationDelay: "5s" }} />
        <div className="glow-bg" style={{ top: "40%", left: "50%", opacity: 0.08, animationDelay: "2s", width: "800px", height: "800px", transform: "translate(-50%, -50%)" }} />

        {/* Sidebar — desktop only */}
        {isSidebarOpen && (
          <aside className="sidebar-desktop w-[320px] shrink-0 z-10 flex flex-col h-full overflow-y-auto">
            <Sidebar onStartSession={() => setActiveTab("chat")} />
          </aside>
        )}

        {/* Main column */}
        <div className="flex-1 min-w-0 z-10 flex flex-col gap-4 md:gap-6">
          {/* Header */}
          <header className="glass-panel px-5 py-4 md:px-8 md:py-6 flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="hidden md:flex p-2.5 rounded-xl text-[var(--text-muted)] hover:text-white hover:bg-white/10 transition-all active:scale-95"
                title="Toggle sidebar"
              >
                {isSidebarOpen ? <PanelLeftClose size={22} /> : <PanelLeftOpen size={22} />}
              </button>

              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center">
                  <GraduationCap size={22} className="text-indigo-400" />
                </div>
                <div>
                  <h1 className="gradient-text text-base md:text-lg font-bold leading-tight">
                    Multimodal AI Tutor
                  </h1>
                  <p className="text-[0.7rem] text-[var(--text-muted)] mt-0.5 hidden sm:block">
                    Your personal AI study companion
                  </p>
                </div>
              </div>
            </div>

            {/* Desktop tab bar */}
            <nav
              className="desktop-tabs flex gap-1 p-1 rounded-xl"
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
              {activeTab === "chat" && <Chat />}
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
