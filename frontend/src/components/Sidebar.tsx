"use client";

import React, { useState, useEffect } from "react";
import { Server, Database, User, FileText, Upload, Trash2, CheckCircle2, XCircle } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface ProviderStatus {
  provider: string;
  connected: boolean;
  message: string;
}

interface CacheStats {
  size: number;
  max_size: number;
  items: number;
  cache_size_bytes?: number;
}

interface StudentProfile {
  interaction_count: number;
  summary: string;
}

interface MaterialsStats {
  sources: string[];
  total_chunks: number;
}

export default function Sidebar() {
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [cache, setCache] = useState<CacheStats | null>(null);
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [materials, setMaterials] = useState<MaterialsStats | null>(null);
  const [uploading, setUploading] = useState(false);

  const fetchData = async () => {
    try {
      const [provRes, cacheRes, profRes, matRes] = await Promise.all([
        fetch(`${API_BASE}/provider/status`),
        fetch(`${API_BASE}/cache/stats`),
        fetch(`${API_BASE}/student/profile`),
        fetch(`${API_BASE}/materials`),
      ]);

      setProvider(await provRes.json());
      setCache(await cacheRes.json());
      setProfile(await profRes.json());
      setMaterials(await matRes.json());
    } catch (err) {
      console.error("Failed to fetch sidebar data", err);
    }
  };

  useEffect(() => {
    fetchData();
    // Refresh stats every 10 seconds
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      await fetch(`${API_BASE}/materials`, {
        method: "POST",
        body: formData,
      });
      fetchData(); // Refresh materials list
    } catch (err) {
      alert("Failed to upload material.");
    } finally {
      setUploading(false);
      e.target.value = ""; // Reset input
    }
  };

  const handleDeleteMaterial = async (filename: string) => {
    try {
      await fetch(`${API_BASE}/materials?filename=${encodeURIComponent(filename)}`, {
        method: "DELETE",
      });
      fetchData(); // Refresh materials list
    } catch (err) {
      alert("Failed to delete material.");
    }
  };

  return (
    <div className="w-full md:w-64 flex-shrink-0 flex flex-col gap-4">
      {/* System Status */}
      <div className="glass-panel p-4">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Server className="w-4 h-4" /> System Status
        </h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-300">LLM Provider</span>
            <div className="flex items-center gap-1.5">
              {provider?.connected ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <XCircle className="w-3.5 h-3.5 text-red-400" />
              )}
              <span className="text-gray-100 font-medium capitalize">
                {provider?.provider || "Loading..."}
              </span>
            </div>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-300">Cache</span>
            <div className="flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-indigo-400" />
              <span className="text-gray-100 font-medium">
                {cache ? `${cache.items} items` : "..."}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Knowledge Base */}
      <div className="glass-panel p-4">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
          <FileText className="w-4 h-4" /> Knowledge Base
        </h3>
        <div className="space-y-3">
          <div className="text-xs text-gray-400">
            {materials?.total_chunks || 0} extracted chunks
          </div>
          
          <div className="max-h-32 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
            {materials?.sources?.map((src) => (
              <div key={src} className="flex items-center justify-between bg-[#1e293b]/50 rounded p-1.5">
                <span className="text-xs text-gray-300 truncate max-w-[140px]" title={src}>
                  {src}
                </span>
                <button
                  onClick={() => handleDeleteMaterial(src)}
                  className="text-gray-500 hover:text-red-400 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          <label className="flex items-center justify-center gap-2 w-full bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 py-2 rounded-lg text-xs font-medium cursor-pointer transition">
            <Upload className="w-3.5 h-3.5" />
            {uploading ? "Uploading..." : "Upload Document"}
            <input type="file" accept=".txt,.md,.pdf,.docx,.pptx" className="hidden" onChange={handleUpload} disabled={uploading} />
          </label>
        </div>
      </div>

      {/* Student Profile */}
      <div className="glass-panel p-4 flex-1">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
          <User className="w-4 h-4" /> Your Profile
        </h3>
        <div className="space-y-3">
          <div className="text-xs text-gray-300 bg-[#1e293b]/50 p-2 rounded border border-[var(--border-color)]">
            <span className="font-medium text-indigo-300">{profile?.interaction_count || 0}</span> interactions
          </div>
          <div className="text-xs text-gray-400 italic line-clamp-6 leading-relaxed">
            {profile?.summary || "Ask some questions so the tutor can learn about you!"}
          </div>
        </div>
      </div>
    </div>
  );
}
