# claude-code-mods

Marketplace `quanti-mods` for Claude Code mods. Layout: `.claude-plugin/marketplace.json` at the root, one self-contained folder per mod in `plugins/<name>/`.

- Adding a mod: follow "Adding a mod" in README.md. Use the `plugin-authoring` skill to build one.
- Any change under `plugins/<name>/` that is not docs-only (`*.md`) MUST bump `version` in that mod's `.claude-plugin/plugin.json` in the same commit. Semver: patch for fixes, minor for features, major for breaking changes. Users only receive updates when the version changes. CI (`.github/scripts/check-version-bump.sh`) fails otherwise.
- Validate before committing: `claude plugin validate .`
- Never commit machine-specific paths, tokens or generated `types/` folders.
