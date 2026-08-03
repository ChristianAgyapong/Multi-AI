"use client";

import React, { useState } from "react";
import Chat from "@/components/Chat";
import Quiz from "@/components/Quiz";
import Flashcards from "@/components/Flashcards";
import Debate from "@/components/Debate";
import Sidebar from "@/components/Sidebar";
import { MessageSquare, HelpCircle, GraduationCap, BookOpen, Users } from "lucide-react";

export default function Home() {
  const [activeTab, setActiveTab] = useState<"chat" | "quiz" | "flashcards" | "debate">("chat");

  return (
    <main className="min-h-screen p-4 md:p-8 max-w-7xl mx-auto relative flex flex-col md:flex-row gap-6">
      {/* Dynamic Background Glow Effects */}
      <div className="glow-bg top-[-50px] left-[-50px] opacity-20" />
      <div className="glow-bg bottom-[-50px] right-[-50px] opacity-15" />

      {/* Sidebar (Left) */}
      <Sidebar />

      {/* Main Content (Right) */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header Navigation */}
        <header className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-6 glass-panel px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-600/20 border border-indigo-500/30 rounded-xl">
              <GraduationCap className="w-6 h-6 text-indigo-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold gradient-text">Multimodal AI Tutor</h1>
              <p className="text-xs text-gray-400">Powered by Next.js & FastAPI</p>
            </div>
          </div>

          {/* Tab Switching Controls */}
          <div className="flex bg-[#1e293b]/80 border border-[var(--border-color)] p-1 rounded-xl overflow-x-auto max-w-full custom-scrollbar">
            <button
              onClick={() => setActiveTab("chat")}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap ${
                activeTab === "chat"
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/25"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              Chat
            </button>
            <button
              onClick={() => setActiveTab("quiz")}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap ${
                activeTab === "quiz"
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/25"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              <HelpCircle className="w-4 h-4" />
              Quiz
            </button>
            <button
              onClick={() => setActiveTab("flashcards")}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap ${
                activeTab === "flashcards"
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/25"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              <BookOpen className="w-4 h-4" />
              Cards
            </button>
            <button
              onClick={() => setActiveTab("debate")}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap ${
                activeTab === "debate"
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/25"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              <Users className="w-4 h-4" />
              Debate
            </button>
          </div>
        </header>

        {/* Tab Panels */}
        <div className="flex-1">
          {activeTab === "chat" && <Chat />}
          {activeTab === "quiz" && <Quiz />}
          {activeTab === "flashcards" && <Flashcards />}
          {activeTab === "debate" && <Debate />}
        </div>
      </div>
    </main>
  );
}
