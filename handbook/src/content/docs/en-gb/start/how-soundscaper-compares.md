---
title: "How Soundscaper compares"
description: "Compare Soundscaper Web and Desktop with Audacity 4 and Adobe Audition for recording, editing, mixing, delivery, and interchange."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"gpt-5.6-luna"},"factPacketSha256":"40b04dc035c478e31f5993fb39598506f3eb95c39c7e3a1ec2696a05cef304b5","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"40b04dc035c478e31f5993fb39598506f3eb95c39c7e3a1ec2696a05cef304b5","targetLocale":"en-GB"} -->

Soundscaper re-implements Audacity 4 on the web and adds a production layer on
top of it. Adobe Audition is the commercial post-production tool both are
usually measured against. This page compares Soundscaper Web, Soundscaper
Desktop, Audacity 4, and Audition so you can tell which edition already does
the job you have.

## How to read this page

Each cell starts with a color-coded symbol, followed by the detail that
qualifies it:

- <span class="verdict verdict--yes" role="img" aria-label="Supported">+</span> — supported or applies
- <span class="verdict verdict--partial" role="img" aria-label="Limited">~</span> — limited scope, platform-dependent, or reachable through a workaround
- <span class="verdict verdict--no" role="img" aria-label="Unavailable">/</span> — unavailable or not applicable

Read the notes alongside the symbols. An optional plug-in, model, or codec
installation does not by itself make a supported desktop capability limited;
the note names what you need to install. Web and Desktop have separate columns
so a browser restriction does not reduce the desktop rating.

Rows describe capabilities, not menu commands. For the exact command inventory
see [Commands and shortcuts](/reference/generated/commands/), and for what each
product enables see
[Product capabilities](/reference/generated/product-capabilities/).

### Where these claims come from

- **Soundscaper** rows come from this repository: its product capability profiles, runtime action manifest, export-format registry, and browser and desktop codec-support checks.
  Native desktop payloads are built by repository CI or by the target’s packaging. A package enables a feature only after the exact matching output is prepared and verified; these rows say when a payload is still required.
