# Post-milestone-8 extension 8+C: Framescaper product origin and cross-product storage

> Owning source for the Framescaper origin move, the cross-product project
> handoff that replaces shared browser storage, and the bounded work packets
> for both. The [roadmap](../roadmap.md#8c-framescaper-product-origin-and-cross-product-storage)
> owns scope and status; the compatibility policy, the threat model, and the
> quality budgets own their claims. Grounded against the repository on
> 2026-08-27 at commit `707be3e5` with file:line verification. This is a
> post-milestone-8 extension, not milestone-9 work: it is numbered 8+C so that
> it lands *before* milestone 9's WP-9.0.0 baseline freeze, which is the
> one-way door this plan must stay on the near side of. Milestone 9 therefore
> depends on this plan and not the reverse. Re-ground every citation at
> pickup.

## Goals and ordering principle

1. **Primary: move before the baseline freezes, and the numbering says so.**
   This work is 8+C rather than a milestone-9 packet precisely so the
   ordering is structural instead of aspirational. WP-9.0.0
   freezes the first-release schema baseline and reinstates retained
   migration (docs/milestone-9-plan.md:165-178). Until that happens, the
   product deliberately carries no data guarantees — the IndexedDB backend
   drops every object store on a version bump and says so in a comment
   (src/common/editor/storage/indexeddb-backend.ts:78-84). That window is
   the cheapest moment in the product's life to change origin, because the
   one thing an origin change destroys is precisely the thing the project
   has already declared it does not yet promise. **Sequencing the cutover
   before WP-9.0.0 converts this plan's hardest problem into a courtesy.**
   After the freeze it becomes a data-loss event requiring a proven
   transfer for every affected user. Nothing in milestones 8, 8+I, or 8+
   gates this extension, so there is no reason for it to wait.
2. **Secondary: the handoff outlives the cutover.** Cross-product project
   movement is wanted permanently, not once. A one-time migration script is
   therefore the wrong shape. Build the durable handoff, and let the cutover
   be its first invocation.
3. **Tertiary: do not weaken the security posture to buy convenience.**
   `Cross-Origin-Opener-Policy: same-origin` and
   `Cross-Origin-Embedder-Policy: credentialless` (public/_headers:3-4) are
   what make `SharedArrayBuffer` available, and the later
   [installable-distribution plan](post-milestone-9-installable-distribution-plan.md)
   depends on them. No packet here relaxes either on a route that renders the
   editor.

## The decision this plan does not make

Two topologies satisfy the installability requirement that motivated the
move. This plan is written for the second, on request, but the first must be
recorded because it is strictly cheaper and its cost is only branding.

- **Sibling paths on one origin.** Move Soundscaper to `/soundscaper/` so
  the two scopes are siblings rather than nested. Chrome then mints two
  WebAPKs, storage stays shared because the origin is unchanged, and every
  packet in the "storage compatibility" half of this plan disappears.
  Cost: every public Soundscaper URL changes, and Framescaper never gets its
  own domain.
- **Separate origins.** Framescaper moves to `framescaper.org`. Cost: the
  browser storage partition is per-origin, so every Framescaper project held
  under `soundscaper.org` becomes unreachable from the new host, and the
  cross-product handoff must be built rather than inherited.

Record the choice in the roadmap §8+C status line before any packet starts.
Everything below assumes separate origins.

## What the platform will not give us (verified constraints)

The intuitive design — one hidden storage-broker origin embedded by both
products, sharing a single IndexedDB over `postMessage` — is unavailable
here, for two independent reasons. Neither is a repository defect and
neither can be engineered around without giving up cross-origin isolation.

- **Third-party storage is partitioned by top-level site.** A cross-site
  iframe receives storage keyed to the pair (top-level site, iframe origin),
  so the broker embedded in `soundscaper.org` and the same broker embedded
  in `framescaper.org` see two different, empty-to-each-other partitions.
  The pattern does not fail loudly; it silently returns nothing.
- **`COEP: credentialless` makes it worse, deliberately.** Cross-origin
  iframes inside a credentialless document load without credentials and
  without their normal storage — an ephemeral bucket by design. A broker
  embedded in either product's editor route therefore sees an empty store
  even if partitioning were solved.
- **`COOP: same-origin` severs the popup route on editor routes — but not on
  a dedicated transfer route.** A popup to another origin normally loses its
  `window.opener` relationship under `same-origin`. Relaxing to
  `same-origin-allow-popups` costs cross-origin isolation on the route that
  sets it, and with it `SharedArrayBuffer` — unacceptable on a route that
  renders an editor, and irrelevant on one that does not. A transfer page
  needs no isolation, and a popup is a top-level context with unpartitioned
  first-party storage, so **the automatic handshake is available** if it
  lives on its own route on each origin. This is what WP-8+C.4 builds on,
  and it is why the transfer need not be a manual file exchange.
- **The CSP forbids framing in both directions today.** `default-src 'self'`
  supplies the `frame-src` fallback and `frame-ancestors` is
  `'self' https://kw.media` (public/_headers:2).

**Conclusion, and the design this plan builds on:** *continuous* shared
storage across two origins is not achievable under this project's own
security posture and should not be pursued. A *transfer* between them is,
and it need not be manual: each origin reads its own storage first-party in
its own top-level context, and the projects cross by `postMessage` between a
transfer page and a popped-up receiver, both on dedicated routes that do not
need cross-origin isolation. Manual `.scape` export and import remains the
fallback that works with no platform assumptions at all, and the archive it
uses already exists.

## What already exists (do not re-plan)

- **`.scape` is already the interchange format** and both products already
  read and write it, with an envelope, a file envelope, an export planner
  and archive-manifest handling (src/framescaper/scape-project-envelope-v18.ts,
  src/framescaper/scape-project-file-export-v18.ts,
  src/common/editor/scape-export-plan.ts,
  src/common/editor/scape-archive-envelope.ts). The handoff does not need a
  new container.
- **A cross-product compatibility register exists**
  (config/project-compatibility.json) together with its documentation
  (docs/project-compatibility.md), and milestone 9 already owns the
  retained-migration rule that governs it.
- **Per-route response policy is already expressed as data**, including
  per-route `Permissions-Policy` rows that differ between the products
  (public/_headers:10-33). A second origin duplicates this file's shape
  rather than inventing one.
- **The manifest and service-worker scopes are generated, not hand-written**
  (scripts/lib/offline-application-shell.mjs:235-280,
  scripts/generate-static-routes.mjs:71), so an origin change is a change to
  a product table, not a sweep through markup.
- **The desktop products already move projects between each other** through
  the shared project library; that path is Electron-only and is not a model
  for the browser, but its contracts show the intended semantics.

## Campaign decisions

### The cutover lands before the baseline freeze

This extension exists ahead of milestone 9 so that the origin change ships
while pre-release clean breaks are still legal
(docs/milestone-9-plan.md:176-178). That is the whole reason for the 8+C
number, and it is the one sequencing constraint the roadmap records rather
than this document. If the extension is nevertheless deferred and WP-9.0.0
freezes first, the transfer ceremony stops being a courtesy and becomes a
gate: no cutover may proceed until evidence shows every affected project
survives, and the retention window in WP-8+C.6 becomes a release-blocking
commitment rather than a policy choice. Confirm at pickup that the baseline
has not frozen; if it has, re-scope before starting.

### The handoff is an archive, not a channel

Projects cross as `.scape` archives through the existing export and import
paths. No new wire protocol, no broker origin, no relaxed COOP or CSP on an
editor route. The cost is that the handoff is explicit and user-initiated
rather than ambient; that is the honest shape given the constraints above,
and it is also the shape that keeps working when a user moves between
devices, browsers, or the desktop products.

### No new envelope, therefore no new schema number

The transfer moves N discrete `.scape` archives, not one bundle-of-projects
container. This is deliberate: a new envelope would have to claim a project
schema number, and those numbers are a single global namespace in which a
number identifies exactly one product. Reusing `.scape` keeps this plan
entirely out of that namespace. If a bundle container ever becomes
necessary, it claims its number at merge time and not before.

### The retirement window is a published commitment

`soundscaper.org` keeps serving the Framescaper transfer route for a stated
period after cutover, and that period is recorded in the roadmap status line
rather than left to judgement. Removing it early strands anyone who has not
opened the app in the interim.

## Phase structure

- **8+C.0** decides topology and records it.
- **8+C.1–8+C.2** build the durable handoff, which is useful with or without
  the move.
- **8+C.3–8+C.5** perform the cutover.
- **8+C.6** retires the old surface on a stated schedule.

## Work packets

### WP-8+C.0 — Topology decision and its record

- **Outcome:** The user-approved topology (sibling paths versus separate
  origins) recorded in one bounded roadmap §8+C edit, together with the
  retirement-window commitment and a confirmation that WP-9.0.0's baseline
  freeze has not yet landed.
- **Invariants:** Roadmap anchors referenced by machine-readable policies
  survive (tests/roadmap-guidance.test.js); the roadmap stays within its
  line ceiling; no code changes in this packet.
- **Acceptance:** `npm test` green over `roadmap-guidance`; the chosen
  topology is stated in the §8+C status line; if separate origins are chosen,
  the retirement window is a date range and not an adjective.
- **Non-goals:** No manifest change, no redirect, no storage work.
- **Stop condition:** Stop if the decision cannot be made — every packet
  below depends on it, and building the handoff against an undecided
  topology wastes the half that sibling paths would delete.

### WP-8+C.1 — Freeze the cross-product handoff contract

- **Outcome:** A written contract stating exactly what must survive a
  Soundscaper→Framescaper and Framescaper→Soundscaper archive round trip,
  and what is permitted to be dropped with an explicit, surfaced omission.
  Grounded in what the existing `.scape` paths already carry, and expressed
  as a fixture matrix rather than prose.
- **Invariants:** The contract never silently drops authored state; an
  omission is reported the way the interchange exports already report
  omitted caption tracks, not discarded; no product-specific state is
  smuggled through an opaque blob that the receiving product cannot
  describe.
- **Acceptance:** A fixture project per product exercises the matrix in
  both directions with byte-level assertions on what round-trips and
  explicit assertions on each permitted omission; the register in
  config/project-compatibility.json names the contract.
- **Non-goals:** No new schema version; no widening of what `.scape` holds.
- **Stop condition:** Stop if the matrix shows a category of authored state
  that cannot cross without a new schema number — that is a milestone-9
  compatibility decision, not a packet-level one.

### WP-8+C.2 — "Send to the other product" as a first-class action

- **Outcome:** A user-initiated handoff in both products that exports the
  current project through the WP-8+C.1 contract and hands it to the other
  product, with a receiving import that reports exactly what it accepted and
  what it omitted. This is the durable replacement for shared storage and
  ships whether or not the origin moves.
- **Invariants:** The action is discoverable from at least one surface
  without adding permanently-visible main-UI chrome; it never blocks on
  network; it is cancellable; a failed import leaves the receiving library
  unchanged rather than partially populated.
- **Acceptance:** A browser spec drives the round trip in both directions
  and asserts the reported omission set matches the fixture matrix; an
  aborted import leaves no residue; the existing quota preflight governs the
  write.
- **Non-goals:** No automatic or background synchronization; no broker
  origin; no relaxed COOP, COEP or CSP on any editor route.
- **Stop condition:** Stop if the handoff cannot report its omissions
  honestly — a silent lossy transfer is worse than no transfer.

### WP-8+C.3 — The second origin, served correctly

- **Outcome:** `framescaper.org` serves the Framescaper product with the
  full response-policy set duplicated from public/_headers — CSP, COOP,
  COEP, Referrer-Policy, `X-Content-Type-Options`, and the Framescaper
  `Permissions-Policy` rows — plus its own manifest, service-worker scope
  and offline shell, generated from the same product table rather than
  forked.
- **Invariants:** `crossOriginIsolated` is true on every editor route of the
  new origin, proven by assertion and not by inspection; the deliberate
  cache policy of the primary origin is reproduced consciously rather than
  inherited by accident; the generated artifacts stay generated.
- **Acceptance:** The deploy preflight asserts the new origin's header set
  and manifest exactly as it does the primary's
  (scripts/lib/pages-deploy-preflight.mjs); a browser spec on the new origin
  asserts `crossOriginIsolated === true` and reaches the editor.
- **Non-goals:** No storage migration in this packet; no redirects yet.
- **Stop condition:** Stop if cross-origin isolation cannot be established
  on the new origin — everything downstream, including video export and the
  whole later installable-distribution plan, depends on it.

### WP-8+C.4 — The cutover transfer route

- **Outcome:** A route on `soundscaper.org` that enumerates the Framescaper
  projects held in that origin's storage, exports them through the WP-8+C.1
  contract, and hands them to the new origin; and its receiver on
  `framescaper.org`. Idempotent, resumable, and honest about partial
  completion.
- **Invariants:** The exporting origin never deletes anything as a
  side-effect of transfer — removal is a separate, explicit user action
  after a verified import; a project already present on the receiver is
  recognised rather than duplicated; the ceremony works with no network
  beyond the two origins.
- **Acceptance:** A spec transfers a multi-project fixture, kills the
  receiver mid-import, resumes, and asserts exactly one copy of each
  project with the omission set from the fixture matrix; a second run
  transfers nothing new.
- **Non-goals:** No automatic transfer on first visit; no cross-origin
  storage access; no silent deletion.
- **Stop condition:** Stop if idempotence cannot be established — a
  ceremony that can duplicate a user's projects is worse than a manual
  export.

### WP-8+C.5 — Redirects, scope retirement, and the installable re-mint

- **Outcome:** `soundscaper.org/framescaper/*` redirects to the new origin
  except for the transfer route; the Soundscaper service-worker scope and
  manifest no longer claim the Framescaper path; the Framescaper manifest
  `id` and scope are re-minted on the new origin.
- **Invariants:** A previously installed Framescaper app is not left
  pointing at a redirect loop; the Soundscaper shell's cached Framescaper
  routes are invalidated rather than served stale; the transfer route is
  explicitly excluded from the redirect for the whole retention window; the
  live document cache TTL is measured before the cutover window is announced,
  because a stale document delays the redirect's arrival for exactly that TTL.
- **Acceptance:** A spec installs the old Framescaper app, deploys the
  cutover, and asserts the user reaches either the new origin or the
  transfer route — never a loop and never a blank shell; the offline shell
  inventory no longer lists retired routes.
- **Non-goals:** No change to Soundscaper's own URLs unless the sibling-path
  topology was chosen in WP-8+C.0.
- **Stop condition:** Stop if an installed old app cannot be routed
  somewhere useful; stranding an installed user is the failure this whole
  plan exists to avoid.

### WP-8+C.6 — Retirement and its evidence

- **Outcome:** The transfer route is removed on the committed schedule, with
  recorded evidence that the window was served for its full duration and
  that the retirement was announced on the surface a returning user reaches
  first.
- **Invariants:** The window is not shortened; removal is a deliberate,
  dated change and not a cleanup.
- **Acceptance:** The removal commit cites the committed window; the
  compatibility register records the retired route.
- **Non-goals:** No telemetry is introduced to measure who transferred —
  the project's diagnostics posture is local and without telemetry
  (docs/milestone-9-plan.md:205-218), and this packet does not change it.
- **Stop condition:** Stop if the only way to know whether the window was
  long enough is to add telemetry. Choose a generous window instead.

## Known constraints this plan absorbs

- The cheapest topology is the one this plan does not build. That is
  recorded, not litigated, in WP-8+C.0.
- Without telemetry there is no way to observe how many users the cutover
  affects. The plan compensates with a generous, published retention window
  rather than with measurement.
- The handoff is explicit, not ambient. Two products on two origins cannot
  see one library, and no packet here pretends otherwise.
- The deliberate cache policy of the primary origin (public/_headers versus
  the zone TTL) delays the redirect's arrival by exactly the TTL. The
  installable-distribution plan is later scope and cannot be relied on to
  reconcile it first, so WP-8+C.5 measures the live document TTL and plans
  the cutover window around it.

## Non-goals and fences

- No broker origin, no Related Website Sets dependency, no Storage Access
  API dependency, and no relaxation of COOP, COEP or CSP on any route that
  renders an editor.
- No background or automatic synchronization between the products, and no
  server-side project storage. The product remains local-first.
- No new project schema number, and no new archive envelope.
- No change to the desktop products' shared project library.
- No telemetry, in this plan or as a condition of closing it.
