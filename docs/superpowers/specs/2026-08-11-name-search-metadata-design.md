# Name Search Metadata Design

**Date:** 2026-08-11

## Goal

Help search engines associate `https://lostfrxks.com/` with Artur Usenov across the legitimate public name variants `Artur Usenov`, `Artur U`, `Артур Усенов`, `Усенов Артур`, and `Артур У`, without changing any visible page content or layout.

This work can improve entity recognition and search-result relevance, but it cannot guarantee Google autocomplete suggestions because autocomplete also depends on aggregate query demand and Google systems outside the site's control.

## Scope

The implementation will make metadata-only and crawler-facing changes:

- Keep the existing visible HTML, title, headings, copy, CSS, JavaScript, and interactions unchanged.
- Add a self-referencing canonical URL for `https://lostfrxks.com/`.
- Update the non-visible meta description to identify `Artur Usenov` and `Артур Усенов` naturally, without repeating every abbreviation.
- Add one valid JSON-LD `ProfilePage` object whose `mainEntity` is a `Person`.
- Set the canonical person name to `Artur Usenov`.
- Set `alternateName` to the approved variants: `Artur U`, `Артур Усенов`, `Усенов Артур`, `Артур У`, and `lostfrxks`.
- Include the canonical site URL, crawlable profile image, current backend-engineer description, and public `sameAs` identity links already present on the site.
- Add `robots.txt` that allows normal crawling and advertises the sitemap.
- Add a one-URL `sitemap.xml` containing only the canonical homepage.

The implementation will not add `meta keywords`, hidden visible text, duplicated keyword blocks, new pages, or UI changes. Google documents that `meta keywords` has no effect on indexing or ranking, so adding it would be misleading and ineffective.

## Structured Data Contract

The JSON-LD block will use this shape:

- `@context`: `https://schema.org`
- `@type`: `ProfilePage`
- `url`: `https://lostfrxks.com/`
- `mainEntity`:
  - `@type`: `Person`
  - `@id`: `https://lostfrxks.com/#person`
  - `name`: `Artur Usenov`
  - `alternateName`: the five approved alternate identifiers
  - `url`: `https://lostfrxks.com/`
  - `image`: `https://lostfrxks.com/assets/artur-usenov-profile.webp`
  - `jobTitle`: `Backend / AI Backend Engineer`
  - `description`: a concise factual summary aligned with the current page
  - `sameAs`: the existing public GitHub, LinkedIn, LeetCode, Telegram, and Instagram profile URLs

Only public URLs already exposed by the portfolio will be included. No private identifiers, analytics data, email address, or phone number will be added to structured data.

## Crawler Files

`robots.txt` will allow all user agents to crawl the public site and will reference `https://lostfrxks.com/sitemap.xml`.

`sitemap.xml` will contain the canonical homepage URL. It will omit a fabricated change frequency or priority. A `lastmod` value may be included only when it represents the actual metadata publication date.

## Validation

Automated checks will verify that:

- the existing visible page title and primary heading remain unchanged;
- the canonical URL is exact and unique;
- the JSON-LD parses as JSON and contains the exact approved name variants and public identity URLs;
- the JSON-LD contains no private contact fields;
- `robots.txt` allows crawling and references the exact sitemap URL;
- `sitemap.xml` is well-formed and contains only the canonical homepage;
- the existing unit and relevant browser tests still pass.

After pushing `main`, production verification will confirm HTTP 200 responses and correct content types for the homepage, `robots.txt`, and `sitemap.xml`, then inspect the public HTML and JSON-LD through a system Chrome smoke test.

## Release Boundary

The implementation will be committed separately from this design document, pushed to `main`, and verified on Netlify production. Search-engine recrawling is asynchronous; deployment proves that the metadata is publicly available, not that autocomplete suggestions have already changed.

## References

- [Google ProfilePage structured data](https://developers.google.com/search/docs/appearance/structured-data/profile-page)
- [Google supported meta tags](https://developers.google.com/search/docs/crawling-indexing/special-tags)
- [Google canonical URL guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- [Google sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview)
