"use client";

import React, { useState, useEffect } from "react";
import {
  Wifi,
  BookOpen,
  User,
  Upload,
  Trash2,
  CheckCircle2,
  XCircle,
  Sparkles,
  GraduationCap,
  ChevronDown,
  FileText,
  Layers,
} from "lucide-react";
import { setStoredSessionId, withSessionHeaders } from "@/lib/session";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface ProviderStatus {
  provider: string;
  connected: boolean;
  message?: string;
}

interface Profile {
  interaction_count: number;
  summary: string;
}

interface MaterialsStats {
  sources: string[];
  total_chunks: number;
}

function CollapsibleSection({
  title,
  icon: Icon,
  badge,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon: React.ElementType;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="sidebar-section">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="sidebar-section-header"
      >
        <span className="flex items-center gap-2">
          <Icon size={14} className="text-indigo-400" />
          <span className="sidebar-section-title">{title}</span>
        </span>
        <span className="flex items-center gap-2">
          {badge}
          <ChevronDown
            size={14}
            className={`text-[var(--text-dim)] transition-transform duration-200 ${
              open ? "" : "-rotate-90"
            }`}
          />
        </span>
      </button>
      {open && (
        <div className="sidebar-section-body animate-fade-in-up">{children}</div>
      )}
    </div>
  );
}

