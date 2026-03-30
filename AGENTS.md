# Commit Message Guidelines (Agent Instructions)

These rules exist because release changelogs are generated from commit subjects.
Only commit subjects with `feat`, `fix`, or `perf` become release notes.

## Required Format

1. First line (summary)
   - `type(scope): short summary`
   - Keep it <= 72 characters.
   - Use present tense, imperative voice.

2. Optional body (recommended for clarity)
   - Bullet list of user-visible changes.
   - One change per line.

## Types That Appear In Release Notes

`feat`, `fix`, `perf`

## Other Allowed Types (Not In Release Notes)

`refactor`, `docs`, `chore`, `ci`, `test`, `style`

## Scope

Use a small, relevant scope like:
`player`, `subtitles`, `haptics`, `updates`, `ui`, `build`, `ci`

## Examples (Release-Visible)

```
feat(updates): add in-app update modal

- show changelog in a dedicated modal
- download correct APK based on device ABI
- keep Settings badge visible while update is available
```

```
fix(subtitles): improve SDH detection for bracketed cues

- detect parenthetical effects like (footsteps)
- reduce false positives around music-only captions
```

## Examples (Release-Hidden)

```
chore(ci): tidy workflow env injection
```

```
refactor(player): extract seek helpers
```

## What To Avoid

- No multi-paragraph prose.
- Avoid vague summaries like "misc fixes".
- Avoid internal-only notes unless user-visible.
