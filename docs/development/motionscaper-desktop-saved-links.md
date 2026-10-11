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
update preserves the last accepted receipt and closure. Disconnect aborts the
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
```

The stage/package checks authenticate every application and renderer byte,
refuse undeclared runtime files, verify Electron's pinned alternate codec
library and apply the existing hardened Electron fuse policy. Linux x64 shell
qualification mounts the actual editor and confirms its databases, origin,
capability surface and unissued-token refusal. Windows, macOS, other Linux
architectures and the complete interactive native link/update workflow still
need platform qualification. Node tests exercise real atomic replacement,
pinned old/new bytes, corruption, transfer cancellation and cleanup retry; they
do not replace that interactive qualification.

This work changes no assistance runtime closure and requires no manual
**Update AI assets** run.
