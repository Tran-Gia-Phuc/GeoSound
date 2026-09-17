# Conventions (init summary)

Git details are in [CONTRIBUTING.md](../../CONTRIBUTING.md). This file is only what you need when writing docs or preparing to code.

## Documentation

- Write in **English**. Keep sentences short; one idea per paragraph.
- File names: lowercase English, hyphens (for example `directory-structure.md`).
- Use relative links between files under `docs/`.
- Mark unfinished content with a `>` blockquote at the top.

## Source code (when coding starts)

- Do not commit secrets. List variables in `.env.example` without real values.
- One branch, one task; open PRs into `develop`.
- Code folders and files: English, kebab-case, or the chosen stack's default.

## Phase numbers

Keep the `00` … `04` prefixes. Add a new phase (for example `05-report`) only if the whole team agrees, then update [docs/README.md](../README.md).
