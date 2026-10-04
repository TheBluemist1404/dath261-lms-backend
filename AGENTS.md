# Repository Agent Instructions

Follow the engineering boundaries in `RULESET.md` and the canonical product decisions in the DATH 261 Notion workspace.

## Commit Attribution

When ChatGPT/Codex Connector directly authors a repository change, preserve the responsible human GitHub account as the primary author and append:

```text
Co-authored-by: chatgpt-codex-connector[bot] <199175422+chatgpt-codex-connector[bot]@users.noreply.github.com>
```

For squash merges, include the same trailer in the squash commit message so the attribution remains visible on the default branch. This records AI assistance only; the assigned team member remains responsible for reviewing and owning the change.
