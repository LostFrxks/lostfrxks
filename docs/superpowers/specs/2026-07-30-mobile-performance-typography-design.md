# Mobile Performance and Typography Design

## Goal

Make the portfolio lighter and denser on phone-sized viewports without changing the desktop experience.

## Mobile Contract

The existing `max-width: 680px` media query defines the phone layout. At that width and below:

- Hide the complete `.site-header`, including the brand and section navigation.
- Let the hero use the viewport height without reserving space for the removed header.
- Hide the complete `#ascii-torus` section.
- Prevent `ascii-torus.js` from initializing its renderer, animation frame loop, pointer handlers, observer, or debug API.
- Set the root font size to `87.5%` of the browser default so rem-based text is 12.5% smaller across the page. Rem-based spacing becomes proportionally denser.
- Preserve a minimum `44px` height for primary and contact actions after the type scale is reduced.

## Desktop Contract

Above `680px`, the current header, typography, and interactive ASCII torus remain unchanged. The torus must still render, reveal, rotate, and respond to pointer input.

## Implementation Boundaries

- Keep the responsive layout in the existing mobile media query in `styles.css`.
- Add a matching `max-width: 680px` initialization guard near the top of `ascii-torus.js`.
- Do not remove header or torus markup from `index.html`; desktop and accessibility structure remain intact.
- Do not add device detection, user-agent checks, new dependencies, or a second responsive breakpoint.

## Verification

- Update Playwright mobile coverage to assert that the full header and torus are hidden at `390px`.
- Assert that the torus renderer does not initialize on mobile.
- Assert the reduced root font size and preserved `44px` action height on mobile.
- Keep desktop coverage for a visible, fully rendered interactive torus and visible header.
- Run unit tests and the complete Playwright suite through system Chrome.
- Inspect desktop and mobile screenshots for overflow, readability, and spacing regressions.

## Scope

Only responsive CSS, the torus initialization guard, and directly affected Playwright coverage are included. Production deployment is separate and requires an explicit request.
