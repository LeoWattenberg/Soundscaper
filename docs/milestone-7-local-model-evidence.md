# Milestone 7.0.0a: local model evidence records

> **Historical slice record:** delivered on 2026-08-13 as the first
> milestone-7 slice. Its disabled-gate and all-records-blocked statements
> describe that exact historical checkpoint, not current admission. As of
> 2026-08-26, `local-models` is enabled, thirteen complete permitted evidence
> records supply the signed catalog, and Spleeter, Demucs, and TransNetV2 remain
> blocked and absent from the offered set. Current model-backed execution is
> still narrower than that catalog: authenticated Parakeet speech recognition,
> Silero voice activity, and exact pyannote-segmentation plus ERes2Net speaker
> diarization are active; the remaining catalog tasks stay typed unavailable.
> Fast F31 shot detection is separately active without a model through an
> admitted user-configured external FFmpeg. Catalog mirror metadata is not
> durable R2 upload/read-back evidence. Manual and owner-lab qualification
> remains pending and nonblocking, while licensing, signature, digest,
> runtime/platform, selected-media, storage, consent, and external-runtime
> admission gates stay fail closed.
>
> **Implemented:** delivered on 2026-08-13, the first milestone-7 slice.
> Decomposes the licensing half of WP-7.0.0 in
> [the milestone-7 plan](milestone-7-plan.md), which
> owns the milestone's sequencing and its runtime and model-catalog
> decisions. The [licensing policy](production-licensing-policy.md) owns
> the distribution rules this slice enacts. Grounded against the
> repository at `334cea20` on 2026-08-13; every file and line reference
> below was read, not inferred.

## Foundation already present

- `config/production-licensing-matrix.json:337-343` carries the
  `local-models` future distribution gate: `status: "disabled"` with four
  `enableRequires` slugs — `weights-and-code-license-review`,
  `training-data-provenance-record`, `model-card-and-use-restrictions`,
  and `versioned-download-notices-and-hashes`.
- Those four slugs bind to nothing. `enableRequires` is free-form text
  everywhere in the matrix; `tests/production-licensing-matrix.test.js:163`
  only asserts `length >= 3`. Note that `web-notice-delivery` at
  `:323` coincidentally equals a `releaseGates` id and nothing checks the
  coincidence. **Turning those four slugs into required, individually
  satisfied, per-model fields is this slice's entire deliverable.**
- The fail-closed rule the records must obey is
  `docs/production-licensing-policy.md:173-175`: "Unknown, conflicting, or
  incomplete evidence blocks distribution of the affected artifact. It
  must not be converted into an optimistic status or a silent exception."
- The derivation pattern to imitate is `assertAuthorization` in
  `scripts/lib/ffmpeg-runtime-manifest.mjs:404-410`, where
  `expectedStatus = blockedBy.length === 0 ? 'approved' : 'blocked'` — a
  status that is computed and asserted, never authored.
- The refusal-list pattern to imitate is `forbiddenSourceTokens` in
  `src/common/editor/staffpad/source-manifest.json`.

## Outcome boundary

1. A `localModelEvidence` array in the licensing matrix: one record per
   model the product intends to catalog, each carrying an entry for
   **every** `local-models` `enableRequires` slug.
2. A `refusedLocalModels` array recording the weights this product will
   not distribute, with the reason, so an excluded model cannot be
   reintroduced by a later author who only read the catalog.
3. `scripts/lib/local-model-evidence.mjs`: a pure validator that derives
   `blockedBy` and `distributionStatus` from the requirement entries and
   refuses any record whose authored status disagrees with the derived
   one.
4. `tests/production-licensing-model-evidence.test.js`: accept and reject
   coverage, plus real-repo assertions that the launch set is present,
   that every record is blocked, and that no refused model appears as a
   record.
5. A `## Local assistance model evidence` subsection in the licensing
   policy describing the record contract.

Out of this slice: no download code, no runtime, no catalog of URLs, no
notice text, and no About surface (see contract 5).

## Contract 1: the four requirements are fields, not prose

Each record carries a `requirements` object whose key set is **exactly**
the `local-models` gate's `enableRequires` array. A record missing a
requirement, or carrying an unknown one, is refused. This is what makes
cataloging a model a reviewed data change rather than an assertion: the
gate's own vocabulary becomes the record's mandatory schema.

Each requirement entry is `{status, summary}`. `status` is one of:

