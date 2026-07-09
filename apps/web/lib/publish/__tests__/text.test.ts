import { describe, expect, it } from "vitest";

import { extractTitle, sanitizeFilename, stripFrontmatter } from "@/lib/publish/text";

describe("sanitizeFilename (Smitty parity)", () => {
  it("lowercases and slugifies a normal name", () => {
    expect(sanitizeFilename("My Plan.md")).toBe("my-plan");
  });

  it("collapses whitespace and underscores to single dashes", () => {
    expect(sanitizeFilename("Hello_World.md")).toBe("hello-world");
    expect(sanitizeFilename("  Spaces   Here .md")).toBe("spaces-here");
  });

  it("drops characters outside [a-z0-9-]", () => {
    expect(sanitizeFilename("Report (final)!.md")).toBe("report-final");
  });

  it("squeezes repeated dashes and trims leading/trailing ones", () => {
    expect(sanitizeFilename("---weird---.md")).toBe("weird");
  });

  it("strips the .md extension and any directory prefix", () => {
    expect(sanitizeFilename("/some/dir/My Doc.md")).toBe("my-doc");
  });

  it("returns empty when nothing survives (caller supplies a fallback)", () => {
    expect(sanitizeFilename("!!!.md")).toBe("");
  });
});

describe("extractTitle (Smitty parity)", () => {
  it("uses the first '# ' heading", () => {
    expect(extractTitle("# Hello World\n\nbody", "x.md")).toBe("Hello World");
  });

  it("skips a non-h1 line and finds the first real h1", () => {
    expect(extractTitle("## Subhead\n\n# Real Title\n", "x.md")).toBe("Real Title");
  });

  it("trims surrounding whitespace on the heading text", () => {
    expect(extractTitle("#   Spaced   \n", "x.md")).toBe("Spaced");
  });

  it("falls back to the filename (minus .md) when there is no heading", () => {
    expect(extractTitle("no heading here\n\nbody", "my-file.md")).toBe("my-file");
  });

  it("ignores frontmatter and finds the body heading", () => {
    const doc = "---\nname: waypoint\ndescription: a skill\n---\n\n# Waypoint review loop\n";
    expect(extractTitle(doc, "SKILL.md")).toBe("Waypoint review loop");
  });
});

describe("stripFrontmatter", () => {
  it("removes a leading YAML frontmatter block", () => {
    const doc = "---\nname: waypoint\ndescription: a skill\n---\n\n# Heading\n\nbody";
    expect(stripFrontmatter(doc)).toBe("\n# Heading\n\nbody");
  });

  it("leaves frontmatter-free markdown byte-identical (Smitty parity)", () => {
    const doc = "# Title\n\nSome prose with a --- inside.\n\n---\n\nmore";
    expect(stripFrontmatter(doc)).toBe(doc);
  });

  it("does not treat a mid-document thematic break as frontmatter", () => {
    const doc = "intro paragraph\n\n---\n\nafter the break";
    expect(stripFrontmatter(doc)).toBe(doc);
  });

  it("handles CRLF frontmatter", () => {
    const doc = "---\r\nwaypoint: 1\r\n---\r\n\r\n# Body";
    expect(stripFrontmatter(doc)).toBe("\r\n# Body");
  });
});
