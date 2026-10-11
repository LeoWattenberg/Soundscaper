# Linux packaged qualification gate

Motion candidate packages and desktop nightly test artifacts require the same
three external Linux workflows before their package upload can succeed:

1. Actual cold and warm archive launch, native Save, reviewed Copy, queued opaque
   custody and renderer-reload recovery.
2. Actual packaged 2.5D camera, lighting, shadow, four-sample shutter and
   sixteen-sample lens preview and ProRes delivery against matching-quality
   reference pixels.
3. Actual Frame successor linked Motion picture and PCM, saved updates,
   Undo/Resume, offline retained originals, Frame finishing and native delivery.

The composite action at
`.github/actions/motionscaper-linux-qualification/action.yml` runs on each Linux
x64/arm64 native runner. It prepares and packages an explicitly selected
`framescaper-successor-v2` stage separately from Motion. It retains Chromium's
sandbox and uses real GTK file dialogs under Xvfb. The package qualifiers verify
stage and packaged resource inventories before opening any app. They grant no
additional production IPC, renderer or filesystem authority.

## Separate reference decoder

The native build job compiles the bounded libav reference decoder against the
same pinned FFmpeg installation as the production helper. It uploads a separate
`motionscaper-reference-decoder-<target>` artifact containing only the decoder,
its third-party notices and `reference-receipt.json`. The receipt binds the
checkout revision, committed decoder source and compiler adapter, independently
verified native build receipt/helper/source pins, and exact decoder/notices
bytes. Download verification refuses a foreign target, changed or extra files,
symlinks, uncommitted decoder sources and altered receipts before execution.
Executable permission is restored only after verification.

This test artifact is excluded from app stages, native runtime inventories and
candidate installers. It is not a new production codec or assistance runtime.
No manual **Update AI assets** run is required.

## Local execution

Existing individual smoke scripts retain their default nightly package paths.
For candidate paths or independent stages, set the explicit
`MOTIONSCAPER_QUALIFICATION_STAGE`, `MOTIONSCAPER_QUALIFICATION_PACKAGE`,
`FRAMESCAPER_SUCCESSOR_QUALIFICATION_STAGE` and
`FRAMESCAPER_SUCCESSOR_QUALIFICATION_PACKAGE` variables. These test-only paths
must be absolute and normalized. Both apps must be prepared from the current
full checkout revision.

Build the separate decoder once using the existing verified helper and its
pinned FFmpeg installation:

```sh
node scripts/motionscaper-reference-artifact-build.ts --target=linux-x64 \
  --native-result=/absolute/native-result --ffmpeg-prefix=/absolute/ffmpeg-install \
  --output=/absolute/new-decoder-artifact
```

Run all three qualifiers with explicit package and stage locations:

```sh
xvfb-run -a node scripts/motionscaper-linux-qualification.ts --target=linux-x64 \
  --native-result=/absolute/native-result --decoder-artifact=/absolute/decoder-artifact \
  --motion-stage=/absolute/motion-stage --motion-package=/absolute/motion-linux-unpacked \
  --successor-stage=/absolute/frame-stage --successor-package=/absolute/frame-linux-unpacked \
  --output=/absolute/new-qualification-output
```

The output directory is created exclusively. Each phase is sequential and
bounded to six minutes and 2 MiB of process output. The final `qualification.json`
is written only after exactly one of all four required workflow receipts
matches the current source revision. It hashes the logs and copies the two
stage manifests, helper build receipt and decoder receipt. CI retains this
separate `motionscaper-linux-qualification-<target>` evidence artifact even when
partial failure diagnostics exist; a failed qualifier still fails the package
job. It does not publish a release.

The scene receipt covers software rendering and declared ProRes precision, not
hardware GPU equivalence. Linux ARM execution, other operating systems,
credentialed signing, installed file-association dispatch, installed After
Effects comparisons and broader codec/color profiles require their own actual
receipts. Workflow inclusion alone does not establish those receipts.
