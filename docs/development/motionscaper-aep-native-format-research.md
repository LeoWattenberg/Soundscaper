# Direct After Effects format research

Reviewed 2026-10-11 in response to the suggestion to inspect Storytold's Adobe
interoperability projects. This is a source review, not an adopted dependency,
executed parser qualification or installed-After-Effects result. Direct
`.aep`/`.aepx` parsing remains separate feasibility work outside the first
release's implemented M11 bridge. No installed AE environment is available.

## What Storytold actually provides

[EffectCraft's main README](https://github.com/storytold/effectcraft/blob/9a7d3e76991d5372448033b473dc12c2480a6a04/README.md)
explicitly excludes opening AEP/AEPX. Its
[G4 gap register](https://github.com/storytold/effectcraft/blob/9a7d3e76991d5372448033b473dc12c2480a6a04/docs/gaps.md)
identifies py-aep as a possible external converter requiring a maintainer scope
decision. The Rust application saves its own JSON project format. The license is
[MIT OR Apache-2.0](https://github.com/storytold/effectcraft/blob/9a7d3e76991d5372448033b473dc12c2480a6a04/Cargo.toml);
its [NOTICE](https://github.com/storytold/effectcraft/blob/9a7d3e76991d5372448033b473dc12c2480a6a04/NOTICE)
separates trademark and third-party asset terms.

[PR 251](https://github.com/storytold/effectcraft/pull/251) is open and unmerged.
The head inspected on 2026-10-11 was
`ee1afa01225280e041c34c9d2e8ab563c13c44ca`. It introduces an in-memory Rust decoder in
[`crates/engine/src/aep.rs`](https://github.com/storytold/effectcraft/blob/ee1afa01225280e041c34c9d2e8ab563c13c44ca/crates/engine/src/aep.rs):

- Binary RIFX/RIFF structure, composition/layer reconstruction, static transform
  values, and footage/font/plugin references. Animated transforms retain layer
  defaults. Text content currently uses the layer name and default styling;
  solid colors are fixed gray. Name-based composition maps and null fallbacks
  remain in reconstruction.
- AEPX performs four simple numeric tag searches and constructs one empty
  composition. It does not reconstruct an arbitrary XML project.
- Chunk depth/node/item caps exist, but limits and truncated payloads can yield
  partial trees instead of a refusal. Motionscaper's admission rules would need
  an independent audit. Seven synthetic module tests include signature,
  transform, small project and prefix/garbage checks; none establishes AE pixels.
- There is no binary AEP/AEPX writer in this proposal.

Its [stage tracker](https://github.com/storytold/effectcraft/blob/ee1afa01225280e041c34c9d2e8ab563c13c44ca/docs/aep/README.md)
records an unresolved provenance/scope decision and precomposition identity
problems. The header cites community reverse
engineering and py-aep; the tracker does not establish independent clean-room
provenance. Importing EffectCraft's engine would also bring a much broader
crate/model dependency closure than a standalone format reader.

Storytold does have other Adobe-adjacent format work:
[FilmCraft's interchange crate](https://github.com/storytold/filmcraft/blob/4e2d0bc2d3646f9cf27ef7aa8b2095c6858c7efe/crates/interchange/src/lib.rs)
reads/writes six timeline interchange formats, while
[PhotoCraft's PSD crate](https://github.com/storytold/photocraft/blob/60339cf67543a25179e2a83067fd61b237ad5ad7/crates/psd/README.md)
provides PSD/PSB reading and writing. Neither supplies AEP support.

## Separate candidates reached through that research

### py-aep: a real binary reader and writer

Pinned main: `edcae7abf08dc31b75c878d84b2a4e952105d842`. The latest published release
observed was [v0.18.1](https://github.com/forticheprod/py-aep/releases/tag/v0.18.1)
(2026-10-07); this review does not assume that release contains every main-branch
capability. This is Fortiche's separate project, not Storytold code.

The [public API](https://github.com/forticheprod/py-aep/blob/edcae7abf08dc31b75c878d84b2a4e952105d842/src/py_aep/__init__.py)
parses AEP and creates new projects.
[`Project.save`](https://github.com/forticheprod/py-aep/blob/edcae7abf08dc31b75c878d84b2a4e952105d842/src/py_aep/models/project.py#L2082)
writes a fresh destination through
[`write_aep`](https://github.com/forticheprod/py-aep/blob/edcae7abf08dc31b75c878d84b2a4e952105d842/src/py_aep/binary/chunk.py#L773),
which serializes RIFX chunks and trailing XMP. Saving is explicitly experimental
and refuses an existing destination. This is native format serialization,
not JSX generation or a renderer.

The [manifest](https://github.com/forticheprod/py-aep/blob/edcae7abf08dc31b75c878d84b2a4e952105d842/pyproject.toml)
specifies Python 3.7+, attrs, PyYAML, fonttools and, on supported Python versions,
uharfbuzz. The [MIT license](https://github.com/forticheprod/py-aep/blob/edcae7abf08dc31b75c878d84b2a4e952105d842/LICENSE)
requires retaining its copyright/permission notice. A desktop subprocess would
need a separately bounded, pinned Python/dependency distribution; it cannot be
dropped into the browser TypeScript bundle as-is.

The [format research](https://github.com/forticheprod/py-aep/blob/edcae7abf08dc31b75c878d84b2a4e952105d842/docs/file_format.md)
describes reverse engineering from saved files and AE behavior, principally
CC 2018 through AE 2026, with inferred/unknown fields identified. AEPX is out of
scope. The [limitations](https://github.com/forticheprod/py-aep/blob/edcae7abf08dc31b75c878d84b2a4e952105d842/docs/limitations.md)
include version-layout changes that cannot be solved by relabeling a file.
The [README](https://github.com/forticheprod/py-aep/blob/edcae7abf08dc31b75c878d84b2a4e952105d842/readme.md)
excludes expression evaluation and rendering, limits runtime-synthesized data,
and restricts adding effects to definitions already present in an AEP.

There are meaningful
[save/reparse and byte-identity tests](https://github.com/forticheprod/py-aep/blob/edcae7abf08dc31b75c878d84b2a4e952105d842/tests/roundtrip/test_models_project.py#L744)
and [cross-version tests](https://github.com/forticheprod/py-aep/blob/edcae7abf08dc31b75c878d84b2a4e952105d842/tests/read_only/test_versions.py).
The latter skip when a sample is missing. The
[quality workflow](https://github.com/forticheprod/py-aep/blob/edcae7abf08dc31b75c878d84b2a4e952105d842/.github/workflows/quality.yml)
restores Git LFS samples. These are upstream tests inspected as source, not
checks run here or proof that Motion-authored exports open/render in AE.

### aep-reader: a narrower Rust/WASM reader candidate

Pinned external project: `yueli-fx/aep-reader` at
`16cfdb6983621370352a8dd26dcd01845378bb83`, linked from EffectCraft issue 190.
Its [manifest](https://github.com/yueli-fx/aep-reader/blob/16cfdb6983621370352a8dd26dcd01845378bb83/Cargo.toml)
is an unpublished Rust crate, MIT OR Apache-2.0, with no default dependencies
and optional Serde. Its
[byte API](https://github.com/yueli-fx/aep-reader/blob/16cfdb6983621370352a8dd26dcd01845378bb83/src/lib.rs)
and [limits](https://github.com/yueli-fx/aep-reader/blob/16cfdb6983621370352a8dd26dcd01845378bb83/src/error.rs)
separate parsing from filesystem access and bound bytes, chunks, nesting,
keyframes and accounted allocations. Original chunk spans remain available.
This is a plausible browser-WASM/native investigation route, not a shipped
Motionscaper adapter or demonstrated browser runtime integration.

The [scope](https://github.com/yueli-fx/aep-reader/blob/16cfdb6983621370352a8dd26dcd01845378bb83/README.md)
excludes writing, AEPX, rendering, media decoding and expression/plugin execution.
An experimental EffectCraft adapter writes `.ecproj` with an omissions report.
[Provenance](https://github.com/yueli-fx/aep-reader/blob/16cfdb6983621370352a8dd26dcd01845378bb83/PROVENANCE.md)
explicitly traces private Go work and previous reference implementations and
makes no independent clean-room claim.

The [validation record](https://github.com/yueli-fx/aep-reader/blob/16cfdb6983621370352a8dd26dcd01845378bb83/VALIDATION.md)
reports 2,197 binary projects converting and reopening among 2,734 local inputs;
the remainder were 536 Git LFS pointers and one invalid header. It also reports
synthetic boundary tests and actual EffectCraft samples. These results do not
establish AE reference fidelity, and the private source projects are not
distributed as a public reproducible benchmark. The stated Wasm check establishes compilation, not a
browser UI. No such tests were run during this research.

## Recommended follow-on

Keep the existing script/exchange/rendered-transfer workflow and its explicit
installed-host qualification gate. Do not add these dependencies to the release
branch on the basis of repository claims.

A separate feasibility spike should compare the pinned standalone Rust reader
and py-aep on our own versioned fixtures, retaining their source and provenance
records. Start with read-only extraction into
Motionscaper's inert exchange/report model. Require hard limits, cancellation,
exact original-AEP custody, explicit unsupported entries, and user-selected
media access; never execute expressions/plugins or follow arbitrary source paths.
Test duplicate names, parent/precomp references, fractional timing, malformed
inputs, unknown chunks and save/reopen custody. Use upstream agreement only as a
diagnostic, not the correctness oracle.

Treat direct binary writing as a separate py-aep-backed desktop experiment, with
new destinations and pinned target versions. Its acceptance still requires
real installed-AE reopen/render evidence, unavailable here. Neither candidate
eliminates that gate or provides native AE plug-in compatibility. This review
adds no implementation, vendored source, runtime asset or dependency change.
