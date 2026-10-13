# claude-code-mods

Marketplace `quanti-mods` for Claude Code mods. Layout: `.claude-plugin/marketplace.json` at the root, one self-contained folder per mod in `plugins/<name>/`.

- Adding a mod: follow "Adding a mod" in README.md. Use the `plugin-authoring` skill to build one.
- Bump `version` in the mod's `plugin.json` for every user-visible change; users only update when it changes.
- Validate before committing: `claude plugin validate .`
- Never commit machine-specific paths, tokens or generated `types/` folders.
