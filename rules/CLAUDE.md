# Team AI Rules

These rules are maintained centrally in `@wisniewskikr/ai-toolkit` and installed
into each project's rules file between sentinel markers. Edits inside the marked
block are overwritten on the next update — change them in the toolkit repo.

## Working agreement

- Prefer the smallest change that satisfies the request. Do not refactor
  adjacent code unless asked.
- Match the surrounding code's style, naming, and structure over any personal
  preference.
- When a requirement is ambiguous, state the assumption you are making and
  proceed; do not stall on clarification for reversible decisions.

## Code

- Follow the `code-review` skill's conventions for any code you write.
- No secrets, tokens, or credentials in source or in commits — environment
  variables only.
- Every new behavior ships with a test that would fail without it.

## Commits & changes

- One logical change per commit; write Conventional Commits subject lines.
- Never force-push a shared branch. Never amend a commit that is already pushed.
- Call out breaking changes explicitly in the commit body.
