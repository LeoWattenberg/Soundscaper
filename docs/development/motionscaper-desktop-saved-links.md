# Desktop saved Motionscaper links

The Framescaper 1.1 development desktop is a separate application using the
renderer-owned successor project store. It is selected explicitly; the baseline
Framescaper desktop cannot open this store or receive its native capability.

The application uses `org.framescaper.successor.desktop`, the
`framescaper-successor-app://bundle` origin, the
`persist:framescaper-successor-v2` Electron session and the
`Framescaper-Successor-v2` user-data directory. Its owner and media databases are
`kw-media-framescaper-editor-v2` and `kw-media-framescaper-editor-v2-media`.
No baseline native project library, processing service, updater or file
association is registered. Ordinary project/media file workflows use the
successor browser file service; canonical project authority remains in the v2
renderer store.

`framescaperSuccessorDesktop.v1.motionSavedFiles` exposes selection, discovery,
bounded snapshot reads, snapshot release and cancellation. Only the active
main document at the application origin can invoke it. Each renderer lifetime
has independent grants that are revoked on navigation, renderer loss and close.
A native chooser authorizes a regular `.mscape` file. Renderer requests contain
opaque watch/read IDs and never supply paths. Discovery polls file identity and
renews its generation after atomic replacement. An already pinned descriptor
retains the previous inode while a new descriptor reads the saved replacement.
Missing files, symlinks or a changed containing directory cannot silently extend
the original selection's authority.

The native authority admits eight selected files, sixteen pinned descriptors,
64 GiB per archive and 4 MiB per read. The shared archive adapter validates
bounded ZIP structure, the project digest, the exact Motion asset descriptor
closure and streamed asset hashes before the Framescaper owner receiver can
finish its transaction. No selected path or active watcher is portable intent.

`createMotionSavedFileConnection` belongs to the controller lifetime, so an
opt-in dialog can close without disconnecting the link. Receives are serial;
the next poll observes the newest generation after a busy transaction. A failed
private receive leaves its generation eligible for another poll, so Refresh can
retry unchanged saved bytes after a temporary receiver write failure. Failure
preserves the last verified receive receipt and closure. Disconnect aborts the
private receive, waits for its cleanup and cancels the watch. Cleanup failures
remain visible and cancellation can be retried. A completed owner publication
is not undone by a later cancellation; post-publication cleanup errors carry
the accepted receipt.

Build and qualify the isolated development application with:

```sh
SOUNDSCAPER_SOURCE_REVISION=$(git rev-parse HEAD) \
SCAPE_PRODUCT=framescaper SCAPE_FRAMESCAPER_LINE=successor \
SCAPE_FRAMESCAPER_DESKTOP_PROFILE=framescaper-successor-v2 \
node scripts/desktop-prepare.mjs

SCAPE_PRODUCT=framescaper SCAPE_FRAMESCAPER_LINE=successor \
SCAPE_FRAMESCAPER_DESKTOP_PROFILE=framescaper-successor-v2 \
npx electron-builder --config electron-builder.framescaper-successor.cjs --linux --x64 --dir

xvfb-run -a node scripts/framescaper-successor-desktop-smoke.mjs
xvfb-run -a node scripts/motionscaper-successor-native-smoke.mjs
```

The stage/package checks authenticate every application and renderer byte,
refuse undeclared runtime files, verify Electron's pinned alternate codec
library and apply the existing hardened Electron fuse policy. Linux x64 shell
qualification mounts the actual editor and confirms its databases, origin,
capability surface and unissued-token refusal. The second smoke uses the actual
packaged application, GTK chooser and native watch. Python 3, X11, libX11 and
libXtst are required; it launches the application in the C.UTF-8 locale and
selects its own temporary archive through GTK's Open action. It does not replace
the chooser, preload, IPC or saved-file provider with a test implementation.

Linux x64 interactive qualification passed at source
`1f5fdb43f4828951c7b177221a6d676fbe1cdc65`. It verifies automatic receipt of an
atomic saved revision while the dialog is closed, refusal of a corrupt
replacement without losing the accepted revision, receipt of the next valid
save, and Disconnect retaining that revision and the exact original PNG bytes
in the v2 owner store. Kernel inotify inspection confirms the directory watch
count changes from zero to one after selection and returns to zero on
Disconnect. The receipt records the authenticated package source revision,
accepted digests and database names; temporary archives and profile are removed.

Windows, macOS, other Linux architectures, Wayland and other native chooser
configurations still need platform qualification. Node tests additionally cover
pinned old/new bytes, transfer cancellation and retryable cleanup failures;
they do not replace interactive platform qualification.

This work changes no assistance runtime closure and requires no manual
**Update AI assets** run.
