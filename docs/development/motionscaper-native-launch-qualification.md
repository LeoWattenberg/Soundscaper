# Packaged Motionscaper file launch qualification

This external Linux X11 harness verifies the authenticated packaged application,
then passes project files as real process arguments. The first starts the app;
later invocations reach Electron's single-instance main process. No preload,
file service, IPC bridge or renderer implementation is replaced or injected.
The harness and fixtures are excluded from the package.

```sh
SCAPE_PRODUCT=motionscaper SOUNDSCAPER_SOURCE_REVISION="$(git rev-parse HEAD)" MOTIONSCAPER_NATIVE_BUILD_RESULT=/path/to/verified-result npm run desktop:prepare
SCAPE_PRODUCT=motionscaper npx electron-builder --config electron-builder.config.cjs --dir --config.directories.output=release/desktop-nightly-products/motionscaper
xvfb-run -a node scripts/motionscaper-launch-native-smoke.mjs
```

The fixture checks cold `.mscape` opening without a File menu action, then edits
and uses File > Save. Reimporting the actual archive proves that the original
file capability was bound and the saved project changed. A warm `.scape` launch
waits while Composition Settings is open. Its same-ID conflict requires review;
Import Independent Copy retains the original file unchanged. Two further warm
invocations remain queued through that review: a future-schema `.scape` opens
as read-only custody, and another current project waits behind it. Reloading the
renderer must revoke the old capability and reissue the pending read-only file
before the last project can open. Project Library retains both saved projects,
and hashes prove Copy and opaque custody did not modify the incoming archives.

The harness first failed against the earlier package at the cold-open assertion:
the menu-only shell appeared, but no project opened. The final
`MOTIONSCAPER_NATIVE_LAUNCH_QUALIFIED` record names the exact packaged revision
and each verified boundary. It uses software rendering (`--disable-gpu`); this
file workflow does not provide additional GPU or codec qualification.

The Linux x64 development run passed against packaged source revision
`99fcba0c033c8554b72686e0abfdb0defe45563c`, at
`motionscaper-app://bundle/`. All ten recorded workflow assertions passed,
including the actual original-file Save and renderer-reload queue recovery.

This checks the actual packaged Linux argument and single-instance paths. It
does not install an OS association, claim Linux desktop-environment MIME
dispatch, or qualify macOS `open-file` events and Windows Explorer associations.
Those platform installation receipts remain separate. `.mscape` and the
registered legacy `.scape` extension are admitted; extension never grants
schema authority. Foreign/future contents still use the same read-only
custody path as File > Open. Renderer windows are created only after the own
protocol and narrow IPC handlers are ready. Native paths stay in main; the
renderer receives bounded capabilities and acknowledges after release.

No manual **Update AI assets** run is needed. The helper, assistance closure,
source pins, target inventories and dependency metadata remain unchanged.