| Status | Meaning |
| --- | --- |
| `recorded` | The requirement is satisfied by checked-in, sourced evidence. Only this status counts. |
| `pending` | Not yet obtainable at this stage of the milestone, with the blocking stage named in the summary. |
| `unresolved` | Obtainable in principle, but upstream evidence is missing, conflicting, or unanswered. |

`pending` and `unresolved` are deliberately distinct: `pending` is a
sequencing statement this plan controls, `unresolved` is a fact about the
upstream artifact that may never resolve. Both block distribution
identically; only their remedies differ.

## Contract 2: distribution status is derived, never authored

`blockedBy` is the sorted list of requirement ids whose status is not
`recorded`. `distributionStatus` is `permitted` when `blockedBy` is
empty and `blocked` otherwise. The validator recomputes both and rejects
a record whose authored values disagree. An incomplete record therefore
cannot be typo'd, optimised, or hand-waved into a distributable state —
which is the fail-closed rule expressed as arithmetic rather than as a
review instruction.

## Contract 3: every launch-set record is blocked at this slice

`versioned-download-notices-and-hashes` requires a pinned artifact with a
byte length and a SHA-256. No artifact is mirrored yet — that is WP-7.0.1
— so this requirement is `pending` for every record and the entire launch
set is `blocked`. This is recorded as an acceptance assertion, not as an
incidental outcome: the slice ships a closed gate and proves it is
closed.

Two records are additionally blocked on `weights-and-code-license-review`
with status `unresolved`, and they are the reason the mechanism needs
three statuses rather than a boolean:

- **Spleeter** — the repository is MIT and ships its pretrained models
  from its own releases, but the licence text addresses the code and
  upstream question `deezer/spleeter#898` asks precisely whether the
  weights are covered. Recorded as unresolved until upstream answers or a
  review concludes otherwise.
- **Demucs v4 `htdemucs`** — MIT code, weights never explicitly licensed,
  and the repository was archived in January 2025, so no upstream
  clarification is expected. It is not in the launch set; it is recorded
  so that its ambiguity is durable rather than rediscovered.

## Contract 4: non-commercial and gated weights are structurally refused

The validator refuses any record whose `weightsLicense` or `codeLicense`
matches a non-commercial or research-only marker, so a trapped weight
cannot be recorded as satisfied even by an author who believes it is
fine. Independently, `refusedLocalModels` names the specific models this
product has already rejected, and a record whose id appears there is
refused. The two mechanisms cover different mistakes: the pattern check
catches an unfamiliar trapped licence, the refusal list catches a
familiar one being reintroduced.

Upstream URLs live in `provenanceSources`, never in `evidence`.
`tests/production-licensing-matrix.test.js:189-194` resolves every
`evidence` string against the repository root with `access()`, so a URL
there would attempt a filesystem path and fail.

## Contract 5: notices are a delivery obligation, so they wait

The milestone-7 plan's WP-7.0.0 acceptance line asks for notices
rendering in an About surface. That acceptance moves to the slice that
first mirrors an artifact, for a substantive reason rather than a
scheduling one: a notice is an obligation attached to bytes actually
distributed, and this slice distributes nothing. Publishing notice text
for models the product does not yet ship would make
`THIRD_PARTY_LICENSES.md` overclaim in exactly the direction the fail-closed
policy forbids.

The record still carries what the notice will need — licence ids, an
`attributionRequired` flag for the CC-BY-4.0 weights, and the provenance
sources — so the later slice composes the notice from checked-in evidence
rather than re-researching it. There is no in-app About surface today
(`grep -rn "THIRD_PARTY_LICENSES" src/` returns only file headers), and
building one is menu-reached UI work with its own copy and tests; it is
named here so the deferral is stated rather than implied.

## Contract 6: the gate itself does not move

`local-models` stays `status: "disabled"`. Records satisfy a gate; they
do not open it. Opening it additionally requires the runtime, the
download path, and the notice delivery that WP-7.0.1 and WP-7.0.2 own,
and `tests/production-licensing-matrix.test.js:162` asserts every future
gate is disabled, so any future flip is a deliberate test edit under
review. The gate's `evidence` array gains the validator and the test so
the enablement path is discoverable from the gate.

## Acceptance and TDD sequence

1. **Red:** `tests/production-licensing-model-evidence.test.js` asserting
   the record contract, the derivation, the launch-set membership, the
   refusal list, and eight rejection cases. Fails: no validator, no data.
