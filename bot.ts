#!/usr/bin/env bun
/**
 * Agentik Book {OS} — a standalone Telegram librarian bot.
 *
 * One file. It turns any book, idea or decision into understanding, durable memory and
 * action, on your own Telegram bot, powered by Claude via the Anthropic API. No OmegaOS.
 *
 * Config (Bun auto-loads a .env in this folder):
 *   TELEGRAM_BOT_TOKEN   required — from @BotFather
 *   ALLOWED_USER_IDS     required — comma-separated numeric Telegram user ids (@userinfobot)
 *   ANTHROPIC_API_KEY    required — from console.anthropic.com
 *   MODEL                optional — default "claude-sonnet-4-5"
 *   OPENAI_API_KEY       optional — Whisper transcription fallback
 *   DATA_DIR / PROMPT_FILE  optional
 *
 * Voice notes → transcribed (local `omega-transcribe` if present, else OpenAI Whisper).
 * Diagrams → REAL Mermaid (mermaid-cli, correct dagre layout, never overlaps): a complete
 *   PNG + an interactive full-screen HTML viewer (zoom / export / share).
 * Long answers → a clean paper-style HTML document (never truncated by Telegram).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const ALLOW = (process.env.ALLOWED_USER_IDS || "").split(/[,\s]+/).map(s => Number(s.trim())).filter(Boolean);
const API_KEY = process.env.ANTHROPIC_API_KEY || "";
const MODEL = process.env.MODEL || "claude-sonnet-4-5";
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const DATA_DIR = process.env.DATA_DIR || `${import.meta.dir}/data`;
const PROMPT_FILE = process.env.PROMPT_FILE || `${import.meta.dir}/prompt/ALEXANDRIA.md`;
const LEDGER = `${DATA_DIR}/ledger`, TMP = `${DATA_DIR}/tmp`;
const API = `https://api.telegram.org/bot${TOKEN}`;

if (!TOKEN || !ALLOW.length || !API_KEY) { console.error("Missing config. Set TELEGRAM_BOT_TOKEN, ALLOWED_USER_IDS and ANTHROPIC_API_KEY (see .env.example)."); process.exit(1); }
mkdirSync(LEDGER, { recursive: true }); mkdirSync(TMP, { recursive: true });

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const readOr = (p: string, d = "") => { try { return readFileSync(p, "utf8"); } catch { return d; } };
async function tg(method: string, body: any) { try { return await (await fetch(`${API}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json(); } catch { return { ok: false }; } }
async function send(chat: number, text: string, kb?: any) { const parts = text.match(/[\s\S]{1,3800}/g) || [text]; let last: any; for (const p of parts) last = await tg("sendMessage", { chat_id: chat, text: p, parse_mode: "HTML", disable_web_page_preview: true, ...(kb ? { reply_markup: kb } : {}) }); return last; }
async function edit(chat: number, mid: number, text: string, kb?: any) { return tg("editMessageText", { chat_id: chat, message_id: mid, text, parse_mode: "HTML", disable_web_page_preview: true, ...(kb ? { reply_markup: kb } : {}) }); }
async function sendFile(chat: number, path: string, caption?: string) {
  try {
    const buf = await Bun.file(path).arrayBuffer(); const name = path.split("/").pop() || "file"; const ext = (name.split(".").pop() || "").toLowerCase();
    const method = ["png", "jpg", "jpeg", "webp"].includes(ext) ? "sendPhoto" : "sendDocument"; const field = method === "sendPhoto" ? "photo" : "document";
    const fd = new FormData(); fd.append("chat_id", String(chat)); if (caption) fd.append("caption", caption.slice(0, 1024)); fd.append(field, new Blob([buf]), name);
    const r: any = await (await fetch(`${API}/${method}`, { method: "POST", body: fd })).json(); return !!r?.ok;
  } catch { return false; }
}
async function sendVoice(chat: number, ogg: Uint8Array) { const fd = new FormData(); fd.append("chat_id", String(chat)); fd.append("voice", new Blob([ogg], { type: "audio/ogg" }), "voice.ogg"); try { return await (await fetch(`${API}/sendVoice`, { method: "POST", body: fd })).json(); } catch { return { ok: false }; } }

// ── prefs + memory ──────────────────────────────────────────────────────────
const langOf = () => readOr(`${LEDGER}/LANGUAGE.txt`).trim();
const voiceOf = () => readOr(`${LEDGER}/VOICE.txt`).trim();
const history: Record<number, { role: "user" | "assistant"; content: string }[]> = {};
function remember(chat: number, role: "user" | "assistant", content: string) { (history[chat] ||= []).push({ role, content }); if (history[chat].length > 16) history[chat] = history[chat].slice(-16); }

// ── brain: Claude via the Anthropic API ─────────────────────────────────────
function systemPrompt(): string {
  const persona = readOr(PROMPT_FILE, "You are ALEXANDRIA OS, a personal librarian and learning engine.");
  const profile = readOr(`${LEDGER}/PROFILE.md`); const lang = langOf();
  return persona +
    `\n\n## ACTIVE REPLY LANGUAGE\nReply in: ${lang || "English (default — unless the user clearly writes in another language)"}.` +
    (profile ? `\n\n## THIS USER'S PROFILE (from /setup)\n${profile}` : "") +
    `\n\n## CHANNEL\nYou are on Telegram (phone). Lead with the answer; chunked, bullet-friendly. For any structured diagram (a map, a graph, a tree) emit [[DIAGRAM: <mermaid code> | title]] on its own line — NEVER ASCII. To attach a file, emit [[SEND: /absolute/path | caption]].`;
}
async function brain(chat: number, userText: string): Promise<string> {
  remember(chat, "user", userText);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "content-type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 4096, system: systemPrompt(), messages: (history[chat] || []).map(m => ({ role: m.role, content: m.content })) }),
      signal: AbortSignal.timeout(180_000),
    });
    const j: any = await r.json();
    if (j?.error) return `⚠️ API error: ${esc(j.error.message || "unknown")}. Check ANTHROPIC_API_KEY and MODEL.`;
    const out = (j?.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
    remember(chat, "assistant", out); return out || "…";
  } catch (e: any) { return `⚠️ Could not reach the model: ${esc(String(e?.message || e))}`; }
}

// ── voice transcription: local open-source first, OpenAI fallback ────────────
function resolveBin(names: string[]): string | null { for (const n of names) for (const d of [`${homedir()}/.omega/bin`, `${homedir()}/.local/bin`, "/usr/local/bin", "/usr/bin"]) { const p = `${d}/${n}`; try { if (statSync(p).isFile()) return p; } catch {} } return null; }
async function transcribe(fileId: string, filename: string): Promise<string> {
  let audio: ArrayBuffer;
  try { const gf: any = await tg("getFile", { file_id: fileId }); const fp = gf?.result?.file_path; if (!fp) return ""; audio = await (await fetch(`https://api.telegram.org/file/bot${TOKEN}/${fp}`, { signal: AbortSignal.timeout(30_000) })).arrayBuffer(); } catch { return ""; }
  const bin = resolveBin(["omega-transcribe"]);
  if (bin) { const path = `${TMP}/stt-${Date.now()}-${filename}`; try { writeFileSync(path, Buffer.from(audio)); const p = Bun.spawnSync([bin, path, "--output", "json"], { stdout: "pipe", stderr: "pipe", timeout: 240_000 }); const t = String(JSON.parse(p.stdout?.toString() || "{}")?.full_text || "").trim(); if (t) return t; } catch {} finally { try { unlinkSync(path); } catch {} } }
  if (OPENAI_KEY) { try { const fd = new FormData(); fd.append("file", new Blob([audio]), filename); fd.append("model", "whisper-1"); const r: any = await (await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { authorization: `Bearer ${OPENAI_KEY}` }, body: fd, signal: AbortSignal.timeout(120_000) })).json(); return (r?.text || "").trim(); } catch {} }
  return "";
}
// optional local TTS via an omega-ttsd gateway (Piper/Kokoro)
async function synth(text: string, engine: string): Promise<Uint8Array | null> {
  const port = process.env.OMEGA_TTSD_PORT || "8765"; const speak = text.replace(/```[\s\S]*?```/g, " ").replace(/[*_`#>|]/g, "").replace(/\s+/g, " ").trim().slice(0, 2000);
  try { const r = await fetch(`http://127.0.0.1:${port}/tts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ engine, text: speak, voice: "", params: {} }), signal: AbortSignal.timeout(300_000) }); if (!r.ok) return null; return new Uint8Array(await r.arrayBuffer()); } catch { return null; }
}

// ── diagrams: REAL Mermaid via mermaid-cli (correct layout) + Chromium PNG ───
function resolveNpx(): string | null { return resolveBin(["npx"]); }
function resolveChrome(): string | null { const base = `${homedir()}/.cache/puppeteer/chrome`; try { for (const v of readdirSync(base)) for (const s of ["chrome-linux64/chrome", "chrome-linux/chrome"]) { const p = `${base}/${v}/${s}`; try { if (statSync(p).isFile()) return p; } catch {} } } catch {} for (const p of ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"]) { try { if (statSync(p).isFile()) return p; } catch {} } return null; }
const MERMAID_CFG = `{"theme":"base","themeVariables":{"fontFamily":"Inter, system-ui, sans-serif","fontSize":"15px","primaryColor":"#EEF0FF","primaryTextColor":"#0F172A","primaryBorderColor":"#6D5EFC","lineColor":"#94A3B8","secondaryColor":"#E6FBFF","tertiaryColor":"#EAF7F0"},"flowchart":{"curve":"basis","padding":14,"nodeSpacing":45,"rankSpacing":55}}`;
const MERMAID_PP = `{"args":["--no-sandbox","--disable-setuid-sandbox","--disable-gpu","--disable-dev-shm-usage"]}`;
// Models emit imperfect Mermaid — repair the common breakers so a diagram never silently fails.
function sanitizeMermaid(code: string): string {
  let c = code.trim();
  c = c.replace(/^```(?:mermaid)?\s*/i, "").replace(/```\s*$/i, "").trim();
  c = c.replace(/\\n/g, "<br/>");
  c = c.replace(/\s*\|\s*[A-Za-z][^|\n\]]{3,}\s*$/, "");
  return c.trim();
}
function mermaidSvg(code: string, outBase: string): string | null {
  const npx = resolveNpx(); if (!npx) return null;
  try {
    writeFileSync(`${outBase}.mmd`, sanitizeMermaid(code)); writeFileSync(`${outBase}.cfg.json`, MERMAID_CFG); writeFileSync(`${outBase}.pp.json`, MERMAID_PP);
    Bun.spawnSync([npx, "-y", "@mermaid-js/mermaid-cli", "-i", `${outBase}.mmd`, "-o", `${outBase}.svg`, "-p", `${outBase}.pp.json`, "-c", `${outBase}.cfg.json`, "-b", "white"], { stdout: "pipe", stderr: "pipe", timeout: 120_000 });
    if (statSync(`${outBase}.svg`).size > 0) { const s = readFileSync(`${outBase}.svg`, "utf8"); return s.includes("<svg") ? s : null; }
  } catch {}
  return null;
}
function svgToPng(svg: string, outBase: string): string | null {
  const chrome = resolveChrome(); if (!chrome) return null;
  const m = svg.match(/viewBox="[\d.-]+ [\d.-]+ ([\d.]+) ([\d.]+)"/); const w = Math.round(m ? parseFloat(m[1]) : 800) + 48, h = Math.round(m ? parseFloat(m[2]) : 600) + 48;
  const page = `<!doctype html><meta charset=utf-8><style>html,body{margin:0;background:#fff}#w{width:${w}px;height:${h}px;display:flex;align-items:center;justify-content:center}svg{max-width:100%;height:auto}svg rect{rx:12px;ry:12px}</style><div id=w>${svg.replace(/^[\s\S]*?(<svg)/, "$1")}</div>`;
  try { writeFileSync(`${outBase}.png.html`, page); Bun.spawnSync([chrome, "--headless", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2", `--window-size=${w},${h}`, "--default-background-color=FFFFFFFF", `--screenshot=${outBase}.png`, `file://${outBase}.png.html`], { stdout: "pipe", stderr: "pipe", timeout: 45_000 }); if (statSync(`${outBase}.png`).size > 0) return `${outBase}.png`; } catch {}
  return null;
}
const VIEWER = readOr(`${import.meta.dir}/lib/diagram-viewer.html`, "");
function diagramHtml(title: string, svg: string, pngDataUri = ""): string {
  const inner = svg.replace(/^[\s\S]*?(<svg)/, "$1");
  return VIEWER.replace(/__TITLE__/g, esc(title)).replace("__SVG__", inner).replace("__PNG__", pngDataUri);
}
type Diagram = { title: string; svg: string | null; png: string | null; viewer: string };
function renderDiagram(code: string, title: string, outBase: string): Diagram {
  const svg = mermaidSvg(code.trim(), outBase); const png = svg ? svgToPng(svg, outBase) : null;
  let uri = ""; if (png) { try { uri = `data:image/png;base64,${Buffer.from(readFileSync(png)).toString("base64")}`; } catch {} }
  const viewer = `${outBase}.view.html`; try { writeFileSync(viewer, diagramHtml(title, svg || "<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'></svg>", uri)); } catch {}
  return { title, svg, png, viewer };
}
const DIAGRAM_MARK = /\[\[DIAGRAM:\s*([\s\S]+?)\s*\]\]/g;   // code only — | collides with Mermaid edge labels
const SEND_MARK = /\[\[SEND:\s*([^\]|]+?)(?:\s*\|\s*([^\]]+))?\]\]/g;
const DTOKEN = (i: number) => `DIAGRAM${i}`;
function slug(s: string): string { return (s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/mode\s*[:·-]?\s*\w+/i, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "diagram"; }
function extractDiagrams(raw: string, cmdHint = "", baseTitle = "Diagram"): { text: string; diagrams: Diagram[] } {
  const diagrams: Diagram[] = []; let text = raw; const jobs = [...raw.matchAll(DIAGRAM_MARK)];
  for (let i = 0; i < jobs.length; i++) {
    const m = jobs[i]; const code = (m[1] || "").trim(); if (!code) { text = text.replace(m[0], ""); continue; }
    const title = jobs.length > 1 ? `${baseTitle} (${i + 1})` : baseTitle;
    const dir = `${TMP}/${Date.now()}-${i}`; mkdirSync(dir, { recursive: true });
    const name = `${slug(baseTitle)}${cmdHint ? "-" + slug(cmdHint) : ""}${jobs.length > 1 ? "-" + (i + 1) : ""}`;
    const d = renderDiagram(code, title, `${dir}/${name}`);
    diagrams.push(d); text = text.replace(m[0], d.svg ? `\n\n${DTOKEN(i)}\n\n` : "");
  }
  return { text: text.replace(/\n{3,}/g, "\n\n").trim(), diagrams: diagrams.filter(d => d.svg) };
}

// ── Markdown → HTML (document) + paper-style report ─────────────────────────
function mdDoc(md: string): string {
  const e = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inl = (s: string) => e(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>").replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2">$1</a>');
  const L = md.replace(/\r/g, "").split("\n"); const out: string[] = []; let i = 0;
  const list = (t: string, it: string[]) => { if (it.length) out.push(`<${t}>${it.map(x => `<li>${inl(x)}</li>`).join("")}</${t}>`); };
  while (i < L.length) { const ln = L[i];
    if (/^```/.test(ln)) { const b: string[] = []; i++; while (i < L.length && !/^```/.test(L[i])) b.push(L[i++]); i++; out.push(`<pre><code>${e(b.join("\n"))}</code></pre>`); continue; }
    if (/^\s*$/.test(ln)) { i++; continue; }
    const h = ln.match(/^(#{1,6})\s+(.*)$/); if (h) { out.push(`<h${h[1].length}>${inl(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^\s*([-*_])\1{2,}\s*$/.test(ln)) { out.push("<hr>"); i++; continue; }
    if (/^\s*>/.test(ln)) { const b: string[] = []; while (i < L.length && /^\s*>/.test(L[i])) b.push(L[i++].replace(/^\s*>\s?/, "")); out.push(`<blockquote>${inl(b.join(" "))}</blockquote>`); continue; }
    if (/^\s*\|.*\|\s*$/.test(ln) && i + 1 < L.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(L[i + 1])) { const row = (s: string) => s.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim()); const head = row(ln); i += 2; const body: string[][] = []; while (i < L.length && /^\s*\|.*\|\s*$/.test(L[i])) body.push(row(L[i++])); out.push(`<table><thead><tr>${head.map(c => `<th>${inl(c)}</th>`).join("")}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${inl(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`); continue; }
    if (/^\s*[-*•]\s+/.test(ln)) { const it: string[] = []; while (i < L.length && /^\s*[-*•]\s+/.test(L[i])) it.push(L[i++].replace(/^\s*[-*•]\s+/, "")); list("ul", it); continue; }
    if (/^\s*\d+[.)]\s+/.test(ln)) { const it: string[] = []; while (i < L.length && /^\s*\d+[.)]\s+/.test(L[i])) it.push(L[i++].replace(/^\s*\d+[.)]\s+/, "")); list("ol", it); continue; }
    const b: string[] = []; while (i < L.length && !/^\s*$/.test(L[i]) && !/^(#{1,6}\s|```|\s*[-*•]\s|\s*\d+[.)]\s|\s*>|\s*\|)/.test(L[i])) b.push(L[i++]); out.push(`<p>${inl(b.join(" "))}</p>`);
  }
  return out.join("\n");
}
function deriveTitle(md: string): string { const h = md.match(/^#{1,6}\s+(.+)$/m) || md.match(/^\*\*(.+?)\*\*/m); return ((h ? h[1] : (md.split("\n").find(l => l.trim()) || "Alexandria")).replace(/[#*`_>]/g, "").trim().slice(0, 70)) || "Alexandria"; }
const REPORT_CSS = readOr(`${import.meta.dir}/lib/report.css`, "");
function reportHtml(title: string, md: string, diagrams: Diagram[]): string {
  let body = mdDoc(md);
  diagrams.forEach((d, i) => { const fig = d.svg ? `<figure class="dg">${d.svg.replace(/^[\s\S]*?(<svg)/, "$1")}${d.title && d.title !== "Diagram" ? `<figcaption>${esc(d.title)}</figcaption>` : ""}</figure>` : ""; body = body.replace(new RegExp(`<p>\\s*${DTOKEN(i)}\\s*</p>`), fig).replace(DTOKEN(i), fig); });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${esc(title)}</title><style>${REPORT_CSS}</style></head><body><div class="wrap"><article class="sheet"><div class="brand"><span class="dot"></span> Agentik Book {OS}</div><h1 class="doc">${esc(title)}</h1>${body}<div class="foot">Generated by Agentik Book {OS}</div></article></div></body></html>`;
}

// ── deliver a reply: report (long) vs inline (short); diagrams via the viewer ─
async function deliverReply(chat: number, raw: string, cmdHint = ""): Promise<string> {
  const { text: t1, diagrams } = extractDiagrams(raw, cmdHint, deriveTitle(raw));
  let text = t1;
  for (const m of [...text.matchAll(SEND_MARK)]) { const p = (m[1] || "").trim(); if (p) await sendFile(chat, p, (m[2] || "").trim() || undefined); }
  text = text.replace(SEND_MARK, "").trim();
  const isLong = text.length > 1200 || (diagrams.length > 0 && text.length > 500) || diagrams.length >= 2;
  if (isLong) {
    const title = deriveTitle(text); const dir = `${TMP}/${Date.now()}`; mkdirSync(dir, { recursive: true });
    const path = `${dir}/${slug(title)}${cmdHint ? "-" + slug(cmdHint) : ""}.html`;
    try { writeFileSync(path, reportHtml(title, text, diagrams)); } catch {}
    for (const d of diagrams) if (d.png) await sendFile(chat, d.png, `📊 ${d.title}`);
    await sendFile(chat, path, `📄 ${title}`);
    const first = (text.replace(/DIAGRAM\d+/g, "").replace(/[#*`>_|]/g, "").split("\n").find(l => l.trim().length > 40) || text).trim().slice(0, 240);
    return `<b>📄 ${esc(title)}</b>\n${esc(first)}…\n\n<i>Full answer in the attached file.</i>`;
  }
  for (const d of diagrams) { if (d.png) await sendFile(chat, d.png, `📊 ${d.title}`); await sendFile(chat, d.viewer, "📄 Open to zoom / export / share"); }
  return mdToTg(text.replace(/DIAGRAM\d+/g, "").replace(/\n{3,}/g, "\n\n").trim() || "✓");
}
function mdToTg(md: string): string { let s = esc(md); s = s.replace(/```([\s\S]*?)```/g, (_, c) => `<pre>${c}</pre>`).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(^|\s)\*([^*\n]+)\*/g, "$1<i>$2</i>").replace(/^#{1,6}\s*(.+)$/gm, "<b>$1</b>").replace(/^\s*[-•]\s+/gm, "• "); return s; }

// ── guided /setup wizard + ask-for-input on bare commands ────────────────────
const setupState: Record<number, Record<string, string>> = {}; const pendingInput: Record<number, string> = {};
const STEPS: { key: string; q: string; opts: [string, string][] }[] = [
  { key: "style", q: "1/4 · How do you learn best?", opts: [["🖼 Visual", "visual"], ["📖 Verbal", "verbal"], ["🛠 Hands-on", "hands-on"], ["🔀 Mixed", "mixed"]] },
  { key: "attention", q: "2/4 · Session shape?", opts: [["⚡ Short bursts", "short bursts"], ["🌊 Long dives", "long deep dives"], ["🔀 Depends", "flexible"]] },
  { key: "memory", q: "3/4 · What makes ideas stick?", opts: [["📚 Stories", "stories"], ["🎨 Images", "vivid images"], ["🔁 Repetition", "spaced repetition"], ["🥊 Challenge me", "being challenged"]] },
  { key: "lang", q: "4/4 · Reply language?", opts: [["🇬🇧 English", "en"], ["🇫🇷 Français", "fr"], ["🇪🇸 Español", "es"], ["🌐 Auto", "auto"]] },
];
const stepKb = (s: number) => ({ inline_keyboard: [...STEPS[s].opts.map(o => [{ text: o[0], callback_data: `set:${s}:${o[1]}` }]), [{ text: "✍️ or just tell me", callback_data: "set:chat" }]] });
const NEEDS_INPUT: Record<string, string> = { book: "📖 Which book? Send the title.", espresso: "☕ Which book?", chapter: "📑 Which book (chapter by chapter)?", idea: "🗺 Which idea/topic to map?", compare: "⚔️ Which books/authors?", apply: "🔧 Which idea, to what?", challenge: "🥊 What idea/plan to challenge?", decision: "🎯 What decision?", council: "🏛 What question?", teach: "🧑‍🏫 Teach you what?", memory: "🧠 Memorize what?", cards: "🃏 Flashcards on what?", map: "📊 Diagram what?", best: "🏆 Best books on what topic?", bestsellers: "📈 Best-sellers in which niche?", readingpath: "📚 Reading path toward what?", focus: "⏱ Focus on what?", audio: "🎧 Listen mode on what?" };

const COMMANDS = [["setup", "🎛 Calibrate me on how you learn"], ["language", "🌐 Reply language (default English)"], ["voice", "🔊 Voice replies on/off"], ["book", "📖 Full X-ray of a book"], ["espresso", "☕ A book in 90 seconds"], ["chapter", "📑 A book chapter by chapter"], ["best", "🏆 Top 50 books + 50 tips"], ["bestsellers", "📈 Top 100 best-sellers in a niche"], ["idea", "🗺 Atlas of an idea"], ["compare", "⚔️ Books in combat"], ["challenge", "🥊 Sparring on your idea"], ["council", "🏛 Council of perspectives"], ["memory", "🧠 Forge durable memory"], ["map", "📊 Diagram a concept"], ["focus", "⏱ 5-min session"], ["audio", "🎧 Listen mode"], ["review", "🔁 Spaced repetition"], ["gem", "💎 An underrated idea"], ["start", "What I can do"]];

async function main() {
  const me: any = await tg("getMe", {}); const name = me?.result?.first_name || "Alexandria";
  await tg("setMyCommands", { commands: COMMANDS.map(([command, description]) => ({ command, description })) });
  await tg("deleteWebhook", { drop_pending_updates: false });
  console.log(`Agentik Book {OS} up: @${me?.result?.username} (${name}), whitelist=${ALLOW.join(",")}`);
  let offset = 0;
  while (true) {
    const r: any = await tg("getUpdates", { offset, timeout: 50, allowed_updates: ["message", "callback_query"] });
    if (!r?.ok) { await Bun.sleep(2000); continue; }
    for (const u of r.result) { offset = u.update_id + 1;
      if (u.callback_query) { const q = u.callback_query; await tg("answerCallbackQuery", { callback_query_id: q.id }); if (ALLOW.includes(q.from?.id ?? 0)) await onSetup(q); continue; }
      const msg = u.message; if (!msg) continue; const from = msg.from?.id ?? 0; if (!ALLOW.includes(from)) { console.log(`drop ${from}`); continue; }
      try { await handle(msg.chat.id, from, msg, name); } catch (e) { console.error(e); }
    }
  }
}
async function onSetup(q: any) {
  const cid = q.message.chat.id, mid = q.message.message_id, uid = q.from?.id ?? 0; const parts = (q.data || "").split(":");
  if (parts[1] === "chat") { await edit(cid, mid, "👍 Just tell me about yourself — what you do, how you like to learn — and I'll calibrate."); return; }
  const step = Number(parts[1]); const val = parts.slice(2).join(":"); (setupState[uid] ||= {})[STEPS[step].key] = val;
  if (step + 1 < STEPS.length) { await edit(cid, mid, `<b>🎛 Setup</b>\n${esc(STEPS[step + 1].q)}`, stepKb(step + 1)); return; }
  const a = setupState[uid] || {}; const langMap: Record<string, string> = { en: "English", fr: "Français", es: "Español", auto: "" }; const lang = langMap[a.lang ?? "auto"];
  try { if (lang) writeFileSync(`${LEDGER}/LANGUAGE.txt`, lang); else unlinkSync(`${LEDGER}/LANGUAGE.txt`); } catch {}
  writeFileSync(`${LEDGER}/PROFILE.md`, `# Learning profile (from /setup)\n- Learning style: ${a.style || "mixed"}\n- Session shape: ${a.attention || "flexible"}\n- Memory that sticks: ${a.memory || "stories"}\n- Reply language: ${a.lang === "auto" || !a.lang ? "auto (English default)" : lang}\n\nAdapt every explanation, analogy, diagram and drill to this.`);
  delete setupState[uid];
  await edit(cid, mid, `✅ <b>Calibrated.</b>\n• Learning: <b>${esc(a.style || "mixed")}</b> · ${esc(a.attention || "flexible")}\n• Memory: <b>${esc(a.memory || "stories")}</b>\n• Language: <b>${esc(a.lang === "auto" || !a.lang ? "auto (English)" : lang)}</b>\n\nTry <code>/book Atomic Habits</code> or just tell me a book, an idea or a decision.`);
}
async function handle(chat: number, from: number, msg: any, name: string) {
  let text = (msg.text || msg.caption || "").trim();
  const spoken = msg.voice || msg.video_note || msg.audio;
  if (!text && spoken) { await tg("sendChatAction", { chat_id: chat, action: "typing" }); const heard = await transcribe(spoken.file_id, msg.voice ? "voice.ogg" : msg.audio?.file_name || "audio.mp3"); if (!heard) { await send(chat, "🎤 Transcription unavailable. Install omega-transcribe (faster-whisper) or set OPENAI_API_KEY."); return; } text = heard; await send(chat, `🎤 <i>«${esc(heard)}»</i>`); }
  if (!text) return;
  if (text === "/start" || text === "/menu") { await send(chat, `<b>📚 ${esc(name)}</b>\nYour personal librarian. Give me a book, an idea, a decision or a problem and I turn it into understanding, memory and action. Send <b>/setup</b> to calibrate. English by default — <code>/language fr</code> to switch. Voice notes and PDF/EPUB welcome.`); return; }
  if (text === "/setup") { setupState[from] = {}; await send(chat, `<b>🎛 Setup</b> — 4 quick taps to calibrate on how you learn.\n${esc(STEPS[0].q)}`, stepKb(0)); return; }
  if (text === "/language" || text.startsWith("/language ")) { const a = text.replace(/^\/language\s*/i, "").trim(); if (!a) { await send(chat, `🌐 Current: <b>${esc(langOf() || "English (default)")}</b>. Change: <code>/language fr</code> · <code>/language auto</code>.`); return; } if (/^(auto|default|reset)$/i.test(a)) { try { unlinkSync(`${LEDGER}/LANGUAGE.txt`); } catch {} await send(chat, "🌐 Language: <b>auto</b>."); } else { writeFileSync(`${LEDGER}/LANGUAGE.txt`, a); await send(chat, `🌐 Language: <b>${esc(a)}</b>.`); } return; }
  if (text === "/voice" || text.startsWith("/voice ")) { const a = text.replace(/^\/voice\s*/i, "").trim().toLowerCase(); if (!a) { await send(chat, voiceOf() ? `🔊 Voice: <b>on</b> (${esc(voiceOf())}). Off: <code>/voice off</code>.` : "🔇 Voice: <b>off</b>. On: <code>/voice on</code> (needs a local omega-ttsd gateway)."); return; } if (/^(off|no|text)$/i.test(a)) { try { unlinkSync(`${LEDGER}/VOICE.txt`); } catch {} await send(chat, "🔇 Voice off."); } else { writeFileSync(`${LEDGER}/VOICE.txt`, /^(on|yes)$/i.test(a) ? "piper" : a); await send(chat, `🔊 Voice on.`); } return; }
  const bare = text.match(/^\/([a-z]+)$/i);
  if (bare && NEEDS_INPUT[bare[1].toLowerCase()]) { pendingInput[from] = bare[1].toLowerCase(); await send(chat, NEEDS_INPUT[bare[1].toLowerCase()]); return; }
  if (pendingInput[from] && !text.startsWith("/")) { text = `/${pendingInput[from]} ${text}`; delete pendingInput[from]; } else if (text.startsWith("/")) delete pendingInput[from];

  await tg("sendChatAction", { chat_id: chat, action: "typing" });
  const ph = await tg("sendMessage", { chat_id: chat, text: "🧠 <i>thinking…</i>", parse_mode: "HTML" });
  const cmdHint = (text.match(/^\/([a-z]+)/i)?.[1] || "").toLowerCase();
  const raw = await brain(chat, text); const outText = await deliverReply(chat, raw, cmdHint);
  const phId = ph?.result?.message_id;
  if (phId) await edit(chat, phId, outText); else await send(chat, outText);
  const eng = voiceOf(); if (eng) { const ogg = await synth(raw, eng); if (ogg) await sendVoice(chat, ogg); }
}
main();
