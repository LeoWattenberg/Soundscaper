# Soundscaper Tauri prototype

This experiment runs Soundscaper's existing React editor in a Tauri system
WebView with a Rust host. It tests whether the desktop bridge can support native
file access and atomic streamed saves without Electron or a Node runtime in the
application. It is not a replacement desktop release.

The renderer uses the existing **browser** storage and codec composition. The
bridge is injected before the editor starts, so the existing application menus
open native file dialogs and select native save destinations. The application
opens its editor directly from `index.html`; it does not need an `/editor` route.

## Prerequisites

- Node.js **26.5.0**, npm **12.0.1**, and the repository's installed npm
  dependencies (`npm ci` for a fresh checkout).
- Rust and Cargo on `PATH`. The host's `rust-toolchain.toml` pins the toolchain;
  let rustup install that version rather than changing the pin locally.
- The platform compiler and WebView dependencies from the official
  [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

On Debian/Ubuntu, Tauri's documented development packages are
`libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev
libayatana-appindicator3-dev librsvg2-dev`. The native file-dialog backend also
uses GTK 3. For headless Linux smoke tests, install `xvfb` and `xauth` so that
`xvfb-run` is available. Windows needs the Microsoft C++ build tools and
WebView2; macOS needs the Xcode command-line tools.

Node and npm are build tools here; the application executable does not embed
Node. The first Cargo build needs network access to download the pinned Rust
dependencies. A Rust build alone does not install the operating system's GTK or
WebView development packages.

## Build and run

Run from the repository root:

```sh
node prototypes/tauri/run.mjs build
node prototypes/tauri/run.mjs run
node prototypes/tauri/run.mjs test
node prototypes/tauri/run.mjs smoke
```

Add `--release` to any command for an optimized Rust build. Without it, Cargo
uses its debug profile. Each command first builds the renderer and injected
scripts, then invokes Cargo with `--locked`. `test` runs the host's Rust tests;
`run` opens the application after building it.

All generated files stay under the ignored `.tauri-prototype/` directory:

| Path | Contents |
| --- | --- |
| `renderer/` | Vite build of the existing Soundscaper browser composition |
| `bridge.js` | Injected desktop bridge IIFE |
| `smoke.js` | Injected native application smoke probe |
| `icons/` | Build-time PNG/ICO icons generated from the existing SVG |
| `target/` | Cargo build cache and executable |
| `smoke-report.json` | Fresh result from the latest native smoke run |

The executable is `target/debug/soundscaper-tauri-prototype` (with `.exe` on
Windows), or the corresponding `target/release/` path. The harness does not run
Electron staging, build AI runtimes, change npm dependency metadata, or create
production installers. It forces the Soundscaper browser build even if the
calling shell has `SCAPE_PRODUCT` or `SCAPE_DESKTOP_CODEC_RUNTIME` set.

## Download a CI build

Open the GitHub Actions workflow **Desktop test artifacts (internal)** and
select **Run workflow**. Choose branch `feat/tauri-prototype`, set
`desktop_host` to `tauri`, and select `nightly_tests_targets`:

- `all` builds Windows x64, macOS arm64, and Linux x64.
- `windows` or `win-x64` builds Windows x64 only.

Download the completed run's `tauri-prototype-<platform>-<arch>` artifacts:
`tauri-prototype-win-x64`, `tauri-prototype-mac-arm64`, or
`tauri-prototype-linux-x64`. Extract the downloaded ZIP, then its `.tar.gz`
archive; this preserves the executable permissions on macOS and Linux. The
archive includes the source revision and license notices. These are unsigned release executables, not
installers. The prototype uses the platform WebView prerequisites above and
does not bundle AI runtimes or require an AI API model to build.

The workflow can also be started from the repository root with GitHub CLI:

```sh
gh workflow run desktop-nightly-tests.yml --ref feat/tauri-prototype \
  -f desktop_host=tauri -f nightly_tests_targets=all
```

## What this exercises

- Existing React editor startup through the versioned desktop bridge.
- User-selected native file reads, represented by opaque capabilities instead
  of exposing unrestricted filesystem paths to the editor.
- Chunked writes to a selected save target, with temporary output committed
  atomically on completion and removed on cancellation.
- A real WebView-to-Rust smoke path, separate from the JavaScript contract and
  Rust unit tests.

The smoke command launches with `--smoke --smoke-report <absolute-path>`. On
Linux without `DISPLAY`, it uses `xvfb-run -a`. It removes any previous report,
limits execution to 120 seconds, and requires both successful process exit and
a newly written report with `success: true`. A missing toolchain, missing
virtual display, renderer failure, or absent report is an error, not a pass.

Smoke mode uses the File menu to open a generated tone and export a WAV. It
substitutes temporary fixture paths for the native dialogs, then exercises the
real bridge and Rust file service. The host parses the exported WAV's audio
chunks and requires non-silent samples. Successful process exit also exercises
the editor's normal flush-and-close handshake.

Validated on Linux x86_64 with WebKitGTK 2.52.6 under Xvfb: editor startup,
menu-driven WAV import/export, non-silent output, and normal close passed.
The renderer exposed neither Node nor `require`. This WebView reported
`crossOriginIsolated: false` and no `SharedArrayBuffer`, despite the configured
COOP/COEP headers. Soundscaper's shared-memory parallel audio engine therefore
cannot be qualified on this configuration; ordinary audio processing remains
in the existing browser engine. This is a material migration constraint.

This establishes that the existing editor can run behind a Rust desktop shell
without rewriting its React UI or browser audio pipeline. The potential benefit
is removing [Electron's bundled Chromium and Node runtime](https://www.electronjs.org/docs/latest/)
from the application; [Tauri uses the operating system's WebView](https://v2.tauri.app/concept/architecture/).
That could reduce download
size and idle memory, but it also introduces differences between WebView
implementations. No comparative footprint or latency benchmark has been run.
Moving the host to Rust alone does not make the retained audio DSP faster.

Run the harness and bridge contract tests independently of Rust:

```sh
node --import tsx --import ./scripts/node-style-asset-loader.mjs --test tests/tauri-prototype-runner.test.ts tests/tauri-prototype-bridge.test.ts
```

## Isolation and current limits

The prototype has a separate application identity and WebView profile. It does
not open or migrate Electron's project library, settings, encrypted credentials,
or browser profile. Its local project storage uses the browser implementation;
projects can be exchanged through explicit file open/save operations.

Native opens and saves have a **512 MiB per-file limit**. Read requests return
binary data in chunks of at most 1 MiB. Writes currently serialize bytes as JSON
arrays; the bridge negotiates chunks of at most 128 KiB, while the Rust host
independently rejects chunks over 1 MiB. This transport needs separate
throughput measurements before it is suitable for large media workloads.

Save completion syncs the temporary file and atomically replaces the selected
destination. It does not sync the parent directory, so it does not establish
power-loss durability for the published directory entry.

This is not feature parity with the Electron application. It does not implement
the production SQLite project-library service, native audio devices, native
plug-ins, persistent delivery queues, native codec services, local AI runtime
management, capture integrations, MCP, release updates, or installer/signing
workflows. Codec availability is that of the retained browser composition and
the host WebView, so a successful file-save test does not establish media-format
or recording parity. Runtime assets fetched by the browser implementation still
require their usual availability.

Testing one Linux WebView build also does not establish macOS or Windows
compatibility. Compare release builds on each target OS before drawing resource
or latency conclusions: measure total process-tree memory, cold startup to an
editable project, sustained import/export throughput, recording stability, and
project reopen fidelity against Electron on the same workload.

The editor's close handshake covers window close and the prototype's Quit
action. macOS application-level Quit still needs separate qualification.

This prototype does not change the assistance runtime closure. A manual
**Update AI assets** run is not required. Porting those services later could
require one if the bundled runtime bytes or target inventories change.
