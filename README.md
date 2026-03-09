# QuantOS — Quant Career Operating System

> A free, open-source study and career platform for students pursuing quantitative finance.  
> No accounts. No servers. No cost. Everything runs on your device.
> still under development, some courses may take time to connect. Your contributions in Quantos-data repository would be appreciated.

![Version](https://img.shields.io/badge/version-v1.20-C17F3A)
![License](https://img.shields.io/badge/license-MIT-10b981)
![Status](https://img.shields.io/badge/status-active-6366f1)
![Stack](https://img.shields.io/badge/stack-React%20%2B%20localStorage-0ea5e9)

---

## What is QuantOS?

QuantOS is a complete career preparation platform for students who want to break into quantitative finance — as researchers, traders, developers, or risk quants — without paying for expensive prep courses or subscriptions.

Built by a student, for students who can't afford the alternatives.

**Everything is free. Everything runs locally. Your data never leaves your browser.**

---

## Modules

| Module | Nav ID | What it does |
|--------|--------|-------------|
| **Dashboard** | `dashboard` | Today's Focus, live KPIs, readiness radar, study calendar, flow guide, timetable, memory curve |
| **Career Roadmap** | `roadmap` | 4 career tracks, AI advisor, milestones, course checklist, target firms |
| **Learning Path** | `learning` | Full course library (207 courses), lecture-by-lecture tracking, skill tree |
| **Competitions** | `competitions` | 63+ competitions with filters, bookmarks, AI live search, notes, .ics export |
| **Career Prep** | `career` *(mobile)* | Practice + Networking + Internships + Jobs in one place (mobile only) |
| **Practice** | `interview` *(desktop)* | AI interview Q&A, question bank, flashcards |
| **Networking** | `networking` *(desktop)* | Contact CRM, follow-up alerts, AI contact discovery |
| **Resource Hub** | `resources` | arXiv live search, curated books, quant tools |

> **Mobile vs Desktop nav:** On mobile, Practice + Networking + Internships + Jobs collapse into a single "Career Prep" tab with internal sub-tabs. On desktop they appear as separate sidebar items.

---

## Career Tracks

| Track | ID | Timeline | Focus |
|-------|----|----------|-------|
| Quantitative Researcher | `qr` | 18–24 months | Signals, stat models, hedge fund/prop shop |
| Quantitative Trader | `qt` | 12–18 months | Execution, pricing, market microstructure |
| Quant Developer | `qd` | 12–18 months | Low-latency C++, trading infrastructure |
| Risk Quant | `risk` | 12–18 months | Risk models, stress testing, regulatory |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| UI | React 18 (single JSX file, no build step to run it) |
| Persistence | `localStorage` (no backend, no database) |
| Fonts | Syne (headings), Inter (body), JetBrains Mono (code/labels) |
| Hosting | Cloudflare Pages (free, unlimited bandwidth) |
| AI features | User's own API key — Groq / Gemini / Mistral / Anthropic |
| Data pipeline | GitHub raw JSON (optional, replaces hardcoded arrays) |

---

## Running Locally

**Zero install — open in Claude.ai artifacts:**
Drop `QuantOS_v1_20.jsx` into claude.ai → it runs instantly.

**Local dev with hot-reload:**
```bash
git clone https://github.com/YOUR_USERNAME/quantos
cd quantos
npm create vite@latest . -- --template react
# Replace src/App.jsx content with QuantOS_v1_20.jsx content
npm install && npm run dev
```

---

## AI Features Setup

AI powers interview practice, the career advisor, competition search, and networking discovery.  
**You supply your own key — it lives only on your device, never on any server.**

**Recommended free option (Groq):**
1. Go to [console.groq.com/keys](https://console.groq.com/keys)
2. Create a free account → generate key
3. In QuantOS → click ⚙ in sidebar → paste key → Save

Free Groq tier: **14,400 requests/day** — ample for daily use.

Supported providers: Groq · Google Gemini · Mistral · Anthropic

---

## Data & Privacy

- All progress, notes, and settings stored in browser `localStorage`
- No data sent to any server (except your chosen AI provider during AI calls)
- Clearing browser data resets the app — export first
- No analytics, no tracking, no cookies, no ads

---

## Repository Structure (Phase 2)

```
quantos/                   ← Main app repo
├── src/
│   └── App.jsx            ← QuantOS_v1_20.jsx (renamed)
├── index.html
├── package.json
├── vite.config.js
├── README.md
├── SITEMAP.md
├── DATA_SCHEMA.md
├── CONTRIBUTING.md
└── IMPLEMENTATION_GUIDE.docx

quantos-data/              ← Separate public data repo
├── courses.json
├── competitions.json
├── internships.json
└── jobs.json

---

## Disclaimer

Courses and career tracks are community-curated free resources. They are starting points, not guarantees. Quant hiring is competitive. Always verify role requirements directly with firms.

---

## License

MIT — free to use, fork, modify, distribute.  
If this helped you land a role, consider contributing back.

---

*Built with zero budget and a lot of stubbornness.*

