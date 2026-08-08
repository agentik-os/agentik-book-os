#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# Agentik Book {OS} — one-command setup.
#
#   git clone https://github.com/agentik-os/agentik-book-os
#   cd agentik-book-os
#   ./setup.sh
#
# It installs Bun (if missing), sets up clean diagrams (real Mermaid via mermaid-cli),
# helps you create your .env, OPTIONALLY installs the local
# open-source voice stack (faster-whisper for transcription), and can register a
# systemd service so the bot runs 24/7. Everything here is open-source and free;
# the only paid piece is your Anthropic API usage.
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")"
say() { printf "\033[36m▸\033[0m %s\n" "$*"; }
ok()  { printf "\033[32m✓\033[0m %s\n" "$*"; }
warn(){ printf "\033[33m!\033[0m %s\n" "$*"; }

# ── 1. Bun ──────────────────────────────────────────────────────────────────
if ! command -v bun >/dev/null 2>&1; then
  say "Installing Bun (JavaScript runtime)…"
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi
command -v bun >/dev/null 2>&1 && ok "Bun $(bun --version)" || { warn "Bun not on PATH — open a new shell and re-run, or add ~/.bun/bin to PATH."; exit 1; }

# ── 2. Dependencies (clean diagrams) ────────────────────────────────────────
say "Checking diagram tooling (mermaid-cli via npx)…"
bun install >/dev/null 2>&1 || true; command -v npx >/dev/null 2>&1 && ok "Node/npx present — diagrams render with mermaid-cli (Chromium pulled on first render)" || warn "npx (Node.js) not found — install Node.js for diagrams; text still works."

# ── 3. .env ─────────────────────────────────────────────────────────────────
if [[ ! -f .env ]]; then
  cp .env.example .env
  say "Created .env — let's fill in the essentials."
  read -r -p "  Telegram bot token (from @BotFather): " TT
  read -r -p "  Your Telegram user id (from @userinfobot): " TU
  read -r -p "  Anthropic API key (console.anthropic.com): " AK
  # portable in-place edit
  tmp=$(mktemp)
  sed -e "s|^TELEGRAM_BOT_TOKEN=.*|TELEGRAM_BOT_TOKEN=${TT}|" \
      -e "s|^ALLOWED_USER_IDS=.*|ALLOWED_USER_IDS=${TU}|" \
      -e "s|^ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=${AK}|" .env > "$tmp" && mv "$tmp" .env
  ok ".env written (it is gitignored — your secrets never leave this machine)."
else
  ok ".env already exists — leaving it as is."
fi

# ── 4. Optional: local open-source voice transcription (faster-whisper) ──────
read -r -p "Install local voice transcription (faster-whisper, on-device, no API key)? [y/N] " V
if [[ "$V" =~ ^[Yy]$ ]]; then
  if command -v python3 >/dev/null 2>&1; then
    say "Setting up faster-whisper in a dedicated venv…"
    python3 -m venv "$HOME/.omega/transcription-venv" 2>/dev/null || python3 -m venv .whisper-venv
    VENV="$HOME/.omega/transcription-venv"; [[ -d "$VENV" ]] || VENV=".whisper-venv"
    "$VENV/bin/pip" install --quiet --upgrade pip >/dev/null 2>&1
    "$VENV/bin/pip" install --quiet "faster-whisper>=1.0.0" >/dev/null 2>&1 && ok "faster-whisper installed" || warn "faster-whisper install failed — voice will use OPENAI_API_KEY if set."
    mkdir -p "$HOME/.local/bin"
    cat > "$HOME/.local/bin/omega-transcribe" <<PY
#!$VENV/bin/python
import sys, json
from faster_whisper import WhisperModel
args=sys.argv[1:]; f=args[0]
out="txt"
if "--output" in args: out=args[args.index("--output")+1]
model=WhisperModel("base", device="cpu", compute_type="int8")
segs,info=model.transcribe(f)
segs=list(segs); text=" ".join(s.text.strip() for s in segs)
if out=="json": print(json.dumps({"language":info.language,"full_text":text}, ensure_ascii=False))
else: print(text)
PY
    chmod +x "$HOME/.local/bin/omega-transcribe"
    ok "omega-transcribe installed to ~/.local/bin (the bot uses it automatically)."
    warn "Voice OUTPUT (the bot speaking back) needs a local TTS gateway (omega-ttsd). It is optional; text always works."
  else
    warn "python3 not found — skipping local transcription. Set OPENAI_API_KEY in .env for Whisper instead."
  fi
fi

# ── 5. Optional: run 24/7 via systemd (Linux) ───────────────────────────────
read -r -p "Run the bot 24/7 as a background service (systemd --user)? [y/N] " S
if [[ "$S" =~ ^[Yy]$ ]] && command -v systemctl >/dev/null 2>&1; then
  UNIT="$HOME/.config/systemd/user/agentik-book-os.service"; mkdir -p "$(dirname "$UNIT")"
  BUN="$(command -v bun)"
  cat > "$UNIT" <<UNIT
[Unit]
Description=Agentik Book {OS} — Telegram librarian bot
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$(pwd)
ExecStart=$BUN run $(pwd)/bot.ts
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
UNIT
  systemctl --user daemon-reload
  systemctl --user enable --now agentik-book-os.service 2>/dev/null
  loginctl enable-linger "$USER" 2>/dev/null || true
  sleep 2
  systemctl --user is-active --quiet agentik-book-os.service && ok "Service running — talk to your bot on Telegram now." || warn "Service failed to start: journalctl --user -u agentik-book-os -n 20"
else
  echo
  ok "Setup done. Start the bot with:  bun run bot.ts"
  echo "   Then open Telegram, message your bot, and send /start → /setup."
fi
