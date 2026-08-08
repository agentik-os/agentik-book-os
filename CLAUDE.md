# Agentik Book {OS} — project guide (for OmegaOS / Claude Code sessions)

**What this is.** A standalone, open-source Telegram librarian bot powered by Claude. It turns any book, idea or decision into understanding, durable memory and action — on the user's own Telegram bot, with no OmegaOS dependency. Public repo: https://github.com/agentik-os/agentik-book-os

**Origin.** Extracted from OmegaOS, where the same librarian runs as the `librarian` persona agent-bot (`~/.omega/agents/librarian.md`, wired via the Telegram Agents menu). This repo is the shareable, self-hostable version. Keep the two in rough parity when you change core behaviour.

## Layout
- `bot.ts` — the whole bot (one Bun file): Telegram long-poll, deny-by-default whitelist, Claude (Anthropic API) brain, voice transcription, diagram rendering, paper-style reports, the guided `/setup` wizard, `/language`, `/voice`, and the persistent ledger.
- `prompt/ALEXANDRIA.md` — the system prompt (the brain). Same content as the OmegaOS generic reference. Edit here to change how the agent thinks.
- `lib/diagram-viewer.html` — the interactive diagram viewer (pan/zoom, export PNG, share). `__TITLE__ / __SVG__ / __PNG__` are filled per diagram.
- `lib/report.css` — the paper-style report stylesheet.
- `docs/COMMANDS.md` — every command explained.
- `setup.sh` — one-command installer (Bun, deps, `.env`, optional faster-whisper, optional systemd).
- `data/ledger/` — runtime state (profile, language, vault). Gitignored.

## Key design rules (do not regress)
- **Diagrams use REAL Mermaid** (mermaid-cli via `npx`), never a reimplemented layout engine — real dagre layout never overlaps. Mermaid from the model is sanitized first (`sanitizeMermaid`: strip code fences, `\n` → `<br/>`, drop a stray `| title`). The marker is `[[DIAGRAM: <code>]]` — NO `| title` (the `|` collides with Mermaid edge labels). PNG preview is a headless-Chromium screenshot of the SVG.
- **Long answers become a paper-style HTML file** (`reportHtml`), not truncated Telegram text (Telegram caps ~4096 chars). Diagrams embed inline in the report.
- **Deliverable files are named `<book-or-topic>-<command>.html/.png`** via `slug()`.
- **Security is deny-by-default**: only `ALLOWED_USER_IDS` are served.
- **English is the default reply language**; `/language` overrides; `/setup` writes `data/ledger/PROFILE.md`.
- **Branding is "Agentik Book {OS}"** in all user-facing surfaces.

## Run / test locally
```bash
bun install
cp .env.example .env    # TELEGRAM_BOT_TOKEN, ALLOWED_USER_IDS, ANTHROPIC_API_KEY
bun run bot.ts
```
Type-check: `bun build bot.ts --target=bun >/dev/null`. Diagrams need `npx` (Node) + a Chromium (mermaid-cli pulls it on first render). Voice needs `omega-transcribe` (faster-whisper) or `OPENAI_API_KEY`.

## Publishing
Public repo `agentik-os/agentik-book-os`. Commit with the agentik-os identity; push to `origin main`.