export default function Sidebar({ onStartSession }: { onStartSession?: () => void }) {
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [materials, setMaterials] = useState<MaterialsStats | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const [provRes, profRes, matRes] = await Promise.all([
        fetch(`${API_BASE}/provider/status`, { headers: withSessionHeaders() }),
        fetch(`${API_BASE}/student/profile`, { headers: withSessionHeaders() }),
        fetch(`${API_BASE}/materials`, { headers: withSessionHeaders() }),
      ]);
      setProvider(await provRes.json());
      setProfile(await profRes.json());
      const materialsData = await matRes.json();
      setMaterials(materialsData);
      setStoredSessionId(materialsData.session_id);
    } catch {
      // Backend offline — keep last known state
    }
  };

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void fetchData();
    }, 0);
    const interval = setInterval(() => { void fetchData(); }, 15000);
    return () => {
      window.clearTimeout(initialLoad);
      clearInterval(interval);
    };
  }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch(`${API_BASE}/materials`, {
        method: "POST",
        headers: withSessionHeaders(),
        body: formData,
      });
      const data = await res.json();
      setStoredSessionId(data.session_id);
      void fetchData();
    } catch {
      setError("Failed to upload material.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleDelete = async (filename: string) => {
    setError(null);
    try {
      await fetch(`${API_BASE}/materials?filename=${encodeURIComponent(filename)}`, {
        method: "DELETE",
        headers: withSessionHeaders(),
      });
      void fetchData();
    } catch {
      setError("Failed to delete material.");
    }
  };

  const interactionCount = profile?.interaction_count ?? 0;
  const studyLevel =
    interactionCount >= 50 ? "Advanced" : interactionCount >= 20 ? "Intermediate" : interactionCount >= 5 ? "Getting Started" : "New Learner";

  const fileCount = materials?.sources?.length ?? 0;

  const providerLabel = provider?.provider || "Provider unavailable";

  return (
    <div className="sidebar-shell flex flex-col gap-4 h-full">
      <div className="glass-panel sidebar-main flex-1 h-full rounded-[24px] overflow-hidden flex flex-col shadow-[0_12px_40px_rgba(0,0,0,0.3)] backdrop-blur-3xl border border-white/10">
        <div className="sidebar-header border-b border-white/5 bg-black/20">
          <div className="sidebar-brand-mark p-2.5 rounded-xl bg-indigo-500/20 border border-indigo-500/40 shadow-[0_0_15px_rgba(99,102,241,0.2)] flex items-center justify-center shrink-0">
            <GraduationCap size={20} className="text-indigo-400" />
          </div>
          <div className="min-w-0 flex-1 ml-1">
            <p className="text-sm font-semibold text-white leading-tight">Study Dashboard</p>
            <p className="text-[0.65rem] text-[var(--text-muted)] truncate">
              Fast access to materials, progress, and support
            </p>
          </div>
        </div>

        <div className="px-4 pb-3">
          <button
            type="button"
            onClick={onStartSession}
            className="sidebar-primary-action sidebar-primary-action-compact"
          >
            <Sparkles size={16} />
            <span>Start guided session</span>
          </button>
        </div>

        <div className="px-4 pb-3">
          <div className="sidebar-status-row">
            <span className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <Wifi size={14} className="text-[var(--text-dim)]" />
              AI Connection
            </span>
            <div className="flex items-center gap-2 min-w-0">
              <span className={`sidebar-status-pill ${provider?.connected ? "online" : "offline"}`}>
                {provider?.connected ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                {provider?.connected ? "Online" : "Offline"}
              </span>
              <span className="text-[0.72rem] text-[var(--text-muted)] truncate max-w-[7rem]" title={providerLabel}>
                {providerLabel}
              </span>
            </div>
          </div>
        </div>

        <div className="sidebar-divider" />

        <div className="sidebar-body px-3 pb-3 space-y-3">
          {/* Study Materials */}
          <CollapsibleSection
            title="Study Materials"
            icon={BookOpen}
            badge={
              fileCount > 0 ? (
                <span className="sidebar-badge">{fileCount}</span>
              ) : undefined
            }
          >
            <p className="text-xs text-[var(--text-muted)] mb-3 leading-relaxed">
              Upload PDFs, notes, or slides so answers stay grounded in your class content.
            </p>

            {materials?.sources && materials.sources.length > 0 && (
              <>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[0.65rem] text-[var(--text-dim)] uppercase tracking-wide">
                    {materials.sources.length} file{materials.sources.length !== 1 ? "s" : ""}
                  </span>
                  {materials.total_chunks > 0 && (
                    <span className="text-[0.65rem] text-indigo-400 flex items-center gap-1">
                      <Layers size={11} />
                      {materials.total_chunks} chunks
                    </span>
                  )}
                </div>
                {error && (
                <div className="mb-3 px-3 py-2 rounded-lg text-[0.75rem] font-medium text-red-200 bg-red-500/10 border border-red-500/20">
                  {error}
                </div>
              )}

              <div className="max-h-28 overflow-y-auto flex flex-col gap-1 mb-3">
                  {materials.sources.map((src) => (
                    <div key={src} className="sidebar-file-row flex justify-between items-center gap-2 group">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <FileText size={12} className="text-indigo-400 shrink-0" />
                        <span
                          className="text-[0.72rem] text-[var(--text-main)] truncate"
                          title={src}
                        >
                          {src}
                        </span>
                      </div>
                      <button
                        onClick={() => handleDelete(src)}
                        className="opacity-100 md:opacity-0 md:group-hover:opacity-100 p-0.5 text-[var(--text-dim)] hover:text-red-400 transition-all shrink-0"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}

            <label
              className={`sidebar-upload-btn flex items-center justify-center gap-2 w-full py-2.5 rounded-lg text-xs font-medium cursor-pointer transition-all ${
                uploading
                  ? "opacity-60 cursor-wait"
                  : "hover:brightness-110 active:scale-[0.98]"
              }`}
              style={{
                background: "rgba(99,102,241,0.12)",
                border: "1px dashed rgba(99,102,241,0.4)",
                color: "#a5b4fc",
              }}
            >
              <Upload size={14} />
              {uploading ? "Uploading…" : "Upload Document"}
              <input
                type="file"
                accept=".txt,.md,.pdf,.docx,.pptx"
                className="hidden"
                onChange={handleUpload}
                disabled={uploading}
              />
            </label>
          </CollapsibleSection>

          {/* Learning Profile */}
          <CollapsibleSection title="Learning Profile" icon={User}>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="sidebar-metric-card text-center">
                <p className="sidebar-metric-value text-indigo-300">{interactionCount}</p>
                <p className="text-[0.65rem] text-[var(--text-dim)] mt-0.5">Sessions</p>
              </div>
              <div className="sidebar-metric-card text-center">
                <p className="sidebar-metric-value text-purple-300 truncate" title={studyLevel}>{studyLevel}</p>
                <p className="text-[0.65rem] text-[var(--text-dim)] mt-0.5">Level</p>
              </div>
            </div>

            <div className="sidebar-summary-card flex items-start gap-2 rounded-lg p-3">
              <User size={14} className="text-purple-400 shrink-0 mt-0.5" />
              <p className="text-xs text-[var(--text-muted)] leading-relaxed line-clamp-4" title={profile?.summary?.replace("[Student Model] ", "") || ""}>
                {profile?.summary?.replace("[Student Model] ", "") ||
                  "Ask a few questions so the tutor can adapt to your pace and topic."}
              </p>
            </div>
          </CollapsibleSection>
        </div>
      </div>
    </div>
  );
}
