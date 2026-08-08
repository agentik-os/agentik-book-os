# Agentik Book {OS}

**Your personal librarian, learning coach and intellectual sparring partner — on your own Telegram bot.**

Give it a book, an idea, a decision or a problem. It gives you back understanding you actually keep, and turns that understanding against your real decisions. It is not a summary machine. Summaries are dead knowledge. This is a system for moving a *living mental model* into your head, fast, making it stick, and then using it.

It runs as a Telegram bot you own and control, powered by Claude. Clone, run `./setup.sh`, paste a bot token, and in a few minutes you are talking to your own librarian — by text or by voice.

```
KNOWLEDGE → UNDERSTANDING → MENTAL MODELS → MEMORY → JUDGMENT → APPLICATION → ADVANTAGE
```

The success test is simple. **Thirty days after a session, can you (1) explain the idea in your own words, and (2) point to one real decision it changed?** Everything in this project is built to make the answer *yes*.

---

## Why this was created

Most of us consume far more than we retain. We finish a book and, a month later, keep a vague glow and maybe one quote. The bottleneck was never access to books — it was the path from *reading* to *remembering* to *using*. Chatbots made that worse in a subtle way: they hand you fluent summaries that *feel* like learning while nothing lands.

Agentik Book {OS} was built to close that gap on purpose, using what learning science actually knows works — active recall, spaced repetition, the Feynman technique, dual coding, elaboration, emotional and concrete anchoring — and to deliver it through the one surface you already check all day: **Telegram**. On your phone, by voice when you are walking, in your language, adapted to *how you personally learn*.

It was also built to be **yours**. It is open-source and self-hosted. Your books, your notes, your reading history and your API key stay on your machine. No account on someone else's platform, no feed, no lock-in.

---

## How it was thought

A few deliberate design decisions shape everything:

- **Transfer, not summary.** The agent is instructed, at length, to refuse the "this book teaches us that…" voice. It extracts the load-bearing 20%, names the transferable mental models, and always pushes one step past memory into *application to your world*.
- **Honesty is the product.** The agent knows books' *ideas*, not a photocopy of their pages. It never invents a chapter title, a quote, a page number or a statistic. It separates three voices explicitly: *what the book says* / *what I think* / *what it means for you*. One invented quote would destroy the whole library, so the rule is absolute.
- **Built for a phone and a busy, associative brain.** Lead with the answer. One idea per line. Diagrams over paragraphs. Progressive disclosure — the one-liner first, the mechanism next, the deep detail only if you ask. Every dense session ends with **one** thing to remember, not ten.
- **Adapts to you.** `/setup` runs a short interview about how you learn (visual or verbal, short sprints or long dives, whether stories or images or a memory palace stick for you, your domains, your language) and writes a profile the agent reloads every session. Because it is open-source, you can also just **edit the system prompt** and make it think however you want (see *Make it yours*).
- **Everything real is a file, not a fragile chat bubble.** Big deliverables (a full chapter-by-chapter breakdown, the top-100 list) come back as files. Diagrams come back as a crisp image **and** a full-screen, zoomable HTML page — because ASCII diagrams break on a phone.

---

## How it works

```
                Telegram (your bot, whitelisted to you)
                              │
                    voice? → transcribe            files? → read
                (faster-whisper, on-device)     (PDF / EPUB / text)
                              │
                              ▼
        ┌──────────────────────────────────────────────┐
        │  Agentik Book {OS} prompt  +  your /setup       │
        │  profile  +  active language  +  conversation  │
        └──────────────────────────────────────────────┘
                              │
                     Claude (Anthropic API)
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        text reply     [[DIAGRAM:…]]      [[SEND:…]]
                        real Mermaid       a real file
                        → PNG + HTML
```

- **`bot.ts`** — one self-contained Bun file: the Telegram loop, your whitelist, the Claude call, voice transcription, diagram rendering, the ledger, and the fast local commands (`/setup`, `/language`, `/voice`).
- **`prompt/ALEXANDRIA.md`** (the system prompt file): the seven functions, the truth protocol, the mode router, the Book X-ray, the sparring rounds, the learning-science engine, the persistent ledger. This is the brain. Edit it to change how the agent thinks.
- **`data/ledger/`** — your persistent memory on disk: your profile, language, and (as you use it) your library, idea vault, review queue. Never leaves your machine; gitignored.

### The stack (all open-source, on-device where it counts)

| Piece | What | Cost |
|---|---|---|
| **Claude** via the Anthropic API | the reasoning | your API usage (pay-as-you-go) |
| **Bun** | the runtime | free |
| **mermaid-cli** (real Mermaid) | renders diagrams with correct dagre layout (never overlaps); pulls a headless Chromium on first render | free |
| **faster-whisper** (optional) | on-device voice transcription, 99 languages, no key | free |
| a local TTS gateway (optional) | the bot speaking replies back (`/voice`) | free |

The only thing you pay for is your own Anthropic API usage. Everything else is free and runs locally.

---

## Install

