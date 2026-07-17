# Secret Analytics Gate Design

## Goal

Make the private analytics page non-descriptive before authentication while preserving the existing password-protected dashboard after a successful login.

## Behavior

- The page moves from `/analytics.html` to `/secret.html`; the old static URL is removed.
- Before authentication, the viewport shows only one centered password input. Its label and submit button remain available to assistive technology but are visually hidden; Enter submits the form.
- A rejected password shows only `Access denied.` and never identifies the page.
- A temporary server failure shows `Temporarily unavailable.`
- After successful authentication, the existing terminal heading, toolbar, and four analytics cards appear unchanged.
- Locking the dashboard returns to the anonymous single-input gate.
- The password remains enforced by the stats Function; the hidden URL is only an obscurity layer, not the security boundary.

## Verification

Focused Playwright coverage checks the new URL, anonymous locked DOM, generic denial, successful reveal, and absence of `/analytics.html` references in active site files.
