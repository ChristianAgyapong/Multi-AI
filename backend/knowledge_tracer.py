"""
Knowledge tracing — tracks what topics the student has asked about and how
they perform on quizzes, then feeds a personalised "student model" into
the tutor's system prompt for adaptive learning.

All state is in-memory per session (Streamlit session_state).
"""
from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class TopicStats:
    """Performance stats for one topic."""
    questions_asked: int = 0
    quiz_attempts: int = 0
    quiz_correct: int = 0
    quiz_total: int = 0

    @property
    def quiz_accuracy(self) -> Optional[float]:
        return self.quiz_correct / self.quiz_total if self.quiz_total > 0 else None

    @property
    def needs_review(self) -> bool:
        return self.quiz_accuracy is not None and self.quiz_accuracy < 0.6

    @property
    def mastery_level(self) -> str:
        if self.quiz_accuracy is None:
            return "not_assessed"
        if self.quiz_accuracy >= 0.9:
            return "mastered"
        if self.quiz_accuracy >= 0.7:
            return "progressing"
        return "needs_practice"


@dataclass
class StudentModel:
    """
    In-memory per-session student model.

    Usage:
        student = StudentModel()
        student.record_question("What is photosynthesis?")
        student.record_quiz_result("photosynthesis", correct=4, total=5)
        summary = student.get_summary()  # → str for system prompt
    """
    topic_stats: dict[str, TopicStats] = field(default_factory=lambda: defaultdict(TopicStats))
    interaction_count: int = 0
    _common_topics: set[str] = field(default_factory=lambda: {
        "photosynthesis", "algebra", "geometry", "calculus",
        "biology", "chemistry", "physics", "history",
        "literature", "grammar", "french", "programming",
        "quadratic", "mitochondria", "cell", "dna",
        "newton", "thermodynamics", "periodic", "verb",
        "equation", "derivative", "integral", "networking", "java"
    })
    flashcards: list[dict] = field(default_factory=list)
    _save_path: str = "data/student_profile.json"

    def __post_init__(self):
        self.load_from_disk()

    def save_to_disk(self):
        """Persist the student model to a JSON file."""
        import os
        import json
        os.makedirs(os.path.dirname(self._save_path), exist_ok=True)
        data = {
            "interaction_count": self.interaction_count,
            "flashcards": self.flashcards,
            "topic_stats": {
                k: {
                    "questions_asked": v.questions_asked,
                    "quiz_attempts": v.quiz_attempts,
                    "quiz_correct": v.quiz_correct,
                    "quiz_total": v.quiz_total
                } for k, v in self.topic_stats.items()
            }
        }
        with open(self._save_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

    def load_from_disk(self):
        """Load the student model from a JSON file if it exists."""
        import os
        import json
        if not os.path.exists(self._save_path):
            return
        try:
            with open(self._save_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            self.interaction_count = data.get("interaction_count", 0)
            self.flashcards = data.get("flashcards", [])
            topics = data.get("topic_stats", {})
            for k, v in topics.items():
                stats = TopicStats(
                    questions_asked=v.get("questions_asked", 0),
                    quiz_attempts=v.get("quiz_attempts", 0),
                    quiz_correct=v.get("quiz_correct", 0),
                    quiz_total=v.get("quiz_total", 0)
                )
                self.topic_stats[k] = stats
        except Exception as e:
            print(f"Failed to load student profile: {e}")

    # ── Question tracking ──────────────────────────────────────────────

    def extract_topics(self, text: str) -> list[str]:
        """Extract likely topic keywords from a question."""
        text_lower = text.lower()
        found = set()
        for topic in self._common_topics:
            if topic in text_lower:
                found.add(topic)
        # Also extract capitalized phrases (proper nouns, specific terms)
        phrases = re.findall(r'\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\b', text)
        for phrase in phrases:
            if len(phrase) > 3:
                found.add(phrase.lower())
        return sorted(found) if found else ["general"]

    def record_question(self, question: str) -> list[str]:
        """Record that the student asked about certain topics."""
        self.interaction_count += 1
        topics = self.extract_topics(question)
        for topic in topics:
            self.topic_stats[topic].questions_asked += 1
        self.save_to_disk()
        return topics

    def record_quiz_result(self, topic: str, correct: int, total: int):
        """Record a quiz result for a topic."""
        stats = self.topic_stats[topic.lower()]
        stats.quiz_attempts += 1
        stats.quiz_correct += correct
        stats.quiz_total += total
        self.save_to_disk()

    # ── Summary generation ─────────────────────────────────────────────

    def get_summary(self, max_topics: int = 5) -> str:
        """
        Return a short paragraph describing the student's knowledge state,
        suitable for injecting into the tutor's system prompt.
        """
        if self.interaction_count == 0:
            return ""

        lines = ["[Student Model]"]
        lines.append(f"You have had {self.interaction_count} interactions with this student.")

        # Topics needing most attention
        weak_topics = [
            (t, s) for t, s in self.topic_stats.items() if s.needs_review
        ]
        if weak_topics:
            weak_str = ", ".join(t for t, _ in weak_topics[:max_topics])
            lines.append(
                f"The student needs more practice on: {weak_str}. "
                f"Consider explaining fundamentals and giving simpler examples."
            )

        # Mastered topics
        mastered = [
            t for t, s in self.topic_stats.items()
            if s.mastery_level == "mastered"
        ]
        if mastered:
            lines.append(
                f"The student has mastered: {', '.join(mastered[:3])}. "
                f"You can move faster on these topics."
            )

        # Frequently asked topics
        freq_topics = sorted(
            [(t, s.questions_asked) for t, s in self.topic_stats.items()
             if s.quiz_accuracy is None],
            key=lambda x: -x[1]
        )[:3]
        if freq_topics:
            lines.append(
                f"The student has asked about: {', '.join(t for t, _ in freq_topics)}. "
                f"Be thorough and check for understanding."
            )

        return " ".join(lines)


# ── Quiz adaptation helper ──────────────────────────────────────────────

def adapt_quiz_difficulty(student: StudentModel, topic: str) -> str:
    """
    Return a difficulty modifier string for the quiz generation prompt
    based on the student's performance on this topic.
    """
    stats = student.topic_stats.get(topic.lower())
    if stats is None or stats.quiz_total < 2:
        return "standard"
    if stats.quiz_accuracy is None:
        return "standard"
    if stats.quiz_accuracy >= 0.8:
        return "hard"  # challenge them
    if stats.quiz_accuracy >= 0.6:
        return "standard"
    return "easy"

