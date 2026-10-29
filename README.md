# lostfrxks

<p align="center">
  <strong>Matrix-terminal portfolio for Artur Usenov.</strong><br>
  Fullstack developer focused on backend systems, AI integrations, and practical product interfaces.
</p>

<p align="center">
  <a href="https://lostfrxks.com">Website</a>
  &nbsp;/&nbsp;
  <a href="https://github.com/LostFrxks">GitHub</a>
  &nbsp;/&nbsp;
  <a href="assets/artur-usenov-resume.pdf">Resume</a>
  &nbsp;/&nbsp;
  <a href="mailto:lostfrxks@gmail.com">Contact</a>
</p>

<p align="center">
  <img alt="Static site" src="https://img.shields.io/badge/static-site-5cffb1?style=flat-square&labelColor=020403&color=5cffb1">
  <img alt="JavaScript" src="https://img.shields.io/badge/javascript-vanilla-f7df1e?style=flat-square&labelColor=020403&color=f7df1e">
  <img alt="Playwright" src="https://img.shields.io/badge/tests-playwright-45ba4b?style=flat-square&labelColor=020403&color=45ba4b">
  <img alt="Domain" src="https://img.shields.io/badge/domain-lostfrxks.com-65e7ff?style=flat-square&labelColor=020403&color=65e7ff">
</p>

```txt
lostfrxks@portfolio:~$ ./boot_artur.sh
loading public profile...
mounting projects: GUROO, USC, Homy, embedding-search
status: online
```

## whoami

I am Artur Usenov, also known as `lostfrxks`. I build backend-heavy fullstack systems with a bias toward clean APIs, useful automation, and interfaces that feel sharp instead of noisy.

Current focus:

- Python, Django, FastAPI, TypeScript, and React.
- AI integrations, semantic search, and practical automation.
- Portfolio-grade systems that ship beyond coursework and demos.

## featured systems