You need [Bun](https://bun.sh) (the setup script installs it if missing), a Telegram bot token, and an Anthropic API key.

```bash
git clone https://github.com/agentik-os/agentik-book-os
cd agentik-book-os
./setup.sh
```

`setup.sh` installs Bun and the one dependency, walks you through creating `.env`, offers to install local voice transcription, and can register a 24/7 systemd service. Prefer to do it by hand?

```bash
bun install
cp .env.example .env      # then fill in the three required values
bun run bot.ts
```

Then open Telegram, message your bot, and send `/start` → `/setup`.

### Getting the three values

1. **`TELEGRAM_BOT_TOKEN`** — message [@BotFather](https://t.me/BotFather), send `/newbot`, name it, copy the token.
2. **`ALLOWED_USER_IDS`** — message [@userinfobot](https://t.me/userinfobot), copy your numeric id. The bot answers **only** these ids — this is your security (see below).
3. **`ANTHROPIC_API_KEY`** — from [console.anthropic.com](https://console.anthropic.com).

---

## Security

The bot is **deny-by-default**. It only responds to the Telegram user ids in `ALLOWED_USER_IDS`; every other message is ignored and logged. Your token and API key live in `.env`, which is gitignored and never leaves your machine. Your ledger (what you have read, your profile, your notes) is local files only. There is no server, no account, no telemetry.

---

## The commands

Full list with explanations: [`docs/COMMANDS.md`](docs/COMMANDS.md). The essentials:

- **`/setup`** — calibrate the bot on how *you* learn (do this first).
- **`/book`** X-ray a book · **`/espresso`** a book in 90 seconds · **`/chapter`** chapter by chapter · **`/best`** the 50 best books + 50 tips on a topic · **`/bestsellers`** the top 100 best-sellers in a niche.
- **`/idea`** an atlas across many books · **`/compare`** authors in combat · **`/challenge`** 10-round sparring on your plan · **`/council`** a panel of perspectives · **`/apply`** an idea to your business.
- **`/teach`** Feynman · **`/memory`** forge memory · **`/drill`** active recall · **`/map`** a clean diagram · **`/review`** spaced repetition · **`/focus`** a 5-minute session · **`/audio`** listen mode.
- **`/language`** (default English) · **`/voice`** spoken replies.

No command needed — just talk. "X-ray Atomic Habits and apply it to my morning." "Compare Deep Work and Flow." "Challenge my idea to start a paid community." "Teach me game theory for negotiations, one question at a time."

---

## The impact on how you learn

This is the point of the project, so it is worth being concrete about what changes:

- **You retain instead of consume.** Active recall and a real spaced-repetition schedule (J+1 / J+3 / J+7 / J+14 / J+30) are built in, so ideas move into long-term memory instead of evaporating in a week.
- **You understand mechanisms, not slogans.** The Feynman mode forces you to explain simply and exposes exactly where your understanding is hollow.
- **Knowledge becomes decisions.** Every idea gets pulled toward *your* context — your work, your projects, your real trade-offs — and turned into a rule, an experiment, or a decision. That is the difference between having read a book and thinking *with* it.
- **Your judgment gets sharper because something argues back.** The sparring and council modes are not a yes-man. They steelman your idea, then attack it from the strongest opposing view, and hand you the cheapest test to settle it.
- **It compounds.** Because the ledger persists, the bot connects new ideas to what you already learned, notices when you are overconfident, and resurfaces the right thing at the right time. A library that remembers *you*.

The deeper effect is a shift in identity: from someone who reads books to someone who *operates* on them.

---

## Make it yours (this is open-source — that is the whole point)

Your intention for learning is personal. The system is built to be reshaped to it.

- **Change how it thinks — edit `prompt/ALEXANDRIA.md`.** It is the entire brain, in plain language. Want it more Socratic and less direct? More brutal in its critiques? Focused only on business books, or only on philosophy? Want it to always answer as five flashcards? Rewrite the relevant section. No code needed.
- **Change how it teaches you — use `/setup`, or edit `data/ledger/PROFILE.md`.** The profile overrides the defaults. Tell it you think in music, or in code, or in sport, and every analogy will come from your world.
- **Change the memory model.** The ledger is just markdown files you own. Add your own files, wire it to your note system, back it up, sync it — it is yours.
- **Change the surface.** `bot.ts` is one readable file. Point it at a different model, add a command, change the diagram theme, run it somewhere else. Fork it and make it a study bot, a research assistant, a coach for a specific field.

Whatever you actually want out of knowledge — to decide better, to build, to teach, to remember more, or just for the joy of understanding — you can bend this to it, because you can read and change every part.

---

## FAQ

**Do I need OmegaOS?** No. This is a fully standalone repo. (It was extracted from [OmegaOS](https://github.com/agentik-os/OmegaOS), where the same librarian runs as a built-in agent, but nothing here depends on it.)

**Does it work in my language?** Yes. It defaults to English and switches with `/language`, or just write to it in your language and it follows.

**Is my data private?** Yes — local files, your own bot, whitelisted to you, no server.

**Which model?** Any current Claude model; set `MODEL` in `.env`. The default is a sensible balanced choice.

**Does voice need a paid key?** No. Transcription runs on-device with faster-whisper (the setup script installs it). OpenAI Whisper is only an optional fallback. Diagrams use mermaid-cli (Node), which pulls a small headless Chromium on first render.

---

## License

MIT. Built by [Agentik OS](https://github.com/agentik-os). Diagrams by [mermaid-cli](https://github.com/mermaid-js/mermaid-cli) (MIT).
