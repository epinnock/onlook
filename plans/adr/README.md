# Architecture Decision Records

Mid-task design decisions that change how the system works — or change the API surface between parallel workstreams — go here instead of blocking the work.

The CLAUDE.md operating mode rule ("keep going; if you need a recommendation, pick what you believe is best") means agents routinely make calls that deserve a durable record. ADRs are that record.

## When to write an ADR

- You chose one of multiple viable architectures and the choice constrains future tasks (e.g. "shims bundle into a single file vs. lazy chunks").
- You rejected an approach that another agent might reasonably try again.
- The choice affects a public interface between workstreams (types, protocols, port allocation, file layout).
- A reviewer in the future would sensibly ask "why is this done this way and not the other way?"

## When you don't need an ADR

- The change is fully scoped to one task's allowed files and won't affect anyone else.
- The rationale fits in the commit message.
- You're fixing a bug — just fix it.

## File format

One ADR per file. Numbered sequentially: `0001-<slug>.md`, `0002-<slug>.md`, etc.

Use `template.md` as a starting point. Keep each ADR short — a full page is the ceiling. The goal is a durable paper trail, not a design spec.

## Status lifecycle

- **Proposed** — still up for revision inside the same work session
- **Accepted** — the decision is live; future code should follow it
- **Superseded** — replaced by a later ADR (link to the successor)
- **Deprecated** — was accepted, no longer applies, kept for history

## Indexing

Add new ADRs to `INDEX.md` (create when the first real ADR lands) with one-line summaries. Cite ADRs by number in commit messages and code comments: `// See ADR-0003 for why we chose data URIs over R2 for small assets.`

---

## Template

Copy `template.md` into a numbered file and fill in.
