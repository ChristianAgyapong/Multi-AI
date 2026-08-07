"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import { HelpCircle, CheckCircle2, XCircle, RefreshCw, Sparkles } from "lucide-react";
import { setStoredSessionId, withSessionHeaders } from "@/lib/session";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Question {
  id: number;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
}

const TOPIC_SUGGESTIONS = [
  "Calculus — derivatives",
  "World War II causes",
  "Cell biology basics",
  "Python data structures",
  "Shakespeare's Hamlet",
];

export default function Quiz() {
  const [topic, setTopic] = useState("");
  const [numQuestions, setNumQuestions] = useState(3);
  const [difficulty, setDifficulty] = useState<"easy" | "standard" | "hard">("standard");
  const [useContext, setUseContext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [userAnswers, setUserAnswers] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  const handleGenerate = async () => {
    if (!topic.trim() || loading) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setError(null);
    setLoading(true);
    setQuestions([]);
    setUserAnswers({});
    setSubmitted(false);

// Client-side timeout: scale with the number of questions so larger quizzes
    // (up to 30) have enough time to generate without a false timeout/crash.
    // Base ~20s + ~2.5s per question (30 → ~95s).
    const timeoutMs = 20000 + numQuestions * 2500;
    const timeoutId = window.setTimeout(() => {
      abortRef.current?.abort();
      setError("Quiz generation is taking too long. Try fewer questions or Easy difficulty.");
      setLoading(false);
    }, timeoutMs);

    try {
      const res = await fetch(`${API_BASE}/quiz`, {
        method: "POST",
        headers: withSessionHeaders({ "Content-Type": "application/json" }),
        signal: abortRef.current.signal,
        body: JSON.stringify({
          topic: topic.trim(),
          num_questions: numQuestions,
          difficulty,
          use_context: useContext,
        }),
      });
      window.clearTimeout(timeoutId);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setStoredSessionId(data.session_id);
      const quizData = data.quiz ?? data;
      if (quizData.questions) setQuestions(quizData.questions);
    } catch (err) {
      window.clearTimeout(timeoutId);
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to generate quiz. Make sure the FastAPI backend is running.");
    } finally {
      setLoading(false);
    }
  };

  const answeredCount = useMemo(() => Object.keys(userAnswers).length, [userAnswers]);
  const progressPct = useMemo(() => (questions.length > 0 ? (answeredCount / questions.length) * 100 : 0), [answeredCount, questions.length]);
  const score = useMemo(() => {
    let s = 0;
    questions.forEach((q, idx) => {
      if (userAnswers[idx] === q.options[q.correct_index]) s += 1;
    });
    return s;
  }, [questions, userAnswers]);
  const scorePct = useMemo(() => (questions.length > 0 ? (score / questions.length) * 100 : 0), [score, questions.length]);

  const scoreMessage = useMemo(() =>
    scorePct === 100 ? "Perfect score! You've mastered this topic." :
    scorePct >= 80 ? "Great job! Keep reviewing the tricky ones." :
    scorePct >= 60 ? "Good effort — review the explanations below." :
    "Keep studying — use Chat to go deeper on weak areas.",
  [scorePct]);

  useEffect(() => {
    if (questions.length > 0) {
      contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [questions]);

  return (
    <div className="quiz-shell flex flex-col h-full overflow-hidden">
      <div className="quiz-top-bar shrink-0 flex items-center justify-between px-4 py-2 border-b border-white/5">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
            <HelpCircle className="w-4 h-4 text-emerald-300" />
          </div>
          <h2 className="text-sm md:text-base font-semibold text-white">Quiz Generator</h2>
        </div>
        {questions.length > 0 && (
          <button
            onClick={() => { setQuestions([]); setUserAnswers({}); setSubmitted(false); setTopic(""); setError(null); }}
            className="text-xs text-emerald-300 hover:text-emerald-200 hover:bg-emerald-500/10 px-2.5 py-1.5 rounded-lg transition-colors"
          >
            New quiz
          </button>
        )}
      </div>

      {/* Controls */}
      <div className="quiz-controls shrink-0 px-4 py-3 border-b border-white/5 bg-transparent">
        <div className="quiz-controls-grid">
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
            placeholder="Enter a topic, such as integration by parts or cell biology"
            className="input-field quiz-topic-input"
          />

          <input
            type="number"
            min={1}
            max={30}
            value={numQuestions}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              setNumQuestions(Number.isNaN(val) ? 1 : Math.max(1, Math.min(30, val)));
            }}
            placeholder="Questions"
            className="input-field quiz-select"
            aria-label="Number of questions"
          />

          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as "easy" | "standard" | "hard")}
            className="input-field quiz-difficulty-select"
          >
            <option value="easy">Easy</option>
            <option value="standard">Medium</option>
            <option value="hard">Hard</option>
          </select>

          <button
            onClick={handleGenerate}
            disabled={loading || !topic.trim()}
            className="btn-primary quiz-generate-btn"
            style={{ background: "linear-gradient(135deg, #059669, #10b981)" }}
          >
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <HelpCircle className="w-4 h-4" />}
            {loading ? "Generating…" : "Generate"}
          </button>
        </div>

        <div className="flex items-center justify-between mt-2">
          <label className="flex items-center gap-2 text-xs text-[var(--text-muted)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={useContext}
              onChange={(e) => setUseContext(e.target.checked)}
              className="w-4 h-4 rounded border-gray-600 bg-slate-900 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-0"
            />
            Use my uploaded study materials
          </label>
          {loading && (
            <button
              onClick={handleCancel}
              className="text-xs text-red-300 hover:text-red-200 hover:bg-red-500/10 px-2.5 py-1.5 rounded-lg transition-colors"
              type="button"
            >
              Cancel
            </button>
          )}
        </div>

        {questions.length === 0 && !loading && (
          <div className="quiz-suggestions flex flex-wrap gap-2 mt-3">
            {TOPIC_SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => setTopic(s)} className="suggestion-chip text-[0.75rem] py-1.5">
                <Sparkles className="w-3 h-3" />
                {s}
              </button>
            ))}
          </div>
        )}

        {questions.length > 0 && !submitted && (
          <div className="quiz-progress mt-3">
            <div className="flex justify-between text-xs text-[var(--text-muted)] mb-1.5">
              <span>{answeredCount} of {questions.length} answered</span>
              <span>{Math.round(progressPct)}%</span>
            </div>
            <div className="progress-bar">
              <div className="progress-bar-fill" style={{ width: `${progressPct}%`, background: "linear-gradient(90deg, #059669, #34d399)" }} />
            </div>
          </div>
        )}

        {error && (
          <div className="mt-3 px-4 py-2.5 rounded-xl text-xs font-medium text-red-200 bg-red-500/10 border border-red-500/20">
            {error}
          </div>
        )}
      </div>

      {/* Content */}
      <div ref={contentRef} className="quiz-content flex-1 overflow-y-auto">
        {questions.length === 0 && !loading && (
          <div className="h-full flex flex-col items-center justify-center text-center px-4 text-gray-400 gap-3">
            <div className="empty-state-icon">
              <HelpCircle className="w-8 h-8 text-emerald-400" />
            </div>
            <h3 className="text-lg font-semibold text-white">Ready to test yourself?</h3>
            <p className="text-sm text-[var(--text-muted)] max-w-sm">
              Enter any topic above and get AI-generated practice questions with explanations.
            </p>
          </div>
        )}

        {loading && (
          <div className="h-full flex flex-col items-center justify-center text-center px-4 text-gray-400 gap-3">
            <RefreshCw className="w-10 h-10 animate-spin text-emerald-400" />
            <p className="text-sm text-[var(--text-muted)]">Crafting your quiz questions…</p>
          </div>
        )}

        {questions.length > 0 && (
          <div className="max-w-5xl lg:max-w-6xl xl:max-w-7xl mx-auto px-4 py-4 space-y-4">
            {questions.map((q, idx) => (
              <div
                key={idx}
                className="quiz-card rounded-2xl p-4 space-y-3 animate-fade-in-up"
                style={{ animationDelay: `${idx * 0.06}s` }}
              >
                <div className="quiz-card-head">
                  <div className="quiz-card-kicker">
                    <span className="quiz-card-kicker-index">Question {idx + 1}</span>
                    <span className="quiz-card-kicker-type">Multiple choice</span>
                  </div>
                </div>

                <h3 className="quiz-question font-medium text-gray-100 flex items-start gap-3">
                  <span className="quiz-question-index text-emerald-400 font-bold shrink-0">Q{idx + 1}.</span>
                  <span className="quiz-question-body prose-invert">
                    <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>
                      {q.question}
                    </ReactMarkdown>
                  </span>
                </h3>

                <div className="quiz-card-divider" />

                <div className="quiz-options grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {q.options.map((opt, oIdx) => {
                    const isSelected = userAnswers[idx] === opt;
                    const isCorrect = opt === q.options[q.correct_index];
                    let cls = "quiz-option";
                    if (submitted) {
                      if (isCorrect) cls += " correct";
                      else if (isSelected) cls += " incorrect";
                    } else if (isSelected) {
                      cls += " selected";
                    }

                    return (
                      <button
                        key={oIdx}
                        onClick={() => !submitted && setUserAnswers((prev) => ({ ...prev, [idx]: opt }))}
                        disabled={submitted}
                        className={`${cls} flex items-center justify-between gap-2`}
                      >
                        <span>{opt}</span>
                        {submitted && isCorrect && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
                        {submitted && isSelected && !isCorrect && <XCircle className="w-4 h-4 text-red-400 shrink-0" />}
                      </button>
                    );
                  })}
                </div>

                {submitted && (
                  <div className={`p-3.5 rounded-xl text-sm leading-relaxed border ${userAnswers[idx] === q.options[q.correct_index] ? "bg-emerald-950/30 border-emerald-500/25 text-emerald-100" : "bg-rose-950/30 border-rose-500/25 text-rose-100"}`}>
                    <div className="flex items-center gap-2 mb-2 font-medium">
                      {userAnswers[idx] === q.options[q.correct_index] ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          <span className="text-emerald-300">Correct — here is why</span>
                        </>
                      ) : (
                        <>
                          <XCircle className="w-4 h-4 text-rose-400" />
                          <span className="text-rose-300">Not quite — here is why</span>
                        </>
                      )}
                    </div>
                    <div className="prose-invert prose-sm">
                      <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>
                        {q.explanation}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {questions.length > 0 && !submitted && (
              <button
                onClick={() => setSubmitted(true)}
                disabled={answeredCount < questions.length}
                className="quiz-submit-btn w-full btn-primary py-3.5"
                style={{ background: "linear-gradient(135deg, #059669, #10b981)" }}
              >
                <CheckCircle2 className="w-4 h-4" />
                Submit Quiz ({answeredCount}/{questions.length})
              </button>
            )}

            {submitted && (
              <div className="quiz-result animate-fade-in-up">
                <div className="quiz-result-grid">
                  <div className="quiz-result-score">
                    <div className="score-ring mx-auto">
                      <svg width="120" height="120" viewBox="0 0 120 120">
                        <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
                        <circle
                          cx="60" cy="60" r="52" fill="none"
                          stroke="#34d399" strokeWidth="8"
                          strokeLinecap="round"
                          strokeDasharray={`${(scorePct / 100) * 327} 327`}
                        />
                      </svg>
                      <div className="score-ring-label">
                        <span className="text-2xl font-bold text-emerald-300">{score}/{questions.length}</span>
                        <span className="text-xs text-emerald-400/80">{Math.round(scorePct)}%</span>
                      </div>
                    </div>
                  </div>

                  <div className="quiz-result-copy">
                    <span className="quiz-result-kicker">Quiz complete</span>
                    <h3 className="quiz-result-title">{scoreMessage}</h3>
                    <p className="quiz-result-body text-sm text-[var(--text-muted)]">
                      Review the explanations above or try a related topic to reinforce what you missed.
                    </p>

                    <button
                      onClick={handleGenerate}
                      className="quiz-try-again btn-primary text-sm"
                      style={{ background: "linear-gradient(135deg, #059669, #10b981)" }}
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Try Again
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