| Project | What it is | Stack |
| --- | --- | --- |
| [GUROO](https://github.com/LostFrxks/GUROO) | Tutor and student registration system for AUCA with attendance, schedules, Excel export, and Telegram notifications. | Django, JavaScript, SQLite |
| [USC](https://github.com/LostFrxks/USC) | Docker-ready marketplace MVP with web, mobile, backend API, analytics, AI screens, tests, and deployment docs. | FastAPI, React, Expo, Docker |
| [Homy](https://github.com/LostFrxks/homy) | Real estate CRM with objects, deals, showings, favorites, audit trails, JWT auth, and agent profiles. | Django, DRF, React, Vite, PostgreSQL |
| [embedding-search](https://github.com/LostFrxks/embedding-search) | Lalafo-style semantic search prototype with scraping, embeddings, cosine similarity, filters, and API endpoints. | Python, FastAPI, embeddings |

## site

This repository contains the source for the portfolio at:

```txt
https://lostfrxks.com
```

The site is intentionally simple at the infrastructure level: plain HTML, CSS, and JavaScript served as a static website.

```txt
.
|-- index.html
|-- styles.css
|-- app.js
|-- ascii-torus.js
|-- favicon.svg
|-- assets/
`-- tests/
```

## stack

- HTML, CSS, and vanilla JavaScript.
- Matrix rain and intro animation in browser JavaScript.
- Responsive terminal-inspired UI.
- Playwright coverage for title, favicon, layout, intro behavior, scroll behavior, and visual interaction details.
- `serve` for local development.

## run locally

```bash
npm install
npm run start
```

Open:

```txt
http://127.0.0.1:4173
```

## test

```bash
npm test
```

## deployment

The Netlify project is `lostfrxks-portfolio` in team `lostfrxks-ag-qqbi`.
Link the local CLI to this existing project before deploying:

```txt
netlify link --id 90b5171c-428e-481b-9ef7-f9cf68e4d55e
```

`npm run deploy:preview` builds the public files into `dist` and creates a preview.
After reviewing it, `npm run deploy:production` publishes the release. Combine small changes
into one production release to avoid spending deployment credits on every commit.

The build copies only the declared browser files and public assets. Source code for server
functions, tests, local configuration and credentials are excluded from `dist`. Functions
are bundled from `netlify/functions` during deployment so their API v2 routes and runtime
settings are preserved. The intended custom domain remains `lostfrxks.com`.

## private analytics

The portfolio includes private, first-party visit analytics backed by Netlify Functions and Netlify Blobs. Every page load gets a random visit ID; a separate random browser ID persists in local storage. The public page sends cumulative visible seconds, maximum scroll depth, section visibility time and click counts, alongside its entry pathname, referrer origin, campaign tags and optional device hints:

```json
{
  "sessionId": "random visit UUID",
  "browserId": "random persistent browser UUID",
  "activeSeconds": 42,
  "pagePath": "/",
  "referrer": "https://google.com",
  "utm": {},
  "deviceHints": {},
  "scrollPercent": 75,
  "sections": [{"id": "projects", "seconds": 15}],
  "clicks": [{"target": "/assets/artur-usenov-resume.pdf", "label": "Resume", "count": 1}]
}
```

The server derives device, OS and browser from the HTTP user agent and stores trusted Netlify IP and approximate country/region/city. Screen dimensions, form values, keypresses, credentials and arbitrary URL query parameters are not collected. Clicks identify navigation intent; they do not prove a completed download or message. Device/model and location availability varies by browser and network.

Detailed visits are retained indefinitely as independent ETag-protected blobs. Heartbeat retries merge cumulative maxima rather than duplicating visits or reducing activity. Payloads are bounded to eight named sections, 64 distinct click destinations and 32 KiB. The legacy statistics and date-only visit history remain intact, and the existing daily compactor never deletes detailed visits.

After successful password authentication, the dashboard registers that browser as the owner. All its detailed visits, including those collected before login, remain in history with an amber **Ты** badge but are excluded from counts and average duration. Other browsers sharing its IP are unaffected. Clearing browser storage or using another browser requires a new admin login. Historic anonymous visits cannot be identified retrospectively.

The history is newest-first in Bishkek time with expandable cards and 50 visits per page. Every history read, pagination request and owner registration verifies an opaque server session. Login alone sends the password over HTTPS; the dashboard immediately clears the input and never saves it to browser storage. The cookie (`__Host-lostfrxks_admin`) is HttpOnly, Secure, SameSite=Strict, and expires after 8 hours. Only its SHA-256 digest is stored in the separate `private-analytics-sessions` Blobs store. Lock revokes that session on the server and clears rendered private data. Password or session-secret rotation invalidates existing sessions; the daily compactor removes expired session records. Netlify may retain ordinary infrastructure logs independently of this dataset.

`/secret.html` is intentionally unlinked. Its data API requires the `ANALYTICS_ADMIN_PASSWORD` and `ANALYTICS_SESSION_SECRET` Netlify environment variables. Generate the session secret from at least 32 random bytes; keep both values server-side. Use a strong password and keep it outside the repository.

Copy it to **Netlify → Project configuration → Environment variables → `ANALYTICS_ADMIN_PASSWORD`**. Never commit it or place it in a tracked `.env` file.

Run only the static site with:

```bash
npm run start
```

For Functions and local Netlify Blobs, open `http://localhost:8888` after running:

```bash
ANALYTICS_ADMIN_PASSWORD=local-development-password ANALYTICS_SESSION_SECRET=local-development-secret-at-least-32-characters npm run dev
```

Netlify Free has finite monthly allowances. Check project usage after deployment if traffic grows.

## contact

- Email: [lostfrxks@gmail.com](mailto:lostfrxks@gmail.com)
- GitHub: [github.com/LostFrxks](https://github.com/LostFrxks)
- Telegram: [t.me/lostfrxks](https://t.me/lostfrxks)
- Instagram: [instagram.com/lostfrxks](https://www.instagram.com/lostfrxks/)
