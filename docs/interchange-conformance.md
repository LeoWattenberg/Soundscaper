# Interchange conformance reference implementations

> How the milestone-6C interchange profiles are checked against readers that are
> not ours and what is provisioned to do it. Owning slice docs:
> [6C pickup](milestone-6c-interchange-archive.md).

## Why a third-party reader at all

The in-tree conformance suites prove each emitted file is self-consistent: the
EDL re-parses, the OTIO values are whole, the FCPXML times are rational. That is
worth having and it is not the same claim as "a real NLE can read this". A
writer and its own reader can share a misunderstanding indefinitely and every
test will stay green.

So the profiles are additionally read back by the OpenTimelineIO reference
implementation and its format adapters. Nothing in that assertion path is ours:
our exporter writes bytes, a Python reader parses them, and the test asserts on
what came back.

## What is provisioned

`config/interchange-conformance-tools.json` pins the exact versions;
`scripts/provision-interchange-conformance.mjs` fetches and verifies them into
`vendor/interchange-conformance/`, which is not committed.

| Package | Version | License | Used for |
| --- | --- | --- | --- |
| `opentimelineio` | 0.18.1 | Apache-2.0 | 6C-1b round trip; plugin host for the adapters |
| `otio-cmx3600-adapter` | 1.0.0 | Apache-2.0 | reference CMX3600 reader |
| `otio-fcpx-xml-adapter` | 1.0.0 | Apache-2.0 | reference FCPXML reader |

Run `npm run provision:interchange-conformance` once, then
`npm run test:reference:interchange`.

These are **conformance-time tools**. Nothing is bundled, linked, or shipped, so
no obligation flows into the AGPL-3.0-only distribution. Apache-2.0 is one-way
compatible with GPLv3-family licensing and would remain acceptable even if any
of it were ever linked rather than merely executed.

### Why the wheels are provisioned rather than committed

The OTIO core is a native extension published as twenty platform wheels. A
single vendored binary would work on one machine and no other, so what is
committed instead is the thing that makes provisioning reproducible: exact
versions, and sha256 digests for every wheel whose bytes are
platform-independent. The platform wheel is selected by asking pip which tags
this interpreter accepts — a hand-rolled PEP 425 matcher is a subtle way to
install something that imports on the build host and nowhere else — and
verified against the digest PyPI publishes for that exact version. That pins the
version and proves the bytes arrived intact. It does not, and does not claim to,
establish trust in PyPI itself.

### Why Apple's FCPXML DTD is not vendored

It is not published under terms that permit redistribution. Validating against a
schema we may not carry would trade a licensing problem for a conformance claim
that the reference reader gives us honestly instead.

## Third-party notices

`THIRD_PARTY_LICENSES.md` already records the three pinned reference packages,
their versions and Apache-2.0 terms, and the fact that they are executed only by
the opt-in conformance tests rather than bundled or distributed. The FFmpeg
runtime manifest binds the notice bytes with ordinary byte-length and SHA-256
integrity metadata; `node scripts/repin-runtime-evidence.mjs` refreshes those
descriptors after a deliberate notice edit, with no human approval record.
