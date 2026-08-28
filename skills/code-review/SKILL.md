---
name: code-review
description: Review a diff or file against the team engineering conventions — naming, error handling, TypeScript, function shape, security, and testing. Use when asked to review code, check a PR, or vet a change before merge.
---

# Code Review

Review the target code against the conventions below. Report findings grouped by
severity (blocking / non-blocking / nit). Cite `file:line` for each. If the code
is clean, say so briefly — do not manufacture findings.

## Naming

- Descriptive `camelCase` for variables and functions (allowed abbreviations: `url`, `id`, `api`, `config`).
- Booleans read as predicates: `is*`, `has*`, `should*`, `can*`.
- Functions are verb-first (`getUserById`, not `user`).
- File name matches its primary export (`UserService.ts` exports `UserService`).
- Constants are `UPPER_SNAKE_CASE`.

## Error handling

- Every async operation is inside `try/catch` or has a `.catch()`.
- Error messages name the operation that failed and the relevant inputs.
- No empty catch blocks — at minimum log or rethrow.
- Resource cleanup goes in `finally`.

## TypeScript

- No `any` without a justification comment.
- `interface` for object shapes; `unknown` + type guards for external data.
- Model states with discriminated unions, not piles of optional fields.
- Generic parameters have descriptive names (`TUser`, not `T`).

## Functions

- Single responsibility — if describing it needs "and", split it.
- Max 3 positional parameters; use an options object beyond that.
- Early returns over nested conditionals.
- Query functions (`get*`, `find*`, `is*`) are pure.

## Security

- No secrets in code — environment variables only.
- Validate user input at system boundaries.
- Parameterized SQL statements only.
- API responses never leak stack traces or internal paths.

## Testing

- Test names describe behavior ("returns empty array when no results found").
- Each test owns its setup and teardown.
- Specific assertions (`toEqual(expected)`, not `toBeTruthy()`).
- Edge cases covered: empty, null, boundary values, error paths.
