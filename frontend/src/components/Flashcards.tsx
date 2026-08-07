"use client";

import React, { useState, useEffect } from "react";
import { BookOpen, RefreshCw, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";

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
  const [studied, setStudied] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    fetch(`${API_BASE}/flashcards`)
      .then((res) => res.json())
      .then((data) => {
        if (!ignore && data.flashcards) setFlashcards(data.flashcards);
      })
      .catch(() => setError("Could not load flashcards. The AI server may be offline."))
      .finally(() => {
        if (!ignore) setLoadingInitial(false);
      });
    return () => { ignore = true; };
  }, []);

  // Keyboard navigation: arrows move between cards, space flips.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName)) return;
      if (flashcards.length === 0) return;

      if (e.key === "ArrowRight") {
        setStudied((prev) => new Set(prev).add(currentIndex));
        setIsFlipped(false);
        setTimeout(() => {
          setCurrentIndex((i) => (i + 1) % flashcards.length);
        }, 150);
      } else if (e.key === "ArrowLeft") {
        setIsFlipped(false);
        setTimeout(() => {
          setCurrentIndex((i) => (i - 1 + flashcards.length) % flashcards.length);
        }, 150);
      } else if (e.key === " ") {
        e.preventDefault();
        setIsFlipped((f) => !f);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [flashcards.length, currentIndex]);

  const handleGenerate = async () => {
    if (!sourceText.trim()) return;
    setError(null);
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
        setStudied(new Set());
      }
    } catch {
      setError("Failed to generate flashcards.");
    } finally {
      setLoading(false);
    }
  };

  const markStudied = () => {
    setStudied((prev) => new Set(prev).add(currentIndex));
  };

  const nextCard = () => {
    markStudied();
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

  const progressPct = flashcards.length > 0 ? (studied.size / flashcards.length) * 100 : 0;

  return (
    <div className="flex flex-col h-full glass-panel overflow-hidden">
      <div className="panel-header px-5 pt-5 shrink-0">
        <BookOpen className="w-5 h-5 text-amber-400" />
        <div>
          <h2 className="gradient-text">Flashcards</h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">Flip, review, and memorize key concepts</p>
        </div>
      </div>

      {/* Generator */}
      <div className="px-5 py-4 border-b border-[var(--border-color)] shrink-0">
        <div className="max-w-3xl lg:max-w-4xl mx-auto">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
              placeholder="Paste lecture notes or text to generate flashcards…"
              className="input-field flex-1"
            />
            <button
              onClick={handleGenerate}
              disabled={loading || !sourceText.trim()}
              className="btn-primary shrink-0 whitespace-nowrap"
              style={{ background: "linear-gradient(135deg, #d97706, #f59e0b)" }}
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {loading ? "Generating…" : "Generate Cards"}
            </button>
          </div>

          {error && (
            <div className="mt-3 px-4 py-2.5 rounded-xl text-xs font-medium text-red-200 bg-red-500/10 border border-red-500/20">
              {error}
            </div>
          )}

          {flashcards.length > 0 && (
            <div className="mt-3">
              <div className="flex justify-between text-xs text-[var(--text-muted)] mb-1.5">
                <span>Card {currentIndex + 1} of {flashcards.length}</span>
                <span>{studied.size} reviewed · {Math.round(progressPct)}%</span>
              </div>
              <div className="progress-bar">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${progressPct}%`, background: "linear-gradient(90deg, #d97706, #fbbf24)" }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Viewer */}
      <div className="flex-1 flex flex-col items-center justify-center py-6 px-5 overflow-y-auto">
        {loadingInitial ? (
          <RefreshCw className="w-10 h-10 animate-spin text-amber-400" />
        ) : flashcards.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <BookOpen className="w-8 h-8 text-amber-400" />
            </div>
            <h3 className="text-lg font-semibold text-white">No flashcards yet</h3>
            <p className="text-sm text-[var(--text-muted)] max-w-sm">
              Paste your study notes above and AI will create flip cards to help you memorize key facts.
            </p>
          </div>
        ) : (
          <div className="w-full max-w-lg flex flex-col items-center gap-6">
            {/* Card */}
            <div
              className="relative w-full aspect-[5/3] cursor-pointer perspective-1000 flashcard-hint"
              onClick={() => setIsFlipped(!isFlipped)}
            >
              <div
                className="w-full h-full relative transition-transform duration-500"
                style={{
                  transformStyle: "preserve-3d",
                  transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
                }}
              >
                {/* Front */}
                <div
                  className="absolute w-full h-full rounded-2xl p-6 flex flex-col items-center justify-center text-center shadow-xl"
                  style={{
                    backfaceVisibility: "hidden",
                    background: "linear-gradient(145deg, rgba(30,41,59,0.9) 0%, rgba(15,23,42,0.95) 100%)",
                    border: "1px solid rgba(245, 158, 11, 0.2)",
                  }}
                >
                  <span className="text-[0.65rem] uppercase tracking-widest text-amber-400/70 mb-3 font-semibold">
                    Question
                  </span>
                  <div className="text-lg md:text-xl font-medium text-gray-100 prose prose-invert max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>
                      {flashcards[currentIndex].front}
                    </ReactMarkdown>
                  </div>
                  <p className="text-[0.65rem] text-[var(--text-dim)] mt-4">Click to reveal answer</p>
                </div>

                {/* Back */}
                <div
                  className="absolute w-full h-full rounded-2xl p-6 flex flex-col items-center justify-center text-center shadow-xl"
                  style={{
                    backfaceVisibility: "hidden",
                    transform: "rotateY(180deg)",
                    background: "linear-gradient(145deg, rgba(120,53,15,0.4) 0%, rgba(30,41,59,0.9) 100%)",
                    border: "1px solid rgba(245, 158, 11, 0.35)",
                  }}
                >
                  <span className="text-[0.65rem] uppercase tracking-widest text-amber-300/70 mb-3 font-semibold">
                    Answer
                  </span>
                  <div className="text-base md:text-lg text-amber-100 prose prose-invert max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>
                      {flashcards[currentIndex].back}
                    </ReactMarkdown>
                  </div>
                </div>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-3">
              <button
                onClick={prevCard}
                className="p-2.5 rounded-full bg-slate-800/80 border border-[var(--border-color)] hover:bg-slate-700 text-gray-300 transition active:scale-95"
                title="Previous card"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>

              <button
                onClick={() => setIsFlipped(!isFlipped)}
                className="px-6 py-2.5 rounded-xl font-semibold text-white transition active:scale-95 flex items-center gap-2"
                style={{
                  background: "linear-gradient(135deg, #d97706, #f59e0b)",
                  boxShadow: "0 4px 14px rgba(245, 158, 11, 0.3)",
                }}
              >
                <RefreshCw className="w-4 h-4" />
                Flip
              </button>

              <button
                onClick={nextCard}
                className="p-2.5 rounded-full bg-slate-800/80 border border-[var(--border-color)] hover:bg-slate-700 text-gray-300 transition active:scale-95"
                title="Next card"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>

            <p className="text-[0.65rem] text-[var(--text-dim)]">
              Tip: ← → arrow keys navigate, Space flips, or click the card
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
