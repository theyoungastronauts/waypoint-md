"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import { cn } from "@/lib/utils";

interface ProjectOption {
  id: string;
  name: string;
}

interface NewDocumentFormProps {
  projects: ProjectOption[];
  pathDoorEnabled: boolean;
}

type Door = "upload" | "paste" | "path" | "url";

const TABS: Array<{ id: Door; label: string }> = [
  { id: "upload", label: "Upload" },
  { id: "paste", label: "Paste" },
  { id: "path", label: "Path" },
  { id: "url", label: "URL" },
];

const inputClass =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

interface ApiErrorBody {
  error?: { message?: string };
}

export function NewDocumentForm({ projects, pathDoorEnabled }: NewDocumentFormProps) {
  const router = useRouter();
  const [tab, setTab] = useState<Door>("upload");

  // Shared metadata across all doors.
  const [projectId, setProjectId] = useState("");
  const [newProject, setNewProject] = useState("");
  const [title, setTitle] = useState("");

  // Per-door inputs.
  const [file, setFile] = useState<File | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [path, setPath] = useState("");
  const [url, setUrl] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const projectFields = useCallback(() => {
    const name = newProject.trim();
    if (name) return { project: name };
    if (projectId) return { projectId };
    return {};
  }, [newProject, projectId]);

  const finish = useCallback(
    async (res: Response) => {
      const data = (await res.json().catch(() => ({}))) as ApiErrorBody & { url?: string };
      if (!res.ok) {
        setError(data.error?.message ?? `Import failed (HTTP ${res.status}).`);
        setSubmitting(false);
        return;
      }
      if (data.url) {
        router.push(data.url);
        router.refresh();
      }
    },
    [router],
  );

  const submitJson = useCallback(
    async (payload: Record<string, unknown>) => {
      setSubmitting(true);
      setError(null);
      try {
        const res = await fetch("/api/documents", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...payload, ...projectFields(), ...(title.trim() ? { title: title.trim() } : {}) }),
        });
        await finish(res);
      } catch {
        setError("Could not reach the server.");
        setSubmitting(false);
      }
    },
    [finish, projectFields, title],
  );

  const submitUpload = useCallback(async () => {
    if (!file) {
      setError("Choose a file first.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const fields = projectFields();
      if ("project" in fields && fields.project) form.set("project", fields.project);
      if ("projectId" in fields && fields.projectId) form.set("projectId", fields.projectId);
      if (title.trim()) form.set("title", title.trim());
      const res = await fetch("/api/documents", { method: "POST", body: form });
      await finish(res);
    } catch {
      setError("Could not reach the server.");
      setSubmitting(false);
    }
  }, [file, finish, projectFields, title]);

  const onSubmit = useCallback(() => {
    switch (tab) {
      case "upload":
        return submitUpload();
      case "paste":
        return submitJson({ markdown });
      case "path":
        return submitJson({ path });
      case "url":
        return submitJson({ url });
    }
  }, [tab, submitUpload, submitJson, markdown, path, url]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) setFile(dropped);
  }, []);

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border border-border p-1" role="tablist">
        {TABS.map((t) => {
          const disabled = t.id === "path" && !pathDoorEnabled;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              disabled={disabled}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                tab === t.id ? "bg-primary text-primary-foreground" : "hover:bg-accent",
                disabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
              )}
              title={disabled ? "Set WAYPOINT_ALLOWED_ROOTS to enable the path door" : undefined}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Shared metadata */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Project</span>
          <select
            className={inputClass}
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            disabled={newProject.trim().length > 0}
          >
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Or new project</span>
          <input
            className={inputClass}
            placeholder="Project name"
            value={newProject}
            onChange={(e) => setNewProject(e.target.value)}
          />
        </label>
      </div>
      <label className="block space-y-1 text-sm">
        <span className="text-muted-foreground">Title (optional)</span>
        <input
          className={inputClass}
          placeholder="Defaults to the document's frontmatter or first heading"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>

      {/* Door panels */}
      {tab === "upload" && (
        <div>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-6 py-12 text-center transition-colors",
              dragOver ? "border-ring bg-accent/50" : "border-border hover:bg-accent/30",
            )}
          >
            <p className="text-sm font-medium">
              {file ? file.name : "Drop a .md / .markdown / .txt file here"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">or click to choose a file</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.markdown,.txt,text/markdown,text/plain"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </div>
      )}

      {tab === "paste" && (
        <textarea
          className={cn(inputClass, "min-h-64 font-mono")}
          placeholder="Paste raw markdown here"
          value={markdown}
          onChange={(e) => setMarkdown(e.target.value)}
        />
      )}

      {tab === "path" &&
        (pathDoorEnabled ? (
          <label className="block space-y-1 text-sm">
            <span className="text-muted-foreground">Server file path</span>
            <input
              className={cn(inputClass, "font-mono")}
              placeholder="/path/under/an/allowed/root/plan.md"
              value={path}
              onChange={(e) => setPath(e.target.value)}
            />
            <span className="text-xs text-muted-foreground">
              Reads are restricted to files under WAYPOINT_ALLOWED_ROOTS.
            </span>
          </label>
        ) : (
          <div className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
            The path door is disabled. Set{" "}
            <code className="rounded bg-muted px-1 py-0.5">WAYPOINT_ALLOWED_ROOTS</code> on the
            server to read files by path.
          </div>
        ))}

      {tab === "url" && (
        <label className="block space-y-1 text-sm">
          <span className="text-muted-foreground">Document URL</span>
          <input
            className={cn(inputClass, "font-mono")}
            placeholder="https://raw.githubusercontent.com/…/plan.md"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <span className="text-xs text-muted-foreground">
            Text content only, 1 MB max. Private-network URLs are blocked.
          </span>
        </label>
      )}

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting}
        className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 sm:w-auto"
      >
        {submitting ? "Importing…" : "Import document"}
      </button>
    </div>
  );
}
