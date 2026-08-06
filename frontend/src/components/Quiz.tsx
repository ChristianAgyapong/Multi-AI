"use client";

import React, { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
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
  const [numQuestions, setNumQuestions] = useState(5);
  const [loading, setLoading] = useState(false);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [userAnswers, setUserAnswers] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const handleGenerate = async () => {
    if (!topic.trim()) return;
    setLoading(true);
    setQuestions([]);
    setUserAnswers({});
    setSubmitted(false);

    try {
      const res = await fetch(`${API_BASE}/quiz`, {
        method: "POST",
        headers: withSessionHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          topic,
          text_content: topic,
          num_questions: numQuestions,
          difficulty: "Medium",
        }),
      });
      const data = await res.json();
      setStoredSessionId(data.session_id);
      const quizData = data.quiz ?? data;
      if (quizData.questions) setQuestions(quizData.questions);
    } catch {
      alert("Failed to generate quiz. Make sure the FastAPI backend is running!");
    } finally {
      setLoading(false);
    }
  };

const calculateScore = () => {
    let score = 0;
    questions.forEach((q, idx) => {
      if (userAnswers[idx] === q.options[q.correct_index]) score += 1;
    });
    return score;
  };

  const answeredCount = Object.keys(userAnswers).length;
  const progressPct = questions.length > 0 ? (answeredCount / questions.length) * 100 : 0;
  const score = calculateScore();
  const scorePct = questions.length > 0 ? (score / questions.length) * 100 : 0;

  const scoreMessage =
    scorePct === 100 ? "Perfect score! You've mastered this topic." :
    scorePct >= 80 ? "Great job! Keep reviewing the tricky ones." :
    scorePct >= 60 ? "Good effort — review the explanations below." :
    "Keep studying — use Chat to go deeper on weak areas.";

  useEffect(() => {
    if (questions.length > 0) {
      contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [questions]);

  return (
    <div className="quiz-shell flex flex-col h-full glass-panel overflow-hidden">
      <div className="quiz-header shrink-0">
        <div className="flex items-start gap-3 min-w-0">
          <div className="quiz-icon-wrap">
            <HelpCircle className="w-5 h-5 text-emerald-300" />
          </div>
          <div className="min-w-0">
            <h2 className="quiz-title">Quiz Generator</h2>
            <p className="quiz-subtitle">Practice and test what you know</p>
          </div>
        </div>

        <div className="quiz-header-meta">
          <div className="quiz-meta-chip">
            <span className="quiz-meta-label">Topic</span>
            <span className="quiz-meta-value truncate">{topic.trim() || "Not set"}</span>
          </div>
          <div className="quiz-meta-chip">
            <span className="quiz-meta-label">Questions</span>
            <span className="quiz-meta-value">{numQuestions}</span>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="quiz-controls shrink-0">
        <div className="quiz-controls-grid">
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
            placeholder="Enter a topic, such as integration by parts or cell biology"
            className="input-field quiz-topic-input"
          />

          <select
            value={numQuestions}
            onChange={(e) => setNumQuestions(Number(e.target.value))}
            className="input-field quiz-select"
          >
            <option value={3}>3 Questions</option>
            <option value={5}>5 Questions</option>
            <option value={10}>10 Questions</option>
          </select>

          <button
            onClick={handleGenerate}
            disabled={loading || !topic.trim()}
            className="btn-primary quiz-generate-btn"
            style={{ background: "linear-gradient(135deg, #059669, #10b981)" }}
          >
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <HelpCircle className="w-4 h-4" />}
            {loading ? "Generating…" : "Generate Quiz"}
          </button>
        </div>

        {questions.length === 0 && !loading && (
          <div className="quiz-suggestions flex flex-wrap gap-2 mt-4">
            {TOPIC_SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => setTopic(s)} className="suggestion-chip text-[0.75rem] py-1.5">
                <Sparkles className="w-3 h-3" />
                {s}
              </button>
            ))}
          </div>
        )}

        {questions.length > 0 && !submitted && (
          <div className="quiz-progress mt-4">
            <div className="flex justify-between text-xs text-[var(--text-muted)] mb-1.5">
              <span>{answeredCount} of {questions.length} answered</span>
              <span>{Math.round(progressPct)}%</span>
            </div>
            <div className="progress-bar">
              <div className="progress-bar-fill" style={{ width: `${progressPct}%`, background: "linear-gradient(90deg, #059669, #34d399)" }} />
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <div ref={contentRef} className="quiz-content flex-1 overflow-y-auto px-5 py-4 space-y-6">
        {questions.length === 0 && !loading && (
          <div className="quiz-empty empty-state h-full">
            <div className="empty-state-icon">
              <HelpCircle className="w-8 h-8 text-emerald-400" />
            </div>
            <h3 className="text-lg font-semibold text-white">Ready to test yourself?</h3>
            <p className="text-sm text-[var(--text-muted)] max-w-sm">
              Enter any topic above and get instant AI-generated practice questions with detailed explanations.
            </p>
          </div>
        )}

        {loading && (
          <div className="quiz-loading empty-state h-full">
            <RefreshCw className="w-10 h-10 animate-spin text-emerald-400" />
            <p className="text-sm text-[var(--text-muted)]">Crafting your quiz questions…</p>
          </div>
        )}

        {questions.map((q, idx) => (
          <div
            key={idx}
            className="quiz-card bg-slate-800/30 border border-[var(--border-color)] rounded-2xl p-5 space-y-4 animate-fade-in-up"
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
              <span className="quiz-question-body">
                <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                  {q.question}
                </ReactMarkdown>
              </span>
            </h3>

            <div className="quiz-card-divider" />

            <div className="quiz-options grid grid-cols-1 md:grid-cols-2 gap-2.5 pl-0 md:pl-4">
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
              <div className="mt-2 p-3.5 bg-emerald-950/30 border border-emerald-500/25 rounded-xl text-sm text-emerald-100 leading-relaxed">
                <strong className="text-emerald-300">Explanation: </strong>
                {q.explanation}
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
                  Review the explanations below or try a related topic to reinforce what you missed.
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
    </div>
  );
}