2. **Green:** `scripts/lib/local-model-evidence.mjs` plus the two matrix
   arrays and the policy subsection.
3. `node scripts/repin-runtime-evidence.mjs` in the **same commit** as
   the matrix edit — `config/production-licensing-matrix.json` is
   byte-pinned at `config/ffmpeg-runtime-manifest.json:74-78` and
   `docs/production-licensing-policy.md` at `:69-73`; missing the repin
   fails `npm run audit:ffmpeg-runtime`, `tests/ffmpeg-runtime-manifest.test.js`,
   and every desktop pack hook (`AGENTS.md:49-55`).
4. `node scripts/check-file-size.mjs`, then the canonical `npm run check`.

Fast local loop, which needs no `node_modules` because both files are
pure JavaScript:

```
node --test tests/production-licensing-model-evidence.test.js
node --test tests/production-licensing-matrix.test.js
node scripts/repin-runtime-evidence.mjs --check
```

## Traps verified at `334cea20`

- **The forbidden-phrase scan** (`tests/production-licensing-matrix.test.js:154`)
  runs `assert.doesNotMatch(JSON.stringify(matrix), /legally[- ]cleared|legal approval|patent[- ]free/iu)`
  over the **whole** matrix. Model summaries must say "license review",
  never "legal approval" or "legally cleared" — including when describing
  what a record is waiting for.
- **`futureDistributionGates` is a frozen set of exactly four**, compared
  on the sorted id projection (`:160`), each pinned to `disabled` (`:162`).
  The enactment lands beside the gate, not by mutating it.
- **`groundedAt` is bumped only after every changed claim is grounded**
  (`docs/production-licensing-policy.md:169-171`); it must match
  `/^\d{4}-\d{2}-\d{2}$/u` (`:49`).
- **`config/` is not size-checked** (`scripts/check-file-size.mjs:10`
  walks `desktop`, `scripts`, `src`, `tests` only, and JSON is not a
  checked extension), so the records have no line ceiling; the validator
  and test do, at 600 lines.
- **`npm test -- <file>` silently runs the whole suite** —
  `scripts/run-node-tests.mjs` never reads `process.argv`. Use the direct
  `node --test <file>` invocation above.
- **New async tests need an explicit `{ timeout }`**; `node --test` has no
  default timeout and a wedged test hangs `npm run check` with no output.
- `roadmap.md` is 969 lines against the 1,000-line ceiling asserted by
  `tests/roadmap-guidance.test.js:19`. This slice does not touch it.

## Recorded evidence

Delivered on 2026-08-13 in commits `4940a367` (this document), `bdf99760`
(the failing contract) and `556fb258` (the validator, the records, the
policy subsection, and the repin), against base `334cea20`.

The canonical `npm run check` passed end to end: `lint`, `typecheck`,
`check:architecture` (no dependency violations across 1,105 modules and
3,193 dependencies; 2,401 maintained source files within the size
ceilings), `audit:ci` (25 dependency notice records verified),
`test:coverage` (exit code 0, so every test passed and the 80/70/80
coverage thresholds held), and `build` (119 chunks, largest 431,742
bytes against the 500,000-byte ceiling). The coverage percentages
themselves were not captured from that run and are therefore not
recorded here rather than being estimated.

Nine evidence records and eleven refusals are checked in. Every record
is `blocked`; `spleeter` and `demucs-v4-htdemucs` are additionally
blocked on an `unresolved` weights review. `tests/ffmpeg-runtime-manifest.test.js`
passes at 13/13 after the repin, confirming the byte pins for the matrix
and the policy document were refreshed in the same commit as the edit.

## Non-goals and stop conditions

Non-goals: no download, mirror, or hosting work; no model catalog of URLs
and digests (WP-7.0.1); no runtime or helper process (WP-7.0.2); no
notice text or About surface (contract 5); no change to the
`local-models` gate status; no MIDI and no capture surface, which stay
fenced through milestone 7 (`roadmap.md:117-130`).

Stop conditions. Stop if a record would need a status between `recorded`
and blocked, if `distributionStatus` would need to be authored rather
than derived, if a requirement would have to be satisfied by a promise
about future work rather than checked-in evidence, if the launch set
would need a non-commercial or gated-download weight to be useful, or if
recording a model would require opening the gate rather than satisfying
it.
