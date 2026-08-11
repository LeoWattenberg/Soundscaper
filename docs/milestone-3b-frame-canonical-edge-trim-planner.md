# Milestone 3B-4b2: frame-canonical edge-trim planner

> Bounded pickup contract after
> [linked audio and video visibility controls](milestone-3b-linked-audio-visibility.md).
> This slice builds the pure planning authority that later trim commands,
> previews, pointer gestures, and keyboard actions will share. It does not make
> a new trim command or user-facing action available.

## Foundation already present

- Controller clip edits receive the transient command projection. Current video
  clips therefore retain their canonical `sequenceStartFrame`,
  `sequenceFrameCount`, `sourceInFrame`, and `sourceFrameCount` while also
  exposing resolved sample aliases for existing command runtimes.
- One `clip/transform-many` command receives one operation identity during V10+
  reconciliation. Video deltas conform in sequence-frame space and linked audio
  presentation endpoints are then recomputed from the video member. Separate
  commands inside a batch do not share that identity.
- Existing generic trim preview and controller paths independently use floating
  sample-domain ratios. They also treat the command-projection video source's
  legacy `frameCount` alias as a source bound, although that alias is the source
  sample count rather than the canonical video-frame count.
- `collectClipTrimIds` defines current edit expansion: an active clip, an active
  selection that contains it, and transitive group/A/V companions participate;
  companions on the active track do not share its edge.
- No persisted track-lock fact exists yet. A later schema/enforcement slice owns
  that fact and the central mutation guard.

## Slice boundary

Add one strict TypeScript, UI-independent planner for ordinary left/right edge
trims whose expanded participant set contains video. The planner consumes the
already-resolved command projection and one requested absolute timeline-sample
boundary. It returns an immutable no-op or a frozen, ordered set of
`clip/transform-many`-compatible transforms plus matching preview records.

This slice may prove its output by manually passing those transforms through the
existing command runtime in tests. It does not delegate the live controller,
replace the current UI preview, add a controller action, change a command or
schema, or claim pointer/keyboard parity. Audio-only trims keep their existing
path until the later integration slice.

## Contracts closed before code

1. **One video boundary owns conformance.** The request is first expressed as a
   sample delta from the active clip's resolved edge. The video authority is the
   active clip when it is video, otherwise its exact participating A/V-linked
   video companion, otherwise the first participating video in stable project
   clip order. The sample delta is added to that authority video's own resolved
   edge; grouped edges need not already align. The planner converts the resulting
   authority boundary to one integer sequence frame with the shared `point` rule,
   computes one integer frame delta, and reuses that delta for every participating
   video clip. Participating video clips must belong to the same sequence and
   rate; otherwise the planner refuses instead of choosing another conformance
   rule.
2. **Absolute endpoints own every result.** Left trim keeps each original right
   endpoint fixed; right trim keeps each original left endpoint fixed. Timeline
   and source extents are subtractions of final absolute endpoints, never an
   accumulation of preview deltas. Every timeline and source extent remains at
   least one frame/sample and every sum remains a safe integer.
3. **Video source mapping stays canonical.** For a video clip with sequence
   range `[S, S + C]` and source range `[I, I + N]`, a final sequence boundary
   `B` maps once as `I + round((B - S) * N / C, point)`, evaluated with exact
   integer-ratio arithmetic. Bounds use the video source's canonical
   `sourceFrameCount`, never its command-projection `frameCount` alias. The plan
   emits source aliases in video-source-frame units for existing reconciliation.
   A non-null retime map refuses because reverse/freeze/curve inversion belongs
   to 3B-5.
4. **One common clamp preserves the participant set.** Starting with the signed
   integer frame delta, the planner chooses the nearest legal delta while moving
   toward zero and never reverses its sign. That one delta must satisfy the
   intersection of sequence-origin, positive-extent, source, and composition
   bounds for all expanded participants; the most constrained participant
   therefore controls the operation. Requests beyond available handles or valid
   composition space clamp, and a fully clamped zero delta is an explicit no-op
   that produces no transform. An invalid original canonical/source range or an
   already-invalid original composition refuses rather than being repaired.
5. **Audio follows the conformed operation.** An exact linked-audio participant
   uses its own participating video companion's resolved edge delta; other
   grouped or selected audio uses the video authority's resolved edge delta.
   This distinction preserves exact A/V presentation and source mapping when
   equal sequence-frame deltas at different NTSC phases resolve a sample apart.
   Audio applies its chosen delta to its own original edge and maps that final
   boundary once from immutable timeline `[T, T + D]` and source `[I, I + N]`
   ranges. Forward mapping is
   `I + roundRational((B - T) * N, D, 'point')`; reversed mapping is
   `I + N - roundRational((B - T) * N, D, 'point')`. Forward-left and
   reversed-right move the low source boundary; the opposite edges move the high
   boundary. Audio legacy trim metadata changes by the actual mapped source
   amount removed or restored on that source side and clamps at zero; fades
   clamp to the final duration. Video legacy trim metadata is left unchanged
   because V14 does not define it as canonical source-frame authority. Linked
   audio remains in the same transform set so command reconciliation can give
   the pair exact derived-equal presentation endpoints.
