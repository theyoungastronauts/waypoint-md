# Voice (speech-to-text) input for answer/elaboration fields — Verification

**Verdict: PASS WITH WARNINGS.** Reviewer (fresh session), local Node v20.19.5. Reviewed the uncommitted working tree. Report authored by the reviewer, committed by the lead (reviewer harness disallowed the file write). WARN-1 (mic-track leak race) was fixed by the lead pre-commit; WARN-2 accepted.

## Gates

8/8 voice-input tests (now 9 after the lead's regression test) pass; full review suite green — attach-file (5) and attach-file-picker (7) unaffected. typecheck/lint clean. `git diff packages/` empty — byte-fidelity untouched.

## Ratified must-haves — all met

- **No server/API key:** browser-native `SpeechRecognition`/`webkitSpeechRecognition` only; `getUserMedia` is waveform-only.
- **Degradation + no hydration mismatch:** `isSupported` starts false and is set in a post-mount effect, so SSR + first client render both emit null (no mic), then the mic reveals on the client. `VoiceInput` returns null when unsupported. Both branches tested (present stubs SpeechRecognition; absent leaves jsdom with neither global).
- **Insert into the live draft:** `onInsert = insertAtCaret = useCaretInsert → saveContent`. It never calls `insertIntoAnswer`/`applyInsert`, so Phase-4 `embedded.other` seeding is NOT reintroduced. Integration test confirms dictated text lands in the textarea and the autosave PUT carries it.
- **No double-insert:** `finalize()` is guarded by `activeRef`; teardown nulls `rec.onend` before `abort()`. If `stop()` and `onend` both fire, the second no-ops. Interim is folded into `combinedRef` and replaced by final — no interim+final duplication.
- **Error handling:** onerror not-allowed/service-not-allowed/audio-capture → hint + revert to idle, no throw; no-speech keeps listening; the app's own `aborted` returns silently; no console-spam. getUserMedia denial is caught in `setupAnalyser`'s try/catch (fire-and-forget) → no unhandled rejection.
- **Teardown on stop/cancel/onend/onerror AND unmount:** nulls handlers, `abort()` in try/catch, stops ALL tracks, closes the AudioContext, clears the analyser.
- **Scope/UX:** Escape-cancel scoped to `state==="listening"` (can't swallow Escape while typing); NO global Space/Enter bindings. Mic sits beside AttachFile, matching style. Waveform best-effort (getUserMedia + AudioContext in try/catch).

## Judgment calls — sound

Dropping Liminal's ready/review step (stop→insert directly, since the field is already editable); raw insert at caret with no auto-spacing (matches Attach file); waveform decoupled from recognition.

## Warnings

1. **[Low → FIXED] getUserMedia restart race.** If a user stopped and restarted dictation while the first session's `getUserMedia` was still pending, the stale grant could overwrite `mediaStreamRef` and orphan the first session's live track (mic left running). **Fixed by the lead pre-commit:** a per-start `generationRef` is captured before the await; when the stale grant resolves it finds the generation advanced and stops its own stream instead of orphaning it. Regression test added (stop→restart→resolve-stale asserts the first track is stopped and the current one retained).
2. **[Trivial — accepted]** Opening the Attach-file modal *while listening* means one Escape fires both the modal's handler and VoiceInput's window listener (closes modal AND cancels dictation). Extremely unlikely combo; not worth code churn.

## Browser-only checks (manual pass, jsdom can't exercise real SpeechRecognition/getUserMedia)

- Chrome + Safari: real permission prompt, grant + deny; deny shows the hint and reverts with no console loop.
- Watch the OS mic indicator: clears after stop, after cancel, and after navigating away mid-listening (unmount) — where WARN-1 would have shown.
- Continuous interim→final streaming across multiple utterances matches spoken words.
- Firefox: the mic genuinely never renders; no hydration warning on first load.
- Waveform animates and is theme-tinted in light and dark.
