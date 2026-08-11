# Building an Audacity-style UI with `@dilsonspickles/components`

This file is written for AI coding agents working in a consumer repo. It is the playbook for assembling a full Audacity-style audio editor UI out of the components this package ships. Read top-to-bottom for first-time setup; jump to sections by name for targeted tasks.

**Source of truth.** The working reference implementation is `apps/sandbox` in the source repo (https://github.com/DilsonsPickles/audacity-design-system). When the recipes here are not enough, read those files — they are how the package authors themselves use the library.

---

## 1. What this package is

A React component library for building DAW-style audio editing UIs. It ships:

- **Layout primitives**: `ApplicationHeader`, `ProjectToolbar`, `Toolbar`, `EditorLayout` building blocks, `SidePanel`, `ResizablePanel`, `PanelHeader`
- **Audio surfaces**: `Track` / `TrackNew`, `Clip`, `ClipBody`, `ClipHeader`, `TimelineRuler`, `VerticalRuler`, `PlayheadCursor`, `EnvelopeCurve`, `WaveformPreview`
- **Selection overlays**: `TimeSelectionCanvasOverlay`, `SpectralSelectionOverlay`, `SelectionToolbar`
- **Transport / control**: `TransportButton`, `TransportToolbar`-compatible primitives, `ToolButton`, `ToggleToolButton`
- **Dialogs**: `Dialog`, `PreferencesModal`, `ExportModal`, `SaveProjectModal`, `WelcomeDialog`, `PluginBrowserDialog`, `EffectDialog`, `AlertDialog`
- **Tabs / home**: `HomeTab`, `ProjectThumbnail`, `Carousel`, `TabList` / `Tab` / `TabItem`
- **MIDI**: `PianoRoll`, `NoteRect`, `MidiClipBody`
- **Effects**: `EffectsPanel`, `MixerPanel`, `MixerChannel`, `MixerFader`, `MasterMeter`, `TrackMeter`

What it does **not** ship: the audio engine, project persistence, keyboard shortcut dispatcher, undo/redo stack. Those are application concerns the consumer brings.

---

## 2. Install

```bash
pnpm add @dilsonspickles/components
# peer deps the package does not bundle:
pnpm add react@^18 react-dom@^18
```

Stylesheet (required — components are unstyled without it):

```ts
import '@dilsonspickles/components/style.css';
```

The MusescoreIcon font ships inside `dist/` and is auto-referenced from the stylesheet — no extra setup needed.

---

## 3. Provider tree

Two providers are **required** for most components to render without throwing:

```tsx
import {
  ThemeProvider,
  AccessibilityProfileProvider,
  PreferencesProvider,
  darkTheme,
} from '@dilsonspickles/components';

<PreferencesProvider>
  <ThemeProvider theme={darkTheme}>
    <AccessibilityProfileProvider initialProfileId="au4-tab-groups">
      {/* app */}
    </AccessibilityProfileProvider>
  </ThemeProvider>
</PreferencesProvider>
```

- `ThemeProvider` — required. Theme tokens drive every component's colors.
- `AccessibilityProfileProvider` — required for keyboard navigation primitives (roving tabindex, focus management). Without it, hooks like `useContainerTabGroup` fall back to defaults but tab navigation will be flat sequential.
- `PreferencesProvider` — required if you render `PreferencesModal` or use `usePreferences`. Otherwise optional.

Both `useTheme()` and `useAccessibilityProfile()` return safe defaults when called outside their providers (added in 0.2.0) so isolated components rendered without a provider tree will not crash. This is the "standalone mode" — useful for static rendering / SSR / docs sites.

Themes available out of the box: `lightTheme`, `darkTheme`. To customize, pass any object matching `ThemeTokens` (typed export). Common pattern (from the sandbox):

```tsx
function ThemedApp() {
  const { preferences } = usePreferences();
  const theme = preferences.theme === 'dark' ? darkTheme : lightTheme;
  return <ThemeProvider theme={theme}>{/* … */}</ThemeProvider>;
}
```

---

## 4. Layout shell — the full picture

**Read this section carefully.** Many agents build only a partial shell and then ship — missing the OS menu bar, transport row, status bar, or per-track vertical ruler. The reference editor has **six** distinct vertical regions inside a `100vh` flex column, plus a status bar at the bottom:

```
┌─────────────────────────────────────────────────────────────┐  ← OS title bar (browser-provided in web app)
├─────────────────────────────────────────────────────────────┤
│ File  Edit  Select  View  Record  Tracks  …                │  ← (1) ApplicationHeader.menuBar  — 28px
├─────────────────────────────────────────────────────────────┤
│ Home  Project  Export  Debug    Mixer  Audio setup  …  ⤺ ⤻ │  ← (2) ProjectToolbar          — 40px
├─────────────────────────────────────────────────────────────┤
│ ▶ ⏹ ⏺ ⏮ ⏭ ↻ │ env │ 🔍+ 🔍− ⤧ │ ✂ 📋 📋 │ ⊟ ⊟ │ 00d00h00m01s │ Snap │ Bar │ 🎤 🔊 ▰▰▰▰▱▱▱▱▱│  ← (3) Transport row    — auto, ~40-48px
├──────┬──────────────────────────────────────────────┬───────┤
│      │ 0:00     0:01     0:02     0:03     0:04    │       │  ← TimelineRuler
│ T    │ ┌──────────┐  ┌────────────────────────┐    │  Amp  │
│ R    │ │Lead vocal│  │ Harmony                │    │  RUL  │  ← (4) Editor body (flex: 1)
│ A    │ │waveform  │  │ waveform               │    │       │     • Left: TrackControlPanel column (268px each)
│ C    │ └──────────┘  └────────────────────────┘    │       │     • Center: timeline + TrackNew canvases (scrolls H+V)
│ K    │ ┌──────────────────────────────────────┐    │       │     • Right: VerticalRuler per track (~32px)
│ S    │ │Pad envelope curve                    │    │       │     • Optional right rail: SidePanel with Mixer/Effects
├──────┴──────────────────────────────────────────────┴───────┤
│ Stopped  │  Click and drag to select audio  │  Selection: 00h00m00s  Duration: 00h00m00s │  ← (5) Status bar — ~32px
└─────────────────────────────────────────────────────────────┘
```

Full skeleton:

```tsx
import {
  ApplicationHeader, ProjectToolbar, HomeTab,
  Toolbar, ToolbarButtonGroup, TransportButton, ToolButton,
  TimeCode, MasterMeter,
  TimelineRuler, TrackNew, TrackControlPanel, VerticalRuler,
  PlayheadCursor, ToastContainer,
} from '@dilsonspickles/components';

export function EditorShell() {
  const [activeMenuItem, setActiveMenuItem] = useState<'home' | 'project' | 'export' | 'debug'>('home');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw' }}>
      {/* (1) OS-style menu bar — File, Edit, Select, View, Record, Tracks, Generate, Effect, Analyze, Tools, Extra, Help */}
      <ApplicationHeader os="mac" menuDefinitions={menuDefinitions} />

      {/* (2) Tabbed nav + workspace selector + undo/redo */}
      <ProjectToolbar
        activeItem={activeMenuItem}
        onMenuItemClick={setActiveMenuItem}
        rightContent={
          <>
            <ToolButton icon="mixer" label="Mixer" onClick={openMixer} />
            <ToolButton icon="audio-setup" label="Audio setup" onClick={openAudioSetup} />
            <ToolButton icon="share" label="Share audio" onClick={share} />
            <ToolButton icon="effects" label="Get effects" onClick={openMarketplace} />
            <WorkspaceDropdown value={workspace} onChange={setWorkspace} />
            <ToolButton icon="undo" onClick={undo} disabled={!canUndo} />
            <ToolButton icon="redo" onClick={redo} disabled={!canRedo} />
          </>
        }
      />

      {activeMenuItem === 'home' && <HomeTab projects={projects} {/* … */} />}
      {activeMenuItem === 'project' && (
        <>
          {/* (3) Transport row — see section 4a */}
          <TransportRow {/* … */} />

          {/* (4) Editor body */}
          <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
            <EditorBody {/* … */} />
          </div>

          {/* (5) Status bar — see section 4c */}
          <StatusBar {/* … */} />
        </>
      )}

      <ToastContainer />
    </div>
  );
}
```

### Canonical dimensions + flex behaviour (use these — do not guess)

Outer shell is a vertical flex column at `100vh`. Each row below documents the exact size + flex characteristics the component already sets on itself, plus what you need to do on the wrapper. **If a column says "self-sized" the component sets it internally — don't override.**

| # | Region | Component | Height | Width | Flex behaviour | Notes |
|---|---|---|---|---|---|---|
| 1 | OS title row | (`ApplicationHeader` title row) | 28px | 100% | `flex-shrink: 0` | Includes traffic-light area on mac, min/max/close on win |
| 1 | OS menu bar | (`ApplicationHeader` menu bar) | 28px | 100% | `flex-shrink: 0` | File/Edit/View…; ApplicationHeader stacks title + menu = 56px total |
| 2 | Tabs + workspace + undo | `ProjectToolbar` | 40px (+2px focus accent) | 100% | `flex-shrink: 0` | Renders own internal layout; use `rightContent` slot for workspace+undo/redo |
| 3 | Transport row | `Toolbar` (composed) | self-sized (~40px from button row) | 100% | `flex-shrink: 0` | `display: flex; justify-content: space-between`. Buttons are 24px high. |
| 4 | Editor body wrapper | (your div) | `flex: 1; min-height: 0` | 100% | grows to fill remaining height | **`min-height: 0` is required** — without it, flex children with overflow break |
| 4a | Track control column | `TrackControlPanel` | matches its row | **268px self-sized** | `flex-shrink: 0` | Do not put it in a flex parent that can shrink it. Width is intentional. |
| 4b | Canvas column | `TrackNew` + overlays | matches its row | `flex: 1` | grows | Wrap in `position: relative; overflow: hidden` so playhead overlay can be `position: absolute` |
| 4c | Vertical ruler column | `VerticalRuler` | matches its row | self-sized (~32px) | `flex-shrink: 0` | Right-side amplitude/frequency scale |
| 4-top | Timeline ruler | `TimelineRuler` | 40px default | matches canvas column | `flex-shrink: 0` | Sits above the track rows. **Pass `viewportWidth` (visible width), not the project width**, so the canvas stays sharp on HiDPI. See section 4e. |
| 5 | Status bar | `SelectionToolbar` | 40px | 100% | `flex-shrink: 0` | Always last child of the editor body's parent flex column |
| — | Track row | (your wrapper) | `track.height ?? 114` (`DEFAULT_TRACK_HEIGHT`) | 100% | `display: flex; flex-shrink: 0` | Gap between rows: 2px (`TRACK_GAP`). Top gap: 2px (`TOP_GAP`). |
| — | Clip header (inside track) | `ClipHeader` | 20px (`CLIP_HEADER_HEIGHT`) | clip width | — | Drawn on canvas by `TrackNew`, you don't position it directly |
| — | Side panel (Mixer/Effects) | `SidePanel` | matches body | resizable | `flex-shrink: 0` | Optional right rail; use `ResizablePanel` if user-resizable needed |

**Other interior constants:**

- `CLIP_CONTENT_OFFSET = 12px` — clip `x` positions start here, leaving room for the timeline ruler nubbin on the left edge.
- Toolbar button height: `24px`.
- `MasterMeter` self-sizes — does not need explicit width.
- `TimeCode` self-sizes — display-only, embeds inline.

**The outer composition pattern that works:**

```tsx
<div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw' }}>
  <ApplicationHeader … />                        {/* 56px, flex-shrink: 0 */}
  <ProjectToolbar … />                           {/* 40px, flex-shrink: 0 */}
  <TransportRow … />                             {/* auto, flex-shrink: 0 */}

  <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>      {/* editor body — grows */}
    <div style={{                                                 {/* main column — left of side panel */}
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0,
    }}>
      <TimelineRuler … />                        {/* 40px, flex-shrink: 0 */}
      <div style={{ flex: 1, overflow: 'auto' }}>{/* scrollable tracks region */}
        {tracks.map(track => (
          <div style={{ display: 'flex', height: track.height ?? 114, marginBottom: 2 }}>
            <TrackControlPanel … />              {/* 268px, flex-shrink: 0 */}
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              <TrackNew … />                     {/* flex: 1 — the canvas */}
              <PlayheadCursor … />               {/* absolute-positioned inside */}
            </div>
            <VerticalRuler … />                  {/* ~32px, flex-shrink: 0 */}
          </div>
        ))}
      </div>
    </div>

    <SidePanel … />                              {/* optional right rail */}
  </div>

  <SelectionToolbar … />                         {/* 40px, flex-shrink: 0 */}
</div>
```

**Common mistakes with this layout:**

1. Forgetting `min-height: 0` on the editor body wrapper — children with `overflow: auto` break and the page grows past 100vh.
2. Putting `TrackControlPanel` in a `flex: 1` column — it gets stretched/shrunk and the internal layout breaks. Use `flex-shrink: 0`.
3. Setting `flex: 1` on the transport row or status bar — they should be `flex-shrink: 0` (fixed height) so the editor body absorbs all the remaining space.
4. Putting `overflow: hidden` on a parent of `TrackControlPanel`'s tooltip-bearing children — kills tooltips. Use `overflow: visible` on the row wrapper.

### 4a. Transport row recipe

The transport row is **not** a single shipped component. Compose it from `Toolbar` + groups. Reference structure (left → right):

```tsx
<Toolbar>
  <ToolbarButtonGroup gap={2}>
    <TransportButton icon="play" onClick={onPlay} active={isPlaying} />
    <TransportButton icon="stop" onClick={onStop} />
    <TransportButton icon="record" onClick={onRecord} active={isRecording} variant="record" />
    <TransportButton icon="skip-back" onClick={onSkipBack} />
    <TransportButton icon="skip-forward" onClick={onSkipForward} />
    <ToggleToolButton icon="loop" pressed={loopEnabled} onClick={toggleLoop} />
  </ToolbarButtonGroup>

  <ToolbarDivider />

  <ToggleToolButton icon="envelope" pressed={envelopeMode} onClick={toggleEnvelope} />

  <ToolbarDivider />

  <ToolbarButtonGroup gap={2}>
    <ToolButton icon="zoom-in" onClick={onZoomIn} />
    <ToolButton icon="zoom-out" onClick={onZoomOut} />
    <ToolButton icon="zoom-to-fit" onClick={onZoomToFit} />
  </ToolbarButtonGroup>

  <ToolbarDivider />

  <ToolbarButtonGroup gap={2}>
    <ToolButton icon="cut" onClick={onCut} />
    <ToolButton icon="copy" onClick={onCopy} />
    <ToolButton icon="paste" onClick={onPaste} />
  </ToolbarButtonGroup>

  <ToolbarDivider />

  <ToolbarButtonGroup gap={2}>
    <ToolButton icon="trim" onClick={onTrim} />
    <ToolButton icon="silence" onClick={onSilence} />
  </ToolbarButtonGroup>

  <ToolbarDivider />

  {/* Centered time-code display */}
  <TimeCode value={currentTime} format={timeCodeFormat} onChange={onTimeCodeChange} />

  <ToolbarDivider />

  {/* Snap + Bar dropdowns */}
  <Dropdown label="Snap" value={snapMode} options={snapOptions} onChange={setSnapMode} />
  <Dropdown value={snapSubdivision} options={subdivisionOptions} onChange={setSnapSubdivision} />

  <ToolbarDivider />

  {/* Record / playback level meter on the right */}
  <Icon name="mic" />
  <Icon name="speaker" />
  <MasterMeter
    levelLeft={masterLevelLeft}
    levelRight={masterLevelRight}
    clippedLeft={masterClippedLeft}
    clippedRight={masterClippedRight}
  />
</Toolbar>
```

For a complete working version, read `apps/sandbox/src/components/TransportToolbar.tsx` — it covers split record button, snap modes, all the dropdowns, and the master volume. **Do not skip the `MasterMeter` and the `TimeCode` — they're the visual anchors of the transport row.**

### 4b. Editor body recipe — track row anatomy

Each track row is three columns:

```
┌────────────────────┬─────────────────────────────────────┬────────┐
│ TrackControlPanel  │  TrackNew canvas (clips + envelope) │ Vert.  │
│  • mic icon        │  • clip headers (20px tall)         │ Ruler  │
│  • track name      │  • waveforms / spectrogram           │  +1.0  │
│  • "..." menu      │  • envelope curve & points          │   0.0  │
│  • pan knob        │  • playhead overlay                 │  -1.0  │
│  • volume slider   │                                     │        │
│  • [M] [S] buttons │                                     │        │
│  • "Effects" btn   │                                     │        │
│ (width: 268px)     │  (flex: 1, scrolls H with timeline) │ (32px) │
└────────────────────┴─────────────────────────────────────┴────────┘
```

```tsx
{tracks.map((track, i) => (
  <div key={track.id} style={{ display: 'flex', height: track.height ?? 114, marginBottom: 2 }}>
    <TrackControlPanel
      track={track}
      isSelected={selectedTrackId === track.id}
      onMuteToggle={() => toggleMute(track.id)}
      onSoloToggle={() => toggleSolo(track.id)}
      onVolumeChange={(v) => setVolume(track.id, v)}
      onPanChange={(p) => setPan(track.id, p)}
      onOpenEffects={() => openEffectsFor(track.id)}
      onContextMenu={(e) => openTrackContextMenu(e, track.id)}
    />
    <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
      <TrackNew
        clips={track.clips}
        trackIndex={i}
        width={canvasWidth}
        height={track.height ?? 114}
        pixelsPerSecond={pps}
        envelopeMode={envelopeMode}
        spectrogramMode={spectrogramMode}
        onClipClick={handleClipClick}
        onClipHeaderClick={handleClipHeaderClick}
      />
    </div>
    <VerticalRuler height={track.height ?? 114} mode="amplitude" />
  </div>
))}
```

**Common omission:** the `VerticalRuler` on the right edge. The reference shows `1.0 / 0.0 / -1.0` per track — that's `VerticalRuler` in `'amplitude'` mode. For spectrogram tracks, switch to `mode="frequency"`. For split view (waveform + spectrogram), use `VerticalRulerPanel` which renders both.

### 4c. Status bar — use `SelectionToolbar`

The bottom status strip (Stopped / hint text / Selection start+end + Duration) **is a shipped component** — `SelectionToolbar`. Don't reinvent it.

```tsx
<SelectionToolbar
  status={isPlaying ? 'Playing' : isRecording ? 'Recording' : 'Stopped'}
  instructionText="Click and drag to select audio"
  selectionStart={timeSelection?.startTime ?? null}
  selectionEnd={timeSelection?.endTime ?? null}
  timeCodeFormat={timeCodeFormat}
  onTimeCodeFormatChange={setTimeCodeFormat}
/>
```

Height: 40px. `flex-shrink: 0`. Put it as the last child of the editor body's parent flex column.

### 4e. TimelineRuler — viewport sizing

The `TimelineRuler` accepts two width-related props:

| Prop | What it means | When to use |
|---|---|---|
| `viewportWidth` | Visible CSS width of the ruler (e.g., editor body width minus the side rails) | **Use this.** Canvas backing store sizes to this, stays sharp at any project length or zoom on HiDPI. |
| `width` | Legacy / project-extent. Sets canvas width to this CSS px value. | Avoid for new code. Beyond ~16,000px on HiDPI the canvas hits browser size limits and renders blurry. |

The drawing code already operates in viewport coordinates (using `scrollX` to determine which time range to draw). With `viewportWidth` set, the canvas never grows past viewport size — no resolution loss.

```tsx
<TimelineRuler
  viewportWidth={editorBodyWidth}   // measure the parent (ResizeObserver) or pass a known value
  height={40}
  pixelsPerSecond={pps}
  scrollX={scrollX}                  // updated as the user scrolls horizontally
  totalDuration={timelineDuration}
  timeFormat={timelineFormat}
  /* … */
/>
```

**Layout placement**: the ruler must live *outside* the horizontally-scrolling region so it stays in view as the user scrolls right. The standard pattern is a fixed-height row above the scroll container; the scroll container's `onScroll` updates `scrollX` and the ruler redraws.

---

### 4d. ApplicationHeader menu definitions

The OS-style menu bar (File / Edit / View / Tracks / …) is driven by `menuDefinitions`. Skeleton:

```tsx
const menuDefinitions: MenuDefinition[] = [
  {
    label: 'File',
    items: [
      { label: 'New', shortcut: 'Cmd+N', onClick: onNew },
      { label: 'Open…', shortcut: 'Cmd+O', onClick: onOpen },
      { type: 'separator' },
      { label: 'Save', shortcut: 'Cmd+S', onClick: onSave },
      { label: 'Save As…', shortcut: 'Shift+Cmd+S', onClick: onSaveAs },
      { type: 'separator' },
      { label: 'Export', items: [
        { label: 'Export as WAV…', onClick: () => onExport('wav') },
        { label: 'Export as MP3…', onClick: () => onExport('mp3') },
      ]},
    ],
  },
  { label: 'Edit', items: [/* … */] },
  { label: 'Select', items: [/* … */] },
  { label: 'View', items: [/* … */] },
  { label: 'Record', items: [/* … */] },
  { label: 'Tracks', items: [/* … */] },
  { label: 'Generate', items: [/* … */] },
  { label: 'Effect', items: [/* … */] },
  { label: 'Analyze', items: [/* … */] },
  { label: 'Tools', items: [/* … */] },
  { label: 'Extra', items: [/* … */] },
  { label: 'Help', items: [/* … */] },
];
```

If you skip this and only render the Home/Project/Export tab row, the app looks half-built. Working factory: `apps/sandbox/src/data/menuDefinitions.ts`.

**Pillar responsibilities (summary):**

1. `ApplicationHeader` — OS-style title row + menu bar (File/Edit/…)
2. `ProjectToolbar` — tabs (Home/Project/Export/Debug) + right-side workspace + undo/redo via `rightContent`
3. Transport row — `Toolbar` composition with transport buttons, zoom, edit, time code, snap dropdowns, master meter
4. Editor body — track rows (control panel + canvas + vertical ruler) + timeline + playhead overlay
5. Status bar — playback state | hint text | selection/duration time codes
6. `ToastContainer` — mount once

---

## 5. Core data shapes

These are the types the audio surfaces consume. The consumer owns state; the components are rendering-only.

```ts
interface Track {
  id: number;
  name: string;
  clips: Clip[];
  height?: number;
  channelSplitRatio?: number; // 0..1, stereo top-channel ratio
}

interface Clip {
  id: number;
  name: string;
  startTime: number;       // seconds
  duration: number;        // seconds
  waveform: number[];      // sample amplitudes, -1..1
  envelopePoints: EnvelopePoint[];
  selected?: boolean;
  deletedRegions?: DeletedRegion[];
}

interface EnvelopePoint {
  time: number; // seconds, relative to clip start
  db: number;   // -Infinity..+12
}

interface Label {
  id: string;
  trackIndex: number;
  text: string;
  startTime: number;
  endTime: number;
  lowFrequency?: number;   // present = spectral label
  highFrequency?: number;
  selected?: boolean;
}

interface TimeSelection {
  startTime: number;
  endTime: number;
  trackIndex?: number; // omit for "all tracks"
}

interface SpectralSelection {
  startTime: number;
  endTime: number;
  minFrequency: number; // 0..1, normalized
  maxFrequency: number;
  trackIndex: number;
  clipId?: number;
}
```

Import the full set from `@dilsonspickles/components` (or the underlying `@audacity-ui/core` if you need the raw types only).

**State management is unopinionated.** The sandbox happens to use React Context + `useReducer` (`TracksProvider`, `TracksContext`) — fine to copy. But the components don't require it; pass arrays/objects however you manage them. Required pattern: tracks live in *one* source of truth that gets mutated through actions (add clip, move clip, edit envelope, etc.), then re-rendered. Don't sprinkle state across components.

---

## 6. Building each main surface

### 6a. Home tab (project picker)

```tsx
import { HomeTab } from '@dilsonspickles/components';

<HomeTab
  projects={projects}                    // your project list
  onNewProject={handleNewProject}
  onOpenProject={(id) => loadProject(id)}
  onDeleteProject={handleDelete}
/>
```

`HomeTab` has built-in sections for new/recent projects and an Audio.com account card. Authoritative prop list is in `dist/index.d.ts`.

### 6b. Editor view — tracks + transport

See **section 4** for the full layout including dimensions, flex behaviour, transport row, status bar, and track-row anatomy. That's the canonical reference.

**`Track` vs `TrackNew`** — `TrackNew` is the modern component-based renderer (clips are React components, envelope edits use a transparent overlay). `Track` is the older canvas-only path. Use `TrackNew` for new work.

**Overlays inside the canvas column** — `PlayheadCursor` and `TimeSelectionCanvasOverlay` are `position: absolute` siblings of the `TrackNew` canvases, parented by the `position: relative` canvas-column wrapper from section 4. Pass them the same `pixelsPerSecond` as the canvases, and a `height` matching the sum of track heights + gaps.

### 6c. Effects panel (right side rail)

```tsx
<SidePanel side="right" defaultWidth={320}>
  <EffectsPanel
    track={selectedTrack}
    effects={track.effects}
    onAddEffect={openPickerMenu}
    onRemoveEffect={removeEffect}
  />
</SidePanel>
```

`EffectsPanel` is purely rendering — open the actual VST UI through `EffectDialog`. Plug-in browsing goes through `PluginBrowserDialog`.

### 6d. Preferences modal

```tsx
<PreferencesModal
  isOpen={isPrefsOpen}
  onClose={() => setIsPrefsOpen(false)}
  activePage={activePage}
  onPageChange={setActivePage}
/>
```

Built-in pages: general, appearance, audio, recording, midi, keyboard. The authoritative prop list is in `dist/index.d.ts`.

### 6e. Dialogs + context menus

Treat these as portaled overlays that don't affect layout. The sandbox uses a `<DialogProvider>` + `<ContextMenuProvider>` pattern with hooks (`useDialogs()`, `useContextMenus()`) to centralize open/close state. Copy that pattern — having dialog state in a context makes it trivial to open dialogs from menu items, keyboard shortcuts, or context menus without prop-drilling.

```tsx
<AppDialogs />          {/* mounts: PreferencesModal, ExportModal, SaveProjectModal, … */}
<AppContextMenus />     {/* mounts: ClipContextMenu, TrackContextMenu, … */}
```

`AppDialogs` and `AppContextMenus` are not exported by the package — they're consumer code. Build them as thin wrappers that subscribe to your dialog/menu state and render the matching component. See `apps/sandbox/src/components/AppDialogs.tsx` and `AppContextMenus.tsx` for the pattern.

---

## 7. Extending

A few built-in surfaces accept render-slot props so consumers can inject UI without forking the component (e.g. `Dialog` accepts `headerContent`). Check `dist/index.d.ts` for each component's prop surface before forking. If a slot you need does not exist, raise it upstream rather than wrapping the component.

---

## 8. State patterns worth copying from the sandbox

These are not exported, but they are well-tested patterns. Read the sandbox files and copy them:

- **`apps/sandbox/src/contexts/TracksContext.tsx`** — track state with a typed reducer. Actions include `ADD_CLIP`, `MOVE_CLIP`, `TRIM_CLIP_LEFT`, `EDIT_ENVELOPE`, etc. The reducer pattern keeps mutations debuggable.
- **`apps/sandbox/src/hooks/useClipDragging.ts`** — multi-select clip drag with snapping. Composes with `TrackNew`.
- **`apps/sandbox/src/hooks/useClipTrimming.ts`** — edge-handle trim with snap-to-grid.
- **`apps/sandbox/src/hooks/useLabelDragging.ts`** — label drag with overlap detection.
- **`apps/sandbox/src/hooks/useKeyboardShortcuts.ts`** — central keymap, dispatches to handler modules under `hooks/handlers/`.
- **`apps/sandbox/src/hooks/useZoomControls.ts`** — pixels-per-second zoom with anchored zooming.

When implementing one of these capabilities, start by reading the sandbox file. Adapt — do not reinvent — unless you have a concrete reason.

---

## 9. Accessibility notes

- The accessibility profile system supports two modes: `'au4-tab-groups'` (composite-widget roving tabindex — Tab moves *between* groups, arrow keys move *within*) and `'au3-sequential'` (Tab moves linearly through every focusable). Choose via `<AccessibilityProfileProvider initialProfileId="…">`.
- Components that participate in tab groups use the `useContainerTabGroup` hook internally. If you build a custom focusable region that should join the same scheme, use `useContainerTabGroup` or `useTabGroup` from `@dilsonspickles/components`.
- Focus outlines render via CSS `:focus-visible` against `theme.border.focus`. Make sure your custom theme defines that token.

---

## 10. Build / bundler notes

- The package is dual-published (CJS + ESM). Vite, webpack 5, Next.js, and Astro should pick up the ESM build automatically.
- CSS is a separate file (`dist/index.css`). Import once at app entry.
- Workspace siblings (`@audacity-ui/core`, `@audacity-ui/tokens`) are bundled into `dist` and not declared as runtime dependencies — consumers do not need to install them. Types from `@audacity-ui/core` are re-exported via this package.
- React 18 and React 19 both work as peer deps. The smoke tests in CI cover React 18.

---

## 10a. Common pitfalls — what agents get wrong first try

Real failure modes from observed consumer builds. Audit your output against this list before declaring done.

- **No `ApplicationHeader` menu bar.** You rendered Home/Project/Export tabs but no File/Edit/View row above. The app looks half-built. → wire `menuDefinitions` (section 4d).
- **TrackControlPanel too narrow.** Pan knob, volume slider, and M/S buttons end up squished. → the component sets its own width (268px) — use it; don't put it in a constrained flex parent that shrinks it.
- **No `VerticalRuler` on tracks.** The amplitude scale `1.0 / 0.0 / -1.0` on the right edge of each track is required visual context for a DAW. → render `<VerticalRuler>` as the third column of each track row (section 4b).
- **No status bar.** The bottom strip with "Stopped" / hint / Selection+Duration is a primary affordance for time-selection feedback. → compose it (section 4c).
- **No master meter in transport row.** The mic + speaker icons next to a `-60..0` dB meter belong in the transport row, not a side panel. → use `MasterMeter`.
- **No `TimeCode` in transport row.** Centered `00d00h00m01s` display is the playhead readout — not optional.
- **No undo/redo buttons.** Put them in `ProjectToolbar`'s right slot.
- **Tabs render as plain text.** `ProjectToolbar` ships proper tab visuals with active-state underline. Don't reinvent.
- **`+` instead of `+ Add new`.** The "add track" affordance is a labeled pill button, not a bare icon.
- **Transport buttons are different sizes / inconsistent gaps.** Use `ToolbarButtonGroup` with a single `gap` value to keep groups consistent. Use `ToolbarDivider` between groups.
- **No track selection state.** Selected track should show a colored outline around both the control panel and the canvas area. Pass `isSelected` to `TrackControlPanel` and reflect it in your canvas wrapper.

---

## 11. When something breaks

1. **"Invalid hook call" / null `useContext`** — two copies of React in resolution. Common in monorepos. Check `node_modules/react` is singular; check the dev server isn't symlinking the package against a different React than your app uses.
2. **Components render without styles** — `import '@dilsonspickles/components/style.css'` missing or imported after another stylesheet that resets it.
3. **Icons render as boxes** — the MusescoreIcon font is in `dist/`; check your bundler isn't stripping `.ttf` files from the publish or the CSS `url()` reference.
4. **Tab navigation feels wrong** — wrong `AccessibilityProfileProvider initialProfileId`. Try `'au4-tab-groups'` (roving) or `'au3-sequential'` (flat).
5. **Canvas blurry on Retina** — should not happen as of 0.2.1. If it does, the component bypassed `devicePixelRatio` scaling — file a bug.

---

## 12. Where to look next

- **Working app**: `apps/sandbox/` in the source repo. Run it (`pnpm dev` from `apps/sandbox`) to see every surface composed together.
- **Storybook**: `apps/docs/` — per-component examples in isolation. Run with `pnpm storybook`.
- **Type definitions**: `dist/index.d.ts` ships in the published package — your editor's go-to-definition is authoritative on prop shapes.
