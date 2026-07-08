---
name: shell-json-probes
description: How to probe JSON APIs by hand in this zsh/darwin environment without corrupting the data
metadata:
  type: feedback
---

When probing a JSON API by hand during verification, do NOT capture a response into a shell var and `echo` it to a file — zsh's `echo` interprets backslash escapes, turning the `\n` inside a JSON string into literal newlines and producing invalid JSON. This cost a detour chasing a phantom "server returns unescaped control chars" bug that was purely the shell.

**Why:** the Phase 4 review's live probe saved `curl` output via `echo "$VAR" > file`; the file failed `jq`/`json.load` at "line 38" while the actual server response (checked with `od -c`) was correctly escaped `\n` (backslash+n, two bytes).

**How to apply:** write responses straight to disk with `curl -s URL -o file.json` (no echo). Validate/extract with `python3 -c "import json; json.load(open('file'))"` rather than `echo | jq`. When byte-inspecting, `od -c` shows an escaped `\n` as two columns `\  n` vs. a real newline as one — that distinguishes valid-escaped from actually-corrupt. Also remember: `process.argv[2]` is the first real arg in a node `.mjs` script (`argv[1]` is the script path) — an off-by-one there silently parsed the script file itself and returned zero items. See [[phase-4-review-notes]] if created.
