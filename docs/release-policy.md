# Release policy

Soundscaper is an owner-run hobby project. Pushing the stable tag is the owner's
release decision. There is no certification, admission authority, reviewer
signature, evidence register, fixed lab campaign, or waiver process.

## What automation establishes

Automated tests establish only what actually ran and passed on their reported
source revision and environment. A stable-tag run repeats the normal static,
Node, browser, native-build, package, and smoke checks before assembling the
release. Deterministic correctness failures block that workflow. Performance
diagnostics report useful trends without claiming that one machine represents
every user's hardware.

SHA-256 inventories, pinned sources, package-content checks, and runtime payload
authentication remain ordinary integrity controls. They detect accidental or
hostile byte substitution; they do not constitute a signed release approval.

## Manual QA

The evergreen [Soundscaper](qa/soundscaper.md) and
[Framescaper](qa/framescaper.md) worksheets help the owner exercise workflows
that benefit from human observation. Completed copies are local, ignored files.
Manual QA is never read as a CI gate and no script converts it into release
readiness.

Do not release with a known data-loss, security, licensing, or primary-workflow
failure. Everything else—including which conditional environments to try and
whether a bounded issue is acceptable—is an explicit owner decision.

## Release sequence

1. Run the ordinary development and browser checks and use a local QA worksheet
   when human verification is useful.
2. Prepare the version metadata with
   `npm run release:soundscaper:prepare -- <version>` and commit that change.
3. Push the matching stable tag. The tag workflow rebuilds and tests that exact
   revision, creates unsigned packages, verifies their integrity, deploys the
   site, and publishes the GitHub release.
4. If a serious defect appears, remove or disable the affected distribution,
   preserve user projects, fix the bug test-first, and publish a new version.

Framescaper keeps its independent tag namespace and release timing. Neither
product's release decision grants schema, storage, native-payload, or update
authority to the other.
