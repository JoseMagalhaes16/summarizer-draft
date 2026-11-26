# 0009. Frontend: React 19, TypeScript, Vite, and plain CSS design tokens

- **Title:** Frontend: React 19, TypeScript, Vite, and plain CSS design tokens
- **Status:** Accepted
- **Date:** 2026-11-20

## Context

VetScribe's frontend is a single-page application with five pages: new note, note view and edit, notes history, template list, and template editor. It polls note status, edits structured sections inline, and copies rendered text. It has no server-side rendering needs, because the content is behind (future) authentication and is fetched from the API after load.

The hosting plan is a static build on S3 behind CloudFront, so the frontend must compile to static assets. The team wants a bespoke, clinical look that is accessible at 360px width, and a small bundle for clinic devices.

## Decision Drivers

* Static hosting on S3 and CloudFront, with no runtime server.
* Typed API client and typed domain models shared with the backend contract.
* Server-state caching and polling without hand-written effect logic.
* Small bundle size and fast first load on clinic workstations.
* A distinct visual identity without fighting a component library's theming.
* Team familiarity with React.

## Considered Options

### Option A: Next.js

* Good, because it is a mature full-stack React framework.
* Bad, because server rendering and its runtime add complexity that this app does not need.
* Bad, because a static export loses most of its advantages and still needs an adapter for a non-Vercel host.

### Option B: Create React App

* Bad, because it is deprecated and no longer maintained.

### Option C: UI kit (MUI or Chakra UI)

* Good, because it provides accessible components out of the box.
* Bad, because it adds a large runtime dependency and makes a bespoke look harder.
* Bad, because theming overrides accumulate over time.

### Option D: React 19 with TypeScript, Vite, React Router, TanStack Query, and hand-written CSS tokens (chosen)

* Good, because Vite produces a small static build and fast development server with a `/v1` proxy to the local API.
* Good, because React Router handles the five routes as a static SPA.
* Good, because TanStack Query provides caching, invalidation, and `refetchInterval` polling for the 1.5-second note status loop ([ADR-0005](0005-async-generation-polling.md)).
* Good, because CSS custom properties give a single source of design tokens with no runtime cost.
* Bad, because accessible primitives (focus management, dialogs, menus) must be written and tested by the team.
* Bad, because there is no shared component catalogue to lean on.

## Decision Outcome

Chosen option: **Option D**. The API base URL comes from `VITE_API_BASE_URL`, defaulting to same-origin, and the Vite dev server proxies `/v1` to the local backend. The typed client lives in `src/api/`, and components are tested with Vitest and Testing Library.

Quality requirements carried by this decision: accessible labels, keyboard operation, empty, error, and loading states on every page, layouts usable at 360px, and `npm run lint`, `npm run typecheck`, and `npm run build` passing in CI.

Hosting: the build deploys to S3 with CloudFront in front. Infrastructure is out of scope for this ADR and will be added to the SAM template ([ADR-0010](0010-infrastructure-aws-sam.md)).

## Consequences

### Positive

* The bundle is small and the deployment is static, cacheable, and inexpensive.
* Polling and cache invalidation are declarative.
* The visual design is fully controlled by the team.

### Negative

* Accessible custom components require explicit effort and testing.
* Developers must maintain the design-token system themselves.

### Follow-ups

* Add a small internal primitives set (button, dialog, field, badge) with accessibility tests before the template editor is built.
* Set a bundle-size budget in CI.
* Revisit a component library only if accessibility gaps prove costly.

## Related

* [ADR-0005: Asynchronous generation](0005-async-generation-polling.md) (polling contract)
* [ADR-0010: Infrastructure as Code](0010-infrastructure-aws-sam.md) (static hosting)
