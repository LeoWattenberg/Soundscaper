# Post-milestone-8 extension 8+C: Framescaper product origin and cross-product storage

> Owning source for the Framescaper origin move, the cross-product project
> handoff that replaces shared browser storage, and the bounded work packets
> for both. The [roadmap](../roadmap.md#8c-framescaper-product-origin-and-cross-product-storage)
> owns scope and status; the compatibility policy, the threat model, and the
> quality budgets own their claims. Re-grounded against the implementation on
> 2026-08-29. This is a post-milestone-8 extension, not milestone-9 work: the
> product-origin cutover and durable handoff are complete before a stable
> release. Milestone 9 depends on this plan and not the reverse.

> **Implementation disposition (2026-08-29):** the user-approved
> [cutover decision](wp-8c-cutover-decision.md) selects separate origins and an
> immediate cutover. There is no legacy user population, retained pre-release
> store, retention interval, removal date, or worker tombstone. Finite old
> document URLs redirect; old worker URLs return not found; the sender and
> receiver routes remain permanent product features. The File-menu action
> creates a destination-family editable copy and never mutates the source.
> Family-v1 and Scape format v1 are frozen, so this implementation does not
> create or authorize a second schema, storage, or archive clean break.

## Goals and ordering principle

1. **Primary: make the origin split before a stable release.** The
   separate-origin deployment is complete and Soundscaper no longer emits the
   Framescaper app or worker scope. Because no legacy population or retained
   pre-release store exists, the cutover is immediate rather than a staged
   migration. This does not weaken the family-v1 baseline: any future supported
   family version must retain its own v1 source, and no second clean break is
   allowed on the RC or stable line.
2. **Secondary: the handoff outlives the cutover.** Cross-product project
   movement is wanted permanently, not once. A one-time migration script is
   therefore the wrong shape. The sender and receiver routes are permanent,
   explicit product surfaces.
3. **Tertiary: do not weaken the security posture to buy convenience.**
   `Cross-Origin-Opener-Policy: same-origin` and
   `Cross-Origin-Embedder-Policy: credentialless` (public/_headers:3-4) are
   what make `SharedArrayBuffer` available, and the later
   [installable-distribution plan](post-milestone-9-installable-distribution-plan.md)
   depends on them. No packet here relaxes either on a route that renders the
   editor.

## Recorded topology decision

Two topologies were evaluated for the installability requirement. The recorded
decision selects the second:

- **Sibling paths on one origin.** Move Soundscaper to `/soundscaper/` so
  the two scopes are siblings rather than nested. Chrome then mints two
  WebAPKs, storage stays shared because the origin is unchanged, and every
  packet in the "storage compatibility" half of this plan disappears.
  Cost: every public Soundscaper URL changes, and Framescaper never gets its
  own domain.
- **Separate origins — selected and implemented.** Framescaper lives at
  `framescaper.org`. Browser storage is origin-partitioned, so cross-product
  movement is an explicit editable-copy handoff rather than shared storage.

The [roadmap §8+C status](../roadmap.md#8c-framescaper-product-origin-and-cross-product-storage)
and cutover decision are the authority. Everything below assumes separate
origins.

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

**Conclusion, and the implemented design:** *continuous* shared
storage across two origins is not achievable under this project's own
security posture and should not be pursued. A *transfer* between them is,
and it need not be manual: each origin reads its own storage first-party in
its own top-level context, and the projects cross by `postMessage` between a
transfer page and a popped-up receiver, both on dedicated routes that do not
need cross-origin isolation. Manual `.scape` export and import remains the
fallback that works with no platform assumptions at all, and the archive it
uses already exists.

## What already exists (do not re-plan)

- **Scape format v1 is the interchange container** and both products read and
  write their owning family archive. The handoff does not add an archive
  version: it converts into the destination family's editable v1 project and
  transports that ordinary archive. The digest-bound conversion report is
  custody metadata, not a schema or archive-envelope widening.
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

### The cutover is immediate and has no legacy-retention phase

The origin split is implemented with no legacy user population and no retained
pre-release storage promise. Soundscaper therefore stops serving the old
Framescaper app and worker scope immediately. Finite old document routes
redirect to Framescaper; old worker URLs return not found. No old-worker
tombstone, migration census, retention interval, scheduled removal, or
telemetry is introduced. This is not permission for another clean break:
family-v1 and Scape format v1 remain the frozen RC/stable baseline.

### The handoff is an archive, not a channel

Projects cross as destination-family Scape v1 archives through the maintained
export and import paths. The bounded transport carries a digest-bound report
whose archive identity and root dispositions must verify before publication.
There is no broker origin and no relaxed COOP or CSP on an editor route. The
handoff is explicit, menu-reached, cancellable, and user-initiated rather than
ambient; the exact source project remains unchanged.

### No new envelope, schema number, or second clean break

The transfer moves discrete Scape v1 archives and does not introduce a new
project or archive version. Each action mints a distinct destination-family v1
identity; a retry of that same intent reuses it. The conversion report is a
closed sidecar bound to the entry and archive digest. It cannot carry opaque
authored state or relabel a source-family document as destination-family state.
Any future supported schema must migrate from its own family v1 baseline.

### The transfer routes are permanent product surfaces

`/transfer/send/` and `/transfer/receive/` remain available on both origins as
the browser handoff transport and manual recovery fallback. They are not a
legacy window and have no scheduled retirement. This permanence does not retain
the old Framescaper app, worker scope, or store under the Soundscaper origin.

## Phase structure

- **8+C.0 — Implemented:** separate origins and immediate no-legacy cutover.
- **8+C.1–8+C.2 — Implemented:** destination-family editable-copy contract,
  digest-bound report custody, and menu-reached browser/desktop actions.
- **8+C.3–8+C.5 — Implemented:** dedicated origin, finite redirects, install
  re-mint, and permanent transfer routes.
- **8+C.6 — Not applicable:** no retained legacy surface or retirement window
  exists; the permanent transfer routes are not removed.

## Work packets

### WP-8+C.0 — Topology decision and its record

- **Disposition:** Implemented by the
  [cutover decision](wp-8c-cutover-decision.md).
- **Outcome:** Separate origins, immediate cutover, no legacy population,
  retention interval, removal date, tombstone, or telemetry, and permanent
  transfer routes recorded in the roadmap. Family-v1 and Scape format v1 stay
  frozen.
- **Invariants:** Roadmap anchors referenced by machine-readable policies
  survive (tests/roadmap-guidance.test.js); the roadmap stays within its
  line ceiling; no code changes in this packet.
- **Acceptance:** `roadmap-guidance` remains green and the §8+C status states
  the selected topology, immediate no-legacy cutover, and permanent route
  lifetime without making a general platform-support claim.
- **Non-goals:** No manifest change, no redirect, no storage work.
- **Stop condition:** Stop if the decision cannot be made — every packet
  below depends on it, and building the handoff against an undecided
  topology wastes the half that sibling paths would delete.

### WP-8+C.1 — Freeze the cross-product handoff contract

- **Disposition:** Implemented for both family-v1 directions.
- **Outcome:** The compatibility register and fixtures state exactly how each
  persisted root is copied, materialized, omitted with a surfaced report, or
  refused. The destination family validates a new editable v1 project; the
  owning source stays authoritative and unchanged.
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
- **Stop condition:** Refuse before receiver publication if a required root
  cannot be authenticated or safely materialized. Do not add a schema or Scape
  archive version to make the conversion appear successful.

### WP-8+C.2 — "Send to the other product" as a first-class action

- **Disposition:** Implemented on web and desktop.
- **Outcome:** The File menu in each product exports a destination-family
  editable copy through the WP-8+C.1 contract. Browser handoff uses the
  permanent sender/receiver routes; desktop saves the destination-family file
  and identical digest-bound report. The receiving import surfaces exactly
  what was accepted, materialized, and omitted.
- **Invariants:** The action is discoverable from at least one surface
  without adding permanently-visible main-UI chrome; it never blocks on
  network; it is cancellable; a failed import leaves the receiving library
  unchanged rather than partially populated. A browser launch is revision-bound
  across its lock-releasing route transition. A desktop archive committed before
  its companion save fails is named as partial rather than reported as rollback.
- **Acceptance:** A browser spec drives the round trip in both directions
  and asserts the reported omission set matches the fixture matrix; an
  aborted import leaves no residue; the existing quota preflight governs the
  write.
- **Non-goals:** No automatic or background synchronization; no broker
  origin; no relaxed COOP, COEP or CSP on any editor route.
- **Stop condition:** Stop if the handoff cannot report its omissions
  honestly — a silent lossy transfer is worse than no transfer.

### WP-8+C.3 — The second origin, served correctly

- **Disposition:** Implemented at `framescaper.org`.
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

- **Disposition:** Implemented as permanent sender and receiver routes on both
  product origins. The legacy-store migration branch is not applicable because
  no legacy population or retained pre-release store exists.
- **Outcome:** Each product can enumerate its own first-party projects, export
  bounded family-owned archives through the WP-8+C.1 contract, and hand them to
  the exact peer receiver. Sessions are idempotent, resumable, and honest about
  partial completion; manual archive plus report download remains available.
  Manual import exposes a conversion ledger only when the exact matching
  companion was selected and verified; an archive selected alone remains an
  ordinary product-native import and does not acquire inferred conversion facts.
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

- **Disposition:** Implemented as an immediate cutover.
- **Outcome:** Finite old `soundscaper.org/framescaper/*` document routes
  redirect to the new origin; the permanent transfer routes are served at
  their product-origin locations. The Soundscaper service-worker scope and
  manifest no longer claim the Framescaper path, and the Framescaper manifest
  `id` and scope are re-minted on the new origin. Old worker URLs return not
  found rather than retaining a tombstone.
- **Invariants:** Finite document redirects do not loop; the Soundscaper shell
  cannot serve a stale Framescaper route; neither transfer route is classified
  as a redirect or retention exception.
- **Acceptance:** Route and offline-shell inventories contain no old product or
  worker scope, finite document routes target the exact peer origin, old worker
  URLs return not found, and permanent transfer pages remain reachable.
- **Non-goals:** No change to Soundscaper's own URLs unless the sibling-path
  topology was chosen in WP-8+C.0.
- **Stop condition:** Stop if any old finite document route loops, if the old
  worker or app shell remains live, or if cutover removes a permanent transfer
  endpoint.

### WP-8+C.6 — Retirement and its evidence

- **Disposition:** Not applicable. The decision records no legacy population,
  retained pre-release store, or retirement window.
- **Outcome:** No retirement job, removal date, worker tombstone, or telemetry
  is created. The old product surface is already absent; `/transfer/send/` and
  `/transfer/receive/` remain permanent product routes.
- **Invariants:** A cleanup may not misclassify either transfer route as a
  cutover artifact. Family-owned source projects are never deleted as a side
  effect of handoff.
- **Acceptance:** The roadmap and compatibility record describe the permanent
  route lifetime and contain no pending retirement claim.
- **Non-goals:** No telemetry is introduced to measure who transferred —
  the project's diagnostics posture is local and without telemetry
  (docs/milestone-9-plan.md:205-218), and this packet does not change it.
- **Stop condition:** Stop if closure would require inventing a legacy
  population, retention evidence, or telemetry that the recorded decision says
  does not exist.

## Known constraints this plan absorbs

- The cheaper sibling-path topology was rejected; separate origins are the
  implemented and recorded decision.
- There is no legacy population to measure and no retention window to tune.
  Telemetry is neither added nor needed for cutover closure.
- The handoff is explicit, not ambient. Two products on two origins cannot
  see one library, and no packet here pretends otherwise.
- The transfer routes are permanent even though the old Framescaper app and
  worker surface under Soundscaper are not retained.

## Non-goals and fences

- No broker origin, no Related Website Sets dependency, no Storage Access
  API dependency, and no relaxation of COOP, COEP or CSP on any route that
  renders an editor.
- No background or automatic synchronization between the products, and no
  server-side project storage. The product remains local-first.
- No new project schema number or archive envelope; family-v1 and Scape format
  v1 remain frozen, and no second clean break is allowed.
- No MIDI state; MIDI remains post-1.0 scope.
- No change to the desktop products' shared project library.
- No telemetry, in this plan or as a condition of closing it.