- **Audacity 4** rows start from the upstream inventory pinned in this repository, `4.0.0` at commit `4c177d43`, and include user-visible changes through the official [`4.0.1` release](https://github.com/audacity/audacity/blob/Audacity-4.0.1/CHANGELOG.txt), at commit `d82386ce`. A feature recorded upstream but left disabled or excluded from the menu with a comment is identified that way. If it appears in neither the verified inventory nor the release notes, it is marked as absent from that material, not permanently absent. Sample drawing, clip-gain envelopes, and legacy project import are also documented in the [official 4.0 changelog](https://www.audacityteam.org/changelog/) and [clip-gain manual](https://www.audacityteam.org/manual/clips/clip-gain/).
- **Audition** rows come from Adobe's published documentation for the current
  release. They are not verified against a running build.

## Platform and terms

| Capability | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Licence | + — AGPL-3.0-only | + — AGPL-3.0-only | + — GPL, open source | / — proprietary and closed |
| Cost | + — free | + — free | + — free | / — Creative Cloud subscription |
| Runs in a browser | + — Chromium, Firefox, and WebKit | / — packaged application | / — desktop only | / — desktop only |
| Desktop builds | / — use the browser edition | + — Windows and Linux on x64 and ARM64, macOS on ARM64 | + — Windows (installer or portable), macOS, Linux | ~ — Windows and macOS, no Linux |
| Works with no account | + — no account exists | + — no account exists | + — sign-in only for audio.com | / — signed-in subscription required |
| Cloud project storage | / — excluded by the local-first design | / — excluded by the local-first design | + — save and share through audio.com | ~ — Creative Cloud files, sessions do not sync |
| System requirements | + — runs wherever a current browser runs | + — Windows, Linux, or macOS on the supported desktop architectures | ~ — raised materially over Audacity 3 | ~ — professional workstation class |

## Project and session model

| Capability | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Native project format | + — `.sscape`, a lossless portable archive | + — `.sscape`, a lossless portable archive | + — `.aup4` | + — `.sesx` |
| Opens Audacity projects | + — AUP, AUP3, and AUP4 import; AUP3 and AUP4 export | + — AUP, AUP3, and AUP4 import; AUP3 and AUP4 export | + — AUP, AUP3, and AUP4 import; AUP4 export, no AUP3 export | / |
| Non-destructive clip timeline | + | + | + | + — multitrack editor |
| Dedicated single-file editor | + — source waveform editor in Clip properties | + — source waveform editor in Clip properties | ~ — edits apply in place in the timeline | + — waveform editor |
| Mono and stereo content on one track | + — a track holds either | + — a track holds either | / — a track is mono or stereo | / — channel format is fixed per track |
| Nested track folders | + — any depth, undoable, with routing | + — any depth, undoable, with routing | / | ~ — submix buses only, no folder tracks |
| Project bin | + — organises files and doubles as a clipboard | + — organises files and doubles as a clipboard | / | ~ — the Files panel lists open files |
| Autosave and crash recovery | + — autosave, locks, and recovery envelopes | + — autosave, locks, and recovery envelopes | + | + |
| Markers and named regions | + — first class, with navigation and ripple behaviour | + — first class, with navigation and ripple behaviour | ~ — label tracks | + — markers and ranges |
| Tempo and time-signature maps | + — ordered maps resolved sample-accurately | + — ordered maps resolved sample-accurately | ~ — one project tempo and signature | ~ — one session tempo |

## Recording

| Capability | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Multitrack recording | + — several sources at once | + — several sources at once | ~ — one input device at a time | + — multi-input and multichannel interfaces |
| Microphone and desktop audio together | ~ — built in where the browser and operating system expose display audio | + — microphone plus Windows desktop loopback; other systems use a loopback input | / | ~ — needs an operating-system loopback device |
| Timed recording | + | + | + | / |
| Sound-activated recording | + — with a settable threshold | + — with a settable threshold | + — with a settable threshold | / |
| Count-in before the take | + — tempo-map aware, handles compound metre | + — tempo-map aware, handles compound metre | ~ — lead-in recording | ~ — pre-roll as part of punch and roll |
| Punch recording | + — one transaction, default and routed capture | + — one transaction, default and routed capture | / | + — punch and roll |
| Loop recording into takes | + — one lane per pass, appended to the same group | + — one lane per pass, appended to the same group | / | ~ — takes on one clip, chosen from a list |
| Take comping | + — audition, promote, edit comp regions, flatten as one undoable edit | + — audition, promote, edit comp regions, flatten as one undoable edit | / | / — no comp editor |
| Input monitoring and metering | + | + | + | + |

## Timeline editing

| Capability | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Ripple edit variants | + — per clip, per track, and all tracks, on cut and delete | + — per clip, per track, and all tracks, on cut and delete | + — the same three, on cut and delete | ~ — ripple delete on a selection or gap |
| Split, join, and split at silences | + | + | + | ~ — split and trim, no clip join |
| Clip groups | + | + | + | + |
| Clip gain | + | + | + | + |
| Per-clip pitch and speed | + — adjust, render, or reset | + — adjust, render, or reset | + — adjust, render, or reset | ~ — stretch stays editable, pitch is an effect |
| Follow tempo changes | + — clips stretch when the map moves | + — clips stretch when the map moves | + | / |
| Beat-aware quantisation and groove | + — warp maps with adjustable groove strength | + — warp maps with adjustable groove strength | / | / |
| Snap to zero crossings | + | + | + | + |
| Sample-level drawing | + | + | + — available when zoomed to individual samples | + — in the waveform editor |
| Keyboard-only editing | + — every edit primitive has a navigation action | + — every edit primitive has a navigation action | + — edit actions, the timeline, and track vertical rulers are keyboard-navigable | ~ — extensive shortcuts, some panels need the mouse |

## Spectral work and restoration

| Capability | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Spectrogram view | + — with per-track settings | + — with per-track settings | + — with per-track settings | + — frequency and pitch displays |
| Frequency-bounded selection | + | + | + | + — marquee and lasso |
| Spectral brush | + | + | + | + — paintbrush and spot healing |
| Delete or amplify a spectral region | + — both as direct actions | + — both as direct actions | + — both as direct actions | ~ — apply an effect to the selection |
| Repair short damage | + — Repair | + — Repair | + — Repair | + — Auto Heal and Spot Healing Brush |
| Broadband noise reduction | + — with a captured profile | + — with a captured profile | + — with a captured profile | + — Noise Reduction, Adaptive Noise Reduction, DeNoise |
| De-reverb | / — desktop assistance only | + — Reduce Reverb, with optional model and engine installed | / | + — DeReverb |
| Click, hum, and sibilance tools | ~ — Click Removal and De-esser; no dedicated hum remover | ~ — Click Removal and De-esser; no dedicated hum remover | ~ — Click Removal only | + — DeClicker, DeHummer, DeEsser, Click/Pop Eliminator |
| Diagnostics panel | ~ — Find Clipping as an analyser | ~ — Find Clipping as an analyser | ~ — Find Clipping as an analyser | + — diagnostics with per-issue repair |

## Effects and plug-ins

| Capability | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Built-in effect suite | + — Audacity-derived effects, bundled Nyquist plug-ins, and first-party effects such as Bitcrusher and De-esser | + — Audacity-derived effects, bundled Nyquist plug-ins, and first-party effects such as Bitcrusher and De-esser | + — 30 built-in effects in the pinned build | + — around fifty, including multiband dynamics |
| Real-time effect rack per track | + — a wider real-time set than upstream | + — a wider real-time set than upstream | + | + — sixteen slots per clip, track, and master |
| Parametric EQ | + — a new parametric EQ with automatable bands | + — a new parametric EQ with automatable bands | ~ — Filter Curve and Graphic EQ | + — parametric, graphic, and FFT filters |
| Effect presets | + — apply, save, import, export | + — apply, save, import, export | + — apply, save, import, export | + |
| Macros and batch chains | + — saved macro library with templates | + — saved macro library with templates | / — the pinned build comments the Macros menu out | + — Favourites and Batch Process |
| Third-party plug-in formats | / — native plug-ins require Desktop | + — VST3, CLAP, AU, LV2, Linux LADSPA, and Vamp; platform-specific, with consent and containment | + — VST3, AU, LV2, and Nyquist, with a plug-in manager | ~ — VST3, and AU on macOS, no CLAP or LV2 |
| Nyquist scripting | + — bundled plug-ins and the Nyquist prompt | + — bundled plug-ins and the Nyquist prompt | + — bundled plug-ins and the Nyquist prompt | / |
| Sandboxed effect packages | ~ — reviewed WebAssembly packages, one ships and external ones are fenced | ~ — reviewed WebAssembly packages, one ships and external ones are fenced | / | / |
| Virtual instruments | / | / | / | / |

## Mixing, routing, and automation

| Capability | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Mixer with channel strips | + | + | ~ — track controls and a master track | + |
| Buses and submixes | + — nested, with cycle validation | + — nested, with cycle validation | / | + — bus tracks |
| Sends | + — pre and post fader, multiple assignments | + — pre and post fader, multiple assignments | / | + — pre and post fader |
| VCA groups | + | + | / | / |
| Sidechain input | + | + | / | + — through sends |
| Cue and control-room mixes | + | + | / | / |
| Plug-in delay compensation | + — playback, monitoring, buses, sidechains, render, and freeze | + — playback, monitoring, buses, sidechains, render, and freeze | ~ — not exposed in the pinned sources | + |
| Automation lanes | + — gain, pan, mute, sends, buses, and plug-in parameters | + — gain, pan, mute, sends, buses, and plug-in parameters | ~ — clip-gain envelopes; no track or effect lanes | + — volume, pan, and effect parameters |
| Automation modes | + — read, trim, touch, latch, and write | + — read, trim, touch, latch, and write | / | ~ — read, write, latch, and touch, no trim |
| Curve shapes | + — line, hold, and curve | + — line, hold, and curve | ~ — clip-gain envelopes only | + — linear and spline |
| Track freeze | + — freeze, unfreeze, and commit without losing state | + — freeze, unfreeze, and commit without losing state | / | ~ — bounce to a new track |

## Metering and analysis

| Capability | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Loudness meter | + — EBU R 128-style, with history | + — EBU R 128-style, with history | / — a Loudness Normalisation effect but no meter | + — Loudness Radar to ITU-R BS.1770 |
| Phase and correlation meter | + | + | / | + — phase meter and analysis |
| Surround metering | + | + | / | ~ — up to 5.1 |
| Spectrum plot | + — Plot Spectrum | + — Plot Spectrum | ~ — registered, but the pinned build comments it out of the Analyze menu | + — Frequency Analysis |
| Clipping and RMS in the waveform | + — project toggles with per-track RMS overrides | + — project toggles with per-track RMS overrides | + — both, toggled per project | ~ — clip indicators, RMS in Amplitude Statistics |
| Speech-intelligibility contrast | + — Contrast analyser | + — Contrast analyser | ~ — registered, but the pinned build comments it out of the Analyze menu | / |

In Soundscaper, open a track's **Track visualization** menu to toggle **Half-wave** or
**Show RMS in waveform**. The default view, 3-band crossover frequencies, and
spectrogram settings are in **Edit → Preferences → Track display**.

## Channels and immersive audio

| Capability | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Channels per file | + — up to 32 for PCM formats | + — up to 32 for PCM formats | ~ — mono and stereo tracks | + — up to 32 in the waveform editor |
| Surround mixing | + — beds up to 7.1.4 | + — beds up to 7.1.4 | / | ~ — up to 5.1 |
| Object-based audio | + — objects alongside beds | + — objects alongside beds | / | / |
| ADM authoring and passthrough | + — BW64/ADM with conformance checks | + — BW64/ADM with conformance checks | / | / |
| Binaural render | + — a named binaural model | + — a named binaural model | / | ~ — binauraliser for ambisonics |
| Ambisonics | / | / | / | + — first order, with a VR panner |

## Export and delivery

| Capability | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Lossless output | + — native WAV, AIFF, BWF, and BW64; FLAC and WavPack through dedicated codecs | + — native WAV, AIFF, BWF, and BW64; FLAC and WavPack through dedicated codecs | + — WAV, AIFF, and FLAC | + — WAV, AIFF, FLAC, and more |
| Lossy output | ~ — MP3, MP2, Opus, and Ogg Vorbis; AAC depends on the browser | + — MP3, MP2, Opus, Ogg Vorbis, and AAC through supported codec providers, including configured FFmpeg | + — MP3, Opus, and Ogg Vorbis; additional formats through optional FFmpeg | ~ — MP2, MP3, and Ogg Vorbis; more through Adobe Media Encoder, no general FFmpeg target |
| Custom encoder settings | ~ — per-format controls; custom FFmpeg arguments are unavailable | ~ — per-format controls; custom FFmpeg arguments are unavailable | + — a custom FFmpeg target | + — per-format options |
| Export queue | + — pause, cancel, retry, and reorder | + — pause, cancel, retry, and reorder | / — Export Multiple is one sequential operation, not a job queue | ~ — Batch Process without queue control |
| Stems and alternates in one pass | + — queued together with the mix | + — queued together with the mix | ~ — Export Multiple writes each track separately, but does not queue the mix and alternate renders together | ~ — one mixdown per stem |
| Region-by-region delivery | + — mastering sequences with per-region metadata, gaps, and fades | + — mastering sequences with per-region metadata, gaps, and fades | + — Export Multiple writes each labelled region to its own file | + — export markers to separate files |
| Loudness normalisation on export | + — part of the delivery plan | + — part of the delivery plan | ~ — run the effect first | + — Match Loudness |
| Dither and channel mapping | + — explicit controls | + — explicit controls | ~ — dither in preferences | + — explicit controls |
| Delivery report | + — itemised per job | + — itemised per job | / | / |
| Render queue survives a restart | / — persistent render recovery requires Desktop | + — restarts from byte zero with a crash journal | / | / |

Soundscaper Desktop can use configured FFmpeg for its supported export formats;
the current editor does not expose arbitrary FFmpeg arguments or every FFmpeg
encoder. See [Export formats](/reference/generated/formats/) for the registered
targets. Audacity's [export workflow](https://www.audacityteam.org/manual/getting-started/export-your-audio/)
adds formats through an optional FFmpeg installation. Audition offers a fixed
set of file writers and an [Adobe Media Encoder handoff](https://helpx.adobe.com/uk/audition/desktop/saving-and-exporting/saving-exporting-files1.html).

## Interchange with other tools

| Capability | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Audacity projects | + — AUP, AUP3, and AUP4 in; AUP3 and AUP4 out with a compatibility report | + — AUP, AUP3, and AUP4 in; AUP3 and AUP4 out with a compatibility report | + — AUP, AUP3, and AUP4 import; AUP4 export, no AUP3 export | / |
| Audition sessions | / — SESX import requires Desktop | ~ — `.sesx` audio import with an omission report; no export | / — no SESX import in the pinned build | + — native |
| EDL | ~ — CMX3600-class export, no import | ~ — CMX3600-class export, no import | / | / |
| OpenTimelineIO | ~ — export only | ~ — export only | / | / |
| FCPXML | ~ — export only | ~ — export only | / | + — import and export |
| DAWproject | + — import and export, with an exchange report | + — import and export, with an exchange report | / | / |
| OMF | / | / | / | ~ — import and export |
| Round-trip with a video editor | ~ — hands the same project to Framescaper without copying media | ~ — hands the same project to Framescaper without copying media | / | + — Dynamic Link with Premiere Pro |
| Labels and markers exchange | + — import and export | + — import and export | + — import and export | + — marker lists |

For Audition `.sesx` import, see [Project files](/projects-and-data/project-files/)
for which audio settings transfer and what the report marks as omitted.

## Video

| Capability | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Import video for reference | + — on the timeline, with linked audio | + — on the timeline, with linked audio | / | ~ — one video track, preview only |
| Video timeline editing | ~ — basic editing, the full surface is Framescaper | ~ — basic editing, the full surface is Framescaper | / | / |
| Video export | ~ — MP4 and WebM where browser WebCodecs support the required codecs | + — MP4 and WebM with a verified desktop codec provider | / | / — audio only |
| Compositing, grading, and effects | ~ — in Framescaper, on the same project | ~ — in Framescaper, on the same project | / | / |

## Machine assistance

Desktop assistance is supported after installing optional model weights and a
matching native engine; these workflows are unavailable in Web.
Model Manager installs both; see [Local assistance](/reference/generated/local-assistance/)
for the available workflows and models.

| Capability | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Speech enhancement | / — desktop assistance only | + — with optional model and engine installed | / | + — Enhance Speech |
| Transcription and diarisation | / — desktop assistance only | + — with optional models and engines installed | / | / — transcripts live in Premiere Pro |
| Source separation into stems | / — desktop assistance only | + — with optional model and engine installed | / | / |
| Automatic ducking | + — Auto Duck effect | + — Auto Duck effect | + — Auto Duck effect | + — Essential Sound ducking |
| Beat and shot detection | / — beat detection requires Desktop; shot detection is in Framescaper | ~ — beat detection with an optional model; shot detection is in Framescaper | / | ~ — Remix retimes music automatically |
| Runs entirely on your machine | + — local browser processing; no model inference | + — local processing and offline inference after model installation | + — no inference at all | ~ — some features process in Adobe's cloud |
| Models are optional and removable | / — no model installation in Web | + — separately downloaded, digest-pinned, deletable | + — nothing to install | / — bundled with the application |

## What the differences add up to

Audacity 4 is a single-pass editor. It has no buses, no sends, no
track or effect automation lanes, and no macros in the pinned build. Its
clip-gain envelopes provide volume automation within a clip. Soundscaper keeps that
editing model and adds track and effect automation, mixing, and delivery on top,
plus recording, video, and interchange work that Audacity does not attempt.

Audition still leads on restoration depth, on Premiere Pro round-trips, and on
ambisonics. Where Soundscaper leads is immersive delivery, project handling, and
the fact that it runs in a browser on hardware neither of the others supports.

If you already work in Audacity, see
[project files and Audacity interchange](/projects-and-data/project-files/) for
how to move a project across.
