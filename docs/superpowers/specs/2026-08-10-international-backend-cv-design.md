# International Backend Engineer CV Design

## Goal

Create a one-page English CV for international remote and relocation-oriented Backend Engineer applications. Position Artur as a production backend engineer working with Go, Python, event-driven systems, PostgreSQL, Kubernetes, and AI-enabled infrastructure. AI is a differentiator, not a narrow job-title constraint.

The existing `/mnt/acer/Users/asus/Desktop/Work/stuff/Artur_Usenov_CV.pdf` remains unchanged. The redesign produces a separately named PDF and an editable source file. Publishing the new PDF on `lostfrxks.com` is outside this phase and requires a separate explicit request after review.

## Audience and Positioning

- Primary audience: international recruiters and engineering managers hiring Backend Engineer or Software Engineer candidates.
- Secondary fit: AI Backend, platform, marketplace, fintech, search, and developer-tool roles.
- Do not use `Junior` or position Artur primarily as a fullstack developer.
- Use a market-standard headline: `Backend Engineer | Go & Python | Distributed Systems & AI Infrastructure`.
- State availability for remote roles and international relocation without making it the focus of the summary.

## Source and Accuracy Contract

- Use the July 2026 English CV, the public portfolio, and the public LinkedIn profile as source material.
- Preserve only supportable public claims and already documented metrics.
- Do not expose internal branch names, namespaces, endpoints, database identifiers, secrets, or confidential implementation details.
- Use `GPA 3.80 / 4.00`, `Graduated with Honors`, and `2023-2026` consistently.
- Keep employment dates at year precision unless an authoritative month is available; do not invent a start month.
- Name the AI award as `Winner - Mbank Ecosystem x OpenAI Codex Challenge, 2026` and describe it as recognition for applying AI/Codex to improve MMarket engineering workflows and process quality. Do not claim a functional-track rank or prize category that is not independently verified.

## Content Structure

### Header

- `ARTUR USENOV`
- `BACKEND ENGINEER | GO & PYTHON | DISTRIBUTED SYSTEMS & AI INFRASTRUCTURE`
- Bishkek, Kyrgyzstan; international phone format; email; LinkedIn; GitHub; portfolio.
- A compact `Open to remote roles and international relocation` note.

### Professional Summary

Use two concise sentences. Lead with production backend experience across marketplace microservices, event-driven workers, PostgreSQL, Kafka, and Kubernetes. Follow with the AI/search differentiator: Qdrant, LLM-assisted catalog automation, and production-safe batch processing. Avoid generic claims such as `passionate`, `fast learner`, or long keyword chains.

### Core Skills

Keep four compact categories in priority order:

1. Languages: Go, Python, SQL, TypeScript.
2. Backend and Data: FastAPI, Django/DRF, PostgreSQL, Kafka, Redis, Qdrant, SQLAlchemy, Alembic, REST APIs, transactional outbox.
3. Platform: Docker, Kubernetes, GitLab CI/CD, ArgoCD, Helm, Rancher, Vault, Linux.
4. Quality: pytest, Ruff, Playwright, schema validation, dry-runs, rollout verification, production data checks.

C++ is omitted from the core skill block. Competitive-programming achievements provide the algorithmic signal without displacing primary backend keywords.

### Professional Experience

#### Backend Developer - MDigital / MMarket, 2026-Present

Use at most four bullets:

- Runtime and workload separation for Go API, worker, and outbox-worker Kubernetes services, including backward-compatible execution modes.
- AI-assisted catalog mapping and search pipelines using LLM APIs, Qdrant, Kafka workers, confidence scoring, and safety checks.
- Verified scale and reliability result: 36,143 products processed with zero failed segments, plus preparation of the documented 253,897-product analytical dataset and 550,602 cleaned attributes.
- PostgreSQL migration and deployment diagnosis through schema verification, temporary jobs, safe metadata repair, rollout checks, and post-deploy smoke validation.

Prefer direct ownership language where supported. Retain `contributed` where the work was shared and avoid implying sole ownership of company systems.

#### Software Developer Intern - MBank / MMarket, Dec 2025-Feb 2026

Use two bullets:

- FastAPI recommendation service over millions of monthly transactions using frequency, recency, similarity, time-decay, and discovery signals.
- Training and prediction endpoints, Recall@K/MRR@K evaluation, artifact persistence, and an interactive repeat/discovery demo.

### Selected Projects

Use three compact entries with clickable links:

- ATLAS-STORE: live e-commerce system emphasizing Django REST, PostgreSQL, Redis, Celery, order tooling, deployment, and tests.
- AGL.KG: live medical-equipment catalog emphasizing production delivery, localized catalog ingestion, product/document workflows, and automated tests.
- Embedding Search: FastAPI and SQLAlchemy semantic-search prototype using embeddings, cosine similarity, ingestion, and filters.

Omit USC and GUROO from the one-page master CV to avoid diluting current production backend positioning. They remain available on the portfolio.

### Education and Awards

- Software Engineering and Social Transformation, TSI AUCA, 2023-2026.
- Graduated with Honors; GPA 3.80 / 4.00.
- Winner - Mbank Ecosystem x OpenAI Codex Challenge, 2026; recognized for applying AI/Codex to improve MMarket engineering workflows and process quality.
- ICPC NERC 2025 finalist; 9th of 61 teams in the Kyrgyzstan qualification.
- Winner, TSI Programming Contest 2026.
- `300+ LeetCode problems solved` remains as a compact signal.
- Makeathon is omitted from the one-page master version.

## Visual and ATS Contract

- One A4 page with a single-column reading order.
- No photograph, sidebar, skill bars, tables used for layout, decorative icons, or multi-column text flow.
- Use a restrained navy accent consistent with the current English CV.
- Body text must be at least 10 pt with clear spacing and no large unused lower-page area.
- Links must be visually identifiable, clickable, and preserve useful visible text.
- Use standard Latin punctuation in machine-readable text. Avoid slash-heavy job titles and excessive capitalization outside the header.
- Set PDF title and author metadata to `Artur Usenov - Backend Engineer CV` and `Artur Usenov`.

## Deliverables

- Editable HTML/CSS source beside the standalone CV artifacts in `/mnt/acer/Users/asus/Desktop/Work/stuff/`.
- New PDF named `Artur_Usenov_Backend_Engineer_CV_2026.pdf` in the same directory.
- The existing `Artur_Usenov_CV.pdf` and the website's old Russian resume remain untouched during this phase.

## Verification

- Confirm the generated PDF is exactly one A4 page with `pdfinfo`.
- Extract all text with `pdftotext` and confirm natural reading order, required sections, award wording, metrics, and URLs.
- Confirm email, LinkedIn, GitHub, portfolio, and project links are clickable PDF annotations.
- Render the page to an image and inspect hierarchy, spacing, wrapping, font size, clipping, and page balance.
- Verify the PDF contains no Russian copy, stale `Fullstack Developer` positioning, `student` status, GPA 3.85, `Junior`, placeholders, or unverified award rank.
- Compare the final claims with the approved source material before reporting completion.

## Out of Scope

- Editing or publishing the LinkedIn profile.
- Changing or deploying `lostfrxks.com`.
- Replacing the existing website download link or its Russian PDF.
- Creating vacancy-specific Backend and AI Backend variants.
