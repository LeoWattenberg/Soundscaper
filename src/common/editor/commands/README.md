# Editor command protocol

`commands.js` remains the compatibility facade for applying and preparing
commands. Application code should keep importing its runtime functions from
that file.

Code that only needs the serializable command protocol should import types and
discriminants directly from `protocol.ts`. Code that builds tooling around
dispatch should import the domain lists and registry helpers directly from
`registry.ts`. Avoid importing the editor's broad `index.js` barrel for either
case: direct imports make dependencies explicit and keep non-UI tooling from
pulling in unrelated editor modules.

## Adding a command

1. Add the discriminant to `AUDIO_EDITOR_COMMAND_TYPES` and its serializable
   payload to `protocol.ts`.
2. Assign it to exactly one domain list. The compile-time checks and registry
   tests reject missing and duplicate ownership.
3. Implement it in the matching `*-runtime.js` module and register it in that
   domain's runtime handler map. `runtime-registry.ts` composes and validates
   every map exhaustively.
4. Add a semantic test for success and failure. If the command can participate
   in `batch`, verify that a failing child leaves the input project unchanged.

Commands must remain JSON-safe. Any identifier created while preparing a
command belongs in its payload so replay does not depend on random state.
Public factories for nested annotation payloads reject values that cannot make
an exact JSON round trip; a successful factory result is detached from its
inputs.
Handlers mutate only the draft they receive; `applyEditorCommand` owns the
single project commit and validation boundary. The `batch` handler recursively
dispatches children into that same draft, so it must never call
`applyEditorCommand` itself.

Runtime responsibilities are intentionally narrow: project/source/Project Bin,
tempo/signature, sequence timing, track/mixer/label, effects/video,
clip/range/clipboard, and timeline annotation commands each have explicit
handler maps. Sequence timing owns the rational rate, drop-frame flag, and
start timecode; a rate change conforms the sequence's video placements from
their resolved boundaries and marks them conformed, so the reconciliation
boundary verifies that placement against the new grid rather than re-deriving
it as a delta against the old one. A conformed placement that a later command
in the same batch moves therefore fails loudly instead of mixing grids. Timeline
annotation mutation accepts schemas 11 and 12 and requires a branded runtime projection;
product capability policy remains a separate controller boundary. The larger
clip domain is further divided into basic edits, transforms, links/groups,
ranges, and clipboard preparation. Shared validation and stable-ID helpers live
in `shared-runtime.js`; keep dependencies directed toward that leaf to avoid
cycles.
