# Audio engine modules

`../engine.js` is the compatibility facade for `WebAudioEditorEngine`.
Application code that creates or controls an engine should continue importing
the factory and class from that file. Its established methods are installed as
non-enumerable class-style descriptors from the focused runtime modules, so the
established string-named prototype API and `instanceof` behavior stay stable.

Pure model code and focused tests should use direct imports:

- `buffer-math.ts` for duration, transport-rate, PCM, and numeric helpers;
- `clip-schedule-plan.ts` for source resolution and deterministic clip plans;
- `clip-scheduler.ts` and `clip-gain.ts` for Web Audio scheduling;
- `project-effects.ts` for effect-rack traversal and immutable project edits;
- `effect-worklets.ts` for idempotent worklet/WASM loading;
- `effect-rack.ts` and `project-graph.ts` for graph construction and latency;
- `lifecycle.ts` for context/device ownership and terminal disposal;
- `transport-control.ts` and `transport-scheduler.ts` for transport state and
  scheduling;
- `effect-control.ts` for live rack configuration and EQ preview;
- `rendering.ts` for offline and realtime render orchestration; and
- `runtime-class.ts` and `runtime-methods.ts` for the typed compatibility
  constructor and explicit method composition.

There is intentionally no engine barrel. Direct imports keep pure planning code
independent of browser context creation and make dependency direction visible
to both human and AI-assisted changes.

`runtime-types.ts` documents the shared mutable host explicitly, while symbol
keys keep internal scheduling and lifecycle operations off the public string
method surface. `public-api.ts` is the single public type contract. Add public
methods there, to exactly one method map, and to `ENGINE_PUBLIC_METHOD_NAMES`;
the registry has a compile-time completeness assertion, while lifecycle and
prototype characterization tests guard terminal cleanup and runtime
compatibility.
