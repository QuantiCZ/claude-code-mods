# claude-code-mods

Quanti marketplace of Claude Code mods (`quanti-mods`). Private repo: you need access to the QuantiCZ GitHub org and working git credentials.

## Install

```
/plugin marketplace add QuantiCZ/claude-code-mods
/plugin install <mod>@quanti-mods
```

## Mods

| Mod | Description |
| --- | --- |
| [usage-band](plugins/usage-band) | Band above the prompt with context fill, token totals and cost. |

## Adding a mod

1. Create `plugins/<name>/` with `.claude-plugin/plugin.json` and `hooks/`.
2. Add an entry to `.claude-plugin/marketplace.json` (`source: ./plugins/<name>`).
3. Add a row to the table above and a `README.md` in the mod folder.
4. Run `claude plugin validate .`, then bump `version` in the mod's `plugin.json` on every release (users only get updates when it changes).
