"use client";

import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { HelpCircle, CheckCircle2, XCircle, RefreshCw } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Question {
  id: number;
  question: string;
  options: string[];
  correct_answer: string;
  explanation: string;
}

export default function Quiz() {
  const [topic, setTopic] = useState("");
  const [numQuestions, setNumQuestions] = useState(5);
  const [loading, setLoading] = useState(false);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [userAnswers, setUserAnswers] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const handleGenerate = async () => {
    if (!topic.trim()) return;

    setLoading(true);
    setQuestions([]);
    setUserAnswers({});
    setSubmitted(false);

    try {
      const res = await fetch(`${API_BASE}/quiz`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          text_content: topic,
          num_questions: numQuestions,
          difficulty: "Medium",
        }),
      });

      const data = await res.json();
      if (data.questions) {
        setQuestions(data.questions);
      }
    } catch (err) {
      alert("Failed to generate quiz. Make sure the FastAPI backend is running!");
    } finally {
      setLoading(false);
    }
  };

  const calculateScore = () => {
    let score = 0;
    questions.forEach((q, idx) => {
      if (userAnswers[idx] === q.correct_answer) {
        score += 1;
      }
    });
    return score;
  };

  return (
    <div className="flex flex-col h-[85vh] glass-panel p-6 overflow-y-auto">
      <div className="flex items-center gap-2 pb-4 border-b border-[var(--border-color)]">
        <HelpCircle className="w-5 h-5 text-indigo-400" />
        <h2 className="font-semibold text-lg gradient-text">Quiz Generator</h2>
      </div>

      {/* Generator Controls */}
      <div className="flex flex-col sm:flex-row gap-4 py-4 border-b border-[var(--border-color)]">
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Enter any topic (e.g. Integration by Parts, Quantum Physics...)"
          className="flex-1 bg-[#1e293b]/80 border border-[var(--border-color)] rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
        />
        <select
          value={numQuestions}
          onChange={(e) => setNumQuestions(Number(e.target.value))}
          className="bg-[#1e293b] text-sm text-gray-200 border border-[var(--border-color)] rounded-xl px-3 py-2"
        >
          <option value={3}>3 Questions</option>
          <option value={5}>5 Questions</option>
          <option value={10}>10 Questions</option>
        </select>
        <button
          onClick={handleGenerate}
          disabled={loading || !topic.trim()}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-5 py-2 rounded-xl text-sm font-medium transition flex items-center justify-center gap-2"
        >
          {loading && <RefreshCw className="w-4 h-4 animate-spin" />}
          {loading ? "Generating..." : "Generate Quiz"}
        </button>
      </div>

      {/* Quiz Content */}
      <div className="py-4 space-y-6">
        {questions.length === 0 && !loading && (
          <div className="text-center py-12 text-gray-400">
            Enter a topic above to test your knowledge with AI-generated quizzes!
          </div>
        )}

        {questions.map((q, idx) => (
          <div key={idx} className="bg-[#1e293b]/40 border border-[var(--border-color)] rounded-2xl p-5 space-y-4">
            <h3 className="font-medium text-gray-100 flex items-start gap-2">
              <span className="text-indigo-400 font-bold">Q{idx + 1}.</span>
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                {q.question}
              </ReactMarkdown>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-6">
              {q.options.map((opt, oIdx) => {
                const isSelected = userAnswers[idx] === opt;
                const isCorrect = opt === q.correct_answer;
                let btnStyle = "bg-[#1e293b] border-gray-700 text-gray-300 hover:border-indigo-500";

                if (submitted) {
                  if (isCorrect) btnStyle = "bg-green-900/30 border-green-500 text-green-200";
                  else if (isSelected) btnStyle = "bg-red-900/30 border-red-500 text-red-200";
                } else if (isSelected) {
                  btnStyle = "bg-indigo-600/30 border-indigo-500 text-white";
                }

                return (
                  <button
                    key={oIdx}
                    onClick={() => !submitted && setUserAnswers((prev) => ({ ...prev, [idx]: opt }))}
                    className={`text-left p-3 rounded-xl border text-sm transition flex items-center justify-between ${btnStyle}`}
                  >
                    <span>{opt}</span>
                    {submitted && isCorrect && <CheckCircle2 className="w-4 h-4 text-green-400" />}
                    {submitted && isSelected && !isCorrect && <XCircle className="w-4 h-4 text-red-400" />}
                  </button>
                );
              })}
            </div>

            {submitted && (
              <div className="mt-3 p-3 bg-indigo-950/40 border border-indigo-500/30 rounded-xl text-xs text-indigo-200">
                <strong>Explanation:</strong> {q.explanation}
              </div>
            )}
          </div>
        ))}

        {questions.length > 0 && !submitted && (
          <button
            onClick={() => setSubmitted(true)}
            disabled={Object.keys(userAnswers).length < questions.length}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white py-3 rounded-xl font-medium transition"
          >
            Submit Quiz
          </button>
        )}

        {submitted && (
          <div className="p-4 bg-emerald-950/40 border border-emerald-500/30 rounded-2xl text-center">
            <h3 className="text-lg font-bold text-emerald-300">
              Your Score: {calculateScore()} / {questions.length}
            </h3>
          </div>
        )}
      </div>
    </div>
  );
}
