// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { VoiceTranscripts } from "@/components/review/voice-transcripts";
import type { VoiceSessionRow } from "@/lib/voice/sessions";

afterEach(cleanup);

const session: VoiceSessionRow = {
  id: "vs-1",
  documentId: "d",
  model: "gpt-realtime-2.1",
  mode: "brief",
  status: "submitted",
  startedAt: "2026-10-09T23:00:00.000Z",
  endedAt: "2026-10-09T23:08:00.000Z",
  submittedAt: "2026-10-09T23:08:00.000Z",
  transcript: [
    { role: "voice", at: "t", text: "Brief or thorough?" },
    { role: "reviewer", at: "t", text: "Brief." },
    {
      role: "tool",
      at: "t",
      name: "record_answer",
      args: '{"number":1,"options":[2]}',
      result: '{"ok":true,"number":1,"recorded":"a token per device"}',
    },
    { role: "tool", at: "t", name: "submit_review", args: "{}", result: '{"error":"Read back the answers first"}' },
  ],
};

describe("VoiceTranscripts", () => {
  it("renders nothing when the document has had no calls", () => {
    const { container } = render(<VoiceTranscripts sessions={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("lists each call with its style, outcome and transcript, tool calls included", () => {
    render(<VoiceTranscripts sessions={[session]} />);
    expect(screen.getByRole("heading", { name: "Voice calls" })).toBeTruthy();
    expect(screen.getByText(/brief · submitted · 4 entries/)).toBeTruthy();

    fireEvent.click(screen.getByText(/brief · submitted/));
    expect(screen.getByText("Brief or thorough?")).toBeTruthy();
    expect(screen.getByText("Brief.")).toBeTruthy();
    expect(screen.getByText('record_answer {"number":1,"options":[2]} → recorded: a token per device')).toBeTruthy();
    expect(screen.getByText("submit_review → error: Read back the answers first")).toBeTruthy();
  });
});
