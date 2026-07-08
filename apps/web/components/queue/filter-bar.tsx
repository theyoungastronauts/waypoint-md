import Link from "next/link";

import type { Project } from "@/lib/projects";
import { cn } from "@/lib/utils";

interface FilterBarProps {
  projects: Project[];
  activeStatus?: string;
  activeProject?: string;
}

const STATUS_FILTERS: Array<{ value?: string; label: string }> = [
  { value: undefined, label: "All" },
  { value: "pending", label: "Pending" },
  { value: "in_review", label: "In review" },
  { value: "completed", label: "Completed" },
  { value: "pulled", label: "Pulled" },
];

function buildHref(status?: string, project?: string): string {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (project) params.set("project", project);
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-full border px-3 py-1 text-sm transition-colors",
        active
          ? "border-transparent bg-primary text-primary-foreground"
          : "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {children}
    </Link>
  );
}

/**
 * Queue filters rendered as links (no client JS) so the dashboard stays a
 * server component. Each chip preserves the other active filter.
 */
export function FilterBar({ projects, activeStatus, activeProject }: FilterBarProps) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <Chip
            key={f.label}
            href={buildHref(f.value, activeProject)}
            active={activeStatus === f.value || (!activeStatus && !f.value)}
          >
            {f.label}
          </Chip>
        ))}
      </div>
      {projects.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Chip href={buildHref(activeStatus, undefined)} active={!activeProject}>
            All projects
          </Chip>
          {projects.map((p) => (
            <Chip
              key={p.id}
              href={buildHref(activeStatus, p.id)}
              active={activeProject === p.id}
            >
              {p.name}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}
