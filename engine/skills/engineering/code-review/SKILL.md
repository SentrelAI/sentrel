---
name: code-review
description: Use when reviewing code, PRs, or analyzing codebases for quality, security, and performance issues.
---

# Code Review

## Checklist
1. **Security**: SQL injection, XSS, auth bypass, secrets in code
2. **Logic**: edge cases, off-by-one, null handling, race conditions
3. **Performance**: N+1 queries, unnecessary loops, missing indexes
4. **Readability**: clear naming, small functions, no magic numbers
5. **Tests**: adequate coverage, edge cases tested, no flaky tests

## Feedback style
- Be specific (line number, what's wrong, how to fix)
- Explain WHY, not just WHAT
- Suggest improvements, don't just criticize
- Acknowledge good code too
- Prioritize: blockers first, nits last
