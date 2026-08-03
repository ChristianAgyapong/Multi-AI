"use client";

import React, { useState, useEffect } from "react";
import { BookOpen, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import ReactMarkdown from "react-markdown";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Flashcard {
  front: string;
  back: string;
}

export default function Flashcards() {
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [sourceText, setSourceText] = useState("");

  const fetchFlashcards = async () => {
    try {
      const res = await fetch(`${API_BASE}/flashcards`);
      const data = await res.json();
      if (data.flashcards) {
        setFlashcards(data.flashcards);
      }
    } catch (err) {
      console.error("Failed to fetch flashcards", err);
    } finally {
      setLoadingInitial(false);
    }
  };

  useEffect(() => {
    fetchFlashcards();
  }, []);

  const handleGenerate = async () => {
    if (!sourceText.trim()) return;

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/flashcards/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: sourceText }),
      });
      const data = await res.json();
      if (data.flashcards) {
        setFlashcards(data.flashcards);
        setCurrentIndex(data.flashcards.length - data.added_count);
        setIsFlipped(false);
        setSourceText("");
      }
    } catch (err) {
      alert("Failed to generate flashcards.");
    } finally {
      setLoading(false);
    }
  };

  const nextCard = () => {
    setIsFlipped(false);
    setTimeout(() => {
      setCurrentIndex((prev) => (prev + 1) % flashcards.length);
    }, 150);
  };

  const prevCard = () => {
    setIsFlipped(false);
    setTimeout(() => {
      setCurrentIndex((prev) => (prev - 1 + flashcards.length) % flashcards.length);
    }, 150);
  };

  return (
    <div className="flex flex-col h-[85vh] glass-panel p-6 overflow-y-auto">
      <div className="flex items-center gap-2 pb-4 border-b border-[var(--border-color)]">
        <BookOpen className="w-5 h-5 text-indigo-400" />
        <h2 className="font-semibold text-lg gradient-text">Flashcards</h2>
      </div>

      {/* Generator Controls */}
      <div className="flex flex-col sm:flex-row gap-4 py-4 border-b border-[var(--border-color)]">
        <input
          type="text"
          value={sourceText}
          onChange={(e) => setSourceText(e.target.value)}
          placeholder="Paste some text to generate flashcards from..."
          className="flex-1 bg-[#1e293b]/80 border border-[var(--border-color)] rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
        />
        <button
          onClick={handleGenerate}
          disabled={loading || !sourceText.trim()}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-5 py-2 rounded-xl text-sm font-medium transition flex items-center justify-center gap-2 whitespace-nowrap"
        >
          {loading && <RefreshCw className="w-4 h-4 animate-spin" />}
          {loading ? "Generating..." : "Generate Cards"}
        </button>
      </div>

      {/* Flashcard Viewer */}
      <div className="flex-1 flex flex-col items-center justify-center py-8">
        {loadingInitial ? (
          <RefreshCw className="w-8 h-8 animate-spin text-indigo-500" />
        ) : flashcards.length === 0 ? (
          <div className="text-center text-gray-400">
            No flashcards yet. Generate some from text above!
          </div>
        ) : (
          <div className="w-full max-w-lg flex flex-col items-center gap-6">
            <div className="text-sm text-gray-400">
              Card {currentIndex + 1} of {flashcards.length}
            </div>

            {/* Flashcard */}
            <div
              className="relative w-full aspect-[3/2] cursor-pointer"
              style={{ perspective: "1000px" }}
              onClick={() => setIsFlipped(!isFlipped)}
            >
              <div
                className="w-full h-full relative transition-transform duration-500"
                style={{ transformStyle: "preserve-3d", transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)" }}
              >
                {/* Front */}
                <div 
                  className="absolute w-full h-full bg-[#1e293b]/80 border border-[var(--border-color)] rounded-2xl p-6 flex items-center justify-center text-center shadow-xl"
                  style={{ backfaceVisibility: "hidden" }}
                >
                  <h3 className="text-xl font-medium text-gray-100">
                    <ReactMarkdown>{flashcards[currentIndex].front}</ReactMarkdown>
                  </h3>
                </div>
                {/* Back */}
                <div 
                  className="absolute w-full h-full bg-indigo-950/40 border border-indigo-500/30 rounded-2xl p-6 flex items-center justify-center text-center shadow-xl"
                  style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
                >
                  <div className="text-lg text-indigo-200">
                    <ReactMarkdown>{flashcards[currentIndex].back}</ReactMarkdown>
                  </div>
                </div>
              </div>
            </div>

            {/* Navigation Controls */}
            <div className="flex items-center gap-4">
              <button
                onClick={prevCard}
                className="p-2 rounded-full bg-[#1e293b] border border-[var(--border-color)] hover:bg-gray-800 text-gray-300 transition"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <button
                onClick={() => setIsFlipped(!isFlipped)}
                className="px-6 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition shadow-lg shadow-indigo-500/25"
              >
                Flip
              </button>
              <button
                onClick={nextCard}
                className="p-2 rounded-full bg-[#1e293b] border border-[var(--border-color)] hover:bg-gray-800 text-gray-300 transition"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
