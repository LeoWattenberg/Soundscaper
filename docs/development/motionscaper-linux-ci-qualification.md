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

## Local Linux x64 receipt

The complete runner passed against both actual packages from source revision
`1b96f6b9d658d92d12555572043a89e192a703ff`. All three phases completed and all four
required receipts were present. The aggregate record SHA-256 was
`24d2bb7e2bfe65a3deeb0cb4b798660a599a8f1bceb956fb161adea558cca525`; the independent
decoder receipt SHA-256 was
`435acc3bcf35cc5134a1876a669baf888aee2ff651171f4e0aeff68d1f3a8248`.
A separate real-artifact check also refused a one-byte decoder alteration before
execution.

Motion scene results retained the declared reference bounds: maximum preview
premultiplied error `0.980392157` byte code, straight Rec.709 RGB error
`0.005994711`, and alpha error `0.001403987`. Its two-frame movie digest remained
`cf03af644b7e279bbdc9c43242ead9694bc3cb417e8aa7de63e48d67e20fec53`.

The successor canvas midpoint was `[89, 45, 149, 255]` before and after offline
reopen. Comparison explicitly converts decoded native Rec.709 values to the
sRGB canvas boundary; the maximum difference was one display code, within the
unchanged three-code tolerance. Native analytical checks remain in Rec.709:
RGB error `0.005798446`, alpha error `0.000603348`, and PCM error zero across
4,800 stereo frames at 48 kHz. The three-frame movie digest was
`3c37b639b24c65dc7e60c59b7a055a2407700f02cc21044016446c4b9361f313`.

This local receipt exercises the same source-bound runner used by CI with a
software-rendered Motion app and software WebGL2 successor. It does not replace
execution of the hosted Linux ARM job, signed installation qualification or
hardware GPU receipts. No workflow was dispatched and no artifact was published.