6. **Expansion is deterministic and fail-closed.** The planner accepts only the
   repository-branded command projection, preserves project clip order, and
   retains the established selection/group/A/V closure. Missing or
   duplicate clip ownership, mismatched track/media kinds, missing sources or
   sequences, cross-sequence video participants, invalid canonical ranges, and
   unsafe arithmetic refuse before a plan is returned. A caller-supplied
   track-lock predicate is checked for every participant; it defaults to
   unlocked only because this slice creates no persisted lock fact.
7. **Composition remains valid.** Original video tracks must first satisfy the
   existing composition rule. Candidate tracks are then validated after
   substituting all planned endpoints. Gaps, touching clips, and proper two-clip
   edge transitions remain valid. A requested delta that would create a
   nested/equal-boundary or three-way overlap clamps toward zero to the nearest
   valid integer delta; invalid original geometry refuses atomically. The planner
   does not invent overwrite or transition-repair behavior.
8. **The plan is command-shaped, not a command.** Its transform records contain
   stable clip/track IDs and only fields the existing transform runtime accepts.
   Records and arrays are frozen and inputs are not mutated. A later integration
   slice will prepare and commit exactly one `clip/transform-many`, then route
   pointer preview and keyboard feedback through this same plan.

Ordinary edge trim is prerequisite boundary math, not a claim that the existing
generic transform runtime implements roll, ripple trim, slip, or slide. Those
tools must still cite and satisfy their own foundation coordinate-matrix rows.

## Acceptance

- Table-driven left/right shrink and extend cases cover integer and NTSC
  sequence rates, nonzero sequence origins, unequal source/sequence rates,
  non-unit source-to-sequence extents, exact rounding ties, and one-frame clamps.
- Replanning from the same immutable originals yields the same final target;
  intermediate preview calls cannot accumulate drift. Results and nested values
  are frozen and the input projection is byte-for-byte unchanged.
- Related forward and reversed audio cases cover all four source-edge mappings.
  A/V links, transitive groups, selections, same-track exclusions, stable order,
  and the most-constrained common clamp have focused fixtures.
- Applying a returned transform set through the existing single command proves
  persisted video `sequenceStartFrame/count` and `sourceIn/count`, absence of
  derived persisted aliases, exact linked presentation endpoints, validation,
  and one-step undo/redo compatibility at the command boundary.
- Missing/ambiguous ownership, invalid or exhausted base ranges, non-null retime
  maps, mixed sequences/rates, lock-predicate refusal, unsafe integers, and
  invalid original transition geometry fail without input mutation. Requests
  beyond valid source or composition handles instead clamp or become no-ops.
- Focused planner and command-reconciliation tests, typecheck, lint,
  architecture/file-size checks, and the canonical non-browser gate pass. No
  browser result is claimed for this deliberately unexposed slice.

## Implementation sequence

1. Add failing strict-TypeScript table tests for conformance, mapping, common
   clamps, relation expansion, immutable output, and refusal cases.
2. Implement the pure planner in a focused maintained domain module, reusing the
   shared rational/time and video-composition authorities.
3. Add command-boundary fixtures that feed a returned plan into one existing
   transform command and validate current persisted documents plus undo/redo.
4. Record the implemented dependency without marking any interactive trim tool
   complete.

## Non-goals

- No live controller delegation, pointer preview replacement, keyboard binding,
  menu item, status announcement, or new default-visible control.
- No persisted track lock, schema revision, capability, protocol field, or claim
  of central lock enforcement.
- No roll, ripple trim, slip, slide, rate-stretch, overwrite, transition repair,
  retiming curve, reverse, freeze frame, or nested sequence behavior.
- No change to audio-only trim behavior and no persisted derived cache.

## Stop conditions

- Stop if exact edge mapping needs floating-point ratio accumulation or reads a
  video source bound from `source.frameCount`.
- Stop if a participant set needs more than one sequence conformance rule.
- Stop if a plan cannot be expressed as one future `clip/transform-many` without
  a schema, protocol, cache, or hidden second command.
- Stop if integrating the planner is required to prove the pure model; live UI
  and controller ownership belong to the next bounded slice.

The four packaged Electron timing-probe rows remain `pending-external`, and the
explicit WebKit deferral remains unchanged.
