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

The repository includes a `CNAME` file for:

```txt
lostfrxks.com
```

The site can be served from any static host. If GitHub Pages is used, the custom domain should stay `lostfrxks.com` so the domain remains the primary public address.

## private analytics

The portfolio includes free, first-party anonymous analytics backed by Netlify Functions and Netlify Blobs. The browser sends only a random tab-scoped UUID and cumulative visible seconds:

```json
{
  "sessionId": "random tab-scoped UUID",
  "activeSeconds": 42
}
```

The server stores those anonymous live sessions and daily totals in one ETag-protected state document. Application code does not store IP addresses, user agents, referrers, URLs, query parameters, location, language, or device data. Netlify may retain ordinary infrastructure logs independently of this dataset.

`/secret.html` is intentionally unlinked. Its data API requires the `ANALYTICS_ADMIN_PASSWORD` Netlify environment variable. Use a strong password and keep it outside the repository.

Copy it to **Netlify → Project configuration → Environment variables → `ANALYTICS_ADMIN_PASSWORD`**. Never commit it or place it in a tracked `.env` file.

Run only the static site with:

```bash
npm run start
```

For Functions and local Netlify Blobs, open `http://localhost:8888` after running:

```bash
ANALYTICS_ADMIN_PASSWORD=local-development-password npm run dev
```

Netlify Free has finite monthly allowances. Check project usage after deployment if traffic grows.

## contact

- Email: [lostfrxks@gmail.com](mailto:lostfrxks@gmail.com)
- GitHub: [github.com/LostFrxks](https://github.com/LostFrxks)
- Telegram: [t.me/lostfrxks](https://t.me/lostfrxks)
- Instagram: [instagram.com/lostfrxks](https://www.instagram.com/lostfrxks/)
