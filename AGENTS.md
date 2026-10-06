# Repository Agent Instructions

Before starting work, read [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) for the project source map and implementation context, then [RULESET.md](RULESET.md) and [CONTRIBUTING.md](CONTRIBUTING.md) for engineering boundaries and workflow.

Consult the relevant canonical Notion documents linked there for product/domain decisions and Figma when a task depends on UI behavior. Keep the product model in those sources and implementation context in the context file, rather than duplicating it in this instruction file.

## Commit Attribution

Use co-author trailers only when an AI coding tool directly authored a meaningful part of the repository change. Keep the responsible team member as the primary Git author.

### ChatGPT / Codex through the GitHub Connector

When the change is authored through the ChatGPT/Codex GitHub Connector, append:

```text
Co-authored-by: chatgpt-codex-connector[bot] <199175422+chatgpt-codex-connector[bot]@users.noreply.github.com>
```

### Codex outside the GitHub Connector

When Codex Desktop, Codex CLI, or another Codex coding surface directly authors the change without using the GitHub Connector, append:

```text
Co-authored-by: Codex <codex@openai.com>
```

### Attribution Rules

- Do not add an AI co-author trailer when the AI only provided advice, explanation, review, or minor suggestions and the human authored the actual change.
- Do not add both Codex identities unless both surfaces materially authored the same change.
- For squash merges, preserve the applicable trailer in the squash commit message so the attribution remains visible on the default branch.
- AI co-authorship records assistance only. The assigned team member remains responsible for reviewing, validating, and owning the change.
