# Milestone 9 campaign-matrix decision

Status: historical and superseded as of 2026-08-31. The table below records an
abandoned campaign design; it is not required, read by CI, or release authority.
Stable releases use ordinary automated gates plus optional owner QA.

| Surface | Required cells |
| --- | --- |
| Web behavior | Both products on current and previous Chrome, Firefox, and Safari releases (12 product/browser combinations) |
| Desktop behavior | Both products on Windows x64, Windows ARM64, macOS ARM64, Linux x64, and Linux ARM64 (10 product/platform combinations) |
| Native | All 11 Soundscaper and all 7 Framescaper native OS lab profiles (18 profiles) |
| Soak | Six dual-product browser engine/version cells plus five dual-product desktop-platform cells; two consecutive real eight-hour runs per cell (11 cells, 22 runs) |

Each of the 152 guided checks expands over its explicitly applicable cells.
A check is complete only when it cites one recorded, exact-environment
execution for every required cell. Free-text notes, a neighbouring cell, a
hosted runner, Playwright WebKit in place of Safari, a software renderer, or a
retried pass cannot satisfy an omitted execution.

The checked-in behavior-by-environment registry, exact check inventory,
fail-closed admission path, deterministic soak generator/collector, and pending
evidence register implement the campaign machinery. They are not execution
evidence. The 152-check rehearsal and full campaign remain unrun, and none of
the 11 soak cells has an accepted two-run eight-hour qualification pair (0 of
22 required runs are accepted).

Qualification runs use one attempt, zero retries, one worker where the runner
profile applies, digest-pinned inputs, and authenticated environment and
package identities. Soak time is elapsed wall-clock time; the short contract
mode validates the collector only and can never publish qualification. Two
passing runs must also meet the registered repeatability band.

The complete native tier is mandatory for stable 1.0 and is not eligible for
scope reduction. Source acquisition, target payloads, corresponding source and
notices, codec and patent review, signing/notarization, exact hardware
fingerprints, and all six native cohorts remain independent fail-closed inputs.
The present owner legal record does not approve redistribution of bundled
FFmpeg. Until that decision changes and all machine and lab evidence is
accepted, stable 1.0 is blocked; these are external evidence blockers, not
permission for an implementation substitute. The matrix is not reduced and no
synthetic payload, fingerprint, manual result, or cohort may be substituted.

MIDI is outside the stable-1.0 capability set and has no positive capability or
runtime qualification cell. GAT-01 checks only that the shipped absence fence
remains closed; future MIDI design and compatibility work remains post-1.0 and
cannot block stable while the absent capability is not claimed.
