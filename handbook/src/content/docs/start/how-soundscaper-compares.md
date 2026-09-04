---
title: How Soundscaper compares
description: Compare Soundscaper with Audacity 4 and Adobe Audition across recording, editing, mixing, delivery, and interchange.
sidebar:
  order: 3
---

Soundscaper re-implements Audacity 4 on the web and adds a production layer on
top of it. Adobe Audition is the commercial post-production tool both are
usually measured against. This page compares all three so you can tell which
one already does the job you have.

## How to read this page

Each cell reads **Yes**, **Partial**, or **No**, followed by the detail that
qualifies it.

**Partial** covers three different situations, and the note says which one
applies: the capability exists but is narrower than elsewhere, it exists but
depends on something you have to supply, or it is only reachable by working
around an absence.

Rows describe capabilities, not menu commands. For the exact command inventory
see [Commands and shortcuts](/reference/generated/commands/), and for what each
product enables see
[Product capabilities](/reference/generated/product-capabilities/).

### Where these claims come from

- **Soundscaper** rows come from this repository: the product capability
  profiles, the runtime action manifest, and the export format registry.
  Several desktop-native routes are implemented but still gated on signed
  machine payloads; those rows say so.
- **Audacity 4** rows come from the upstream inventory pinned in this
  repository, `4.0.0` at commit `4c177d43`. A capability that upstream
  registers but leaves disabled or comments out of the menu is
  recorded as such, and a capability with no registration in the pinned build is
  reported as not present in that build rather than as permanently absent.
- **Audition** rows come from Adobe's published documentation for the current
  release. They are not verified against a running build.

## Platform and terms

| Capability | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Licence | Yes — AGPL-3.0-only | Yes — GPL, open source | No — proprietary and closed |
| Cost | Yes — free | Yes — free | No — Creative Cloud subscription |
| Runs in a browser | Yes — Chromium, Firefox, and WebKit | No — desktop only | No — desktop only |
| Desktop builds | Yes — Windows and Linux on x64 and ARM64, macOS on ARM64 | Yes — Windows, macOS, Linux | Partial — Windows and macOS, no Linux |
| Works with no account | Yes — no account exists | Yes — sign-in only for audio.com | No — signed-in subscription required |
| Cloud project storage | No — excluded by the local-first design | Yes — save and share through audio.com | Partial — Creative Cloud files, sessions do not sync |
| System requirements | Yes — runs wherever a current browser runs | Partial — raised materially over Audacity 3 | Partial — professional workstation class |

## Project and session model

| Capability | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Native project format | Yes — `.sscape`, a lossless portable archive | Yes — `.aup4` | Yes — `.sesx` |
| Opens Audacity projects | Yes — AUP4 import and export | Yes — native | No |
| Non-destructive clip timeline | Yes | Yes | Yes — multitrack editor |
| Dedicated single-file editor | Partial — sample editing happens in the timeline | Partial — edits apply in place in the timeline | Yes — waveform editor |
| Mono and stereo content on one track | Yes — a track holds either | No — a track is mono or stereo | No — channel format is fixed per track |
| Nested track folders | Yes — any depth, undoable, with routing | No | Partial — submix buses only, no folder tracks |
| Project bin | Yes — organises files and doubles as a clipboard | No | Partial — the Files panel lists open files |
| Autosave and crash recovery | Yes — autosave, locks, and recovery envelopes | Yes | Yes |
| Markers and named regions | Yes — first class, with navigation and ripple behaviour | Partial — label tracks | Yes — markers and ranges |
| Tempo and time-signature maps | Yes — ordered maps resolved sample-accurately | Partial — one project tempo and signature | Partial — one session tempo |

## Recording

| Capability | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Multitrack recording | Yes — several sources at once | Partial — one input device at a time | Yes — multi-input and multichannel interfaces |
| Microphone and desktop audio together | Yes — built in | No | Partial — needs an operating-system loopback device |
| Timed recording | Yes | Yes | No |
| Sound-activated recording | Yes — with a settable threshold | Yes — with a settable threshold | No |
| Count-in before the take | Yes — tempo-map aware, handles compound metre | Partial — lead-in recording | Partial — pre-roll as part of punch and roll |
| Punch recording | Yes — one transaction, default and routed capture | No | Yes — punch and roll |
| Loop recording into takes | Yes — one lane per pass, appended to the same group | No | Partial — takes on one clip, chosen from a list |
| Take comping | Yes — audition, promote, edit comp regions, flatten as one undoable edit | No | No — no comp editor |
| Input monitoring and metering | Yes | Yes | Yes |

## Timeline editing

| Capability | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Ripple edit variants | Yes — per clip, per track, and all tracks, on cut and delete | Yes — the same three, on cut and delete | Partial — ripple delete on a selection or gap |
| Split, join, and split at silences | Yes | Yes | Partial — split and trim, no clip join |
| Clip groups | Yes | Yes | Yes |
| Clip gain | Yes | Yes | Yes |
| Per-clip pitch and speed | Yes — adjust, render, or reset | Yes — adjust, render, or reset | Partial — stretch stays editable, pitch is an effect |
| Follow tempo changes | Yes — clips stretch when the map moves | Yes | No |
| Beat-aware quantisation and groove | Yes — warp maps with adjustable groove strength | No | No |
| Snap to zero crossings | Yes | Yes | Yes |
| Sample-level drawing | Yes | Partial — no draw action registered in the pinned build | Yes — in the waveform editor |
| Keyboard-only editing | Yes — every edit primitive has a navigation action | Yes — every edit primitive has a navigation action | Partial — extensive shortcuts, some panels need the mouse |

## Spectral work and restoration

| Capability | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Spectrogram view | Yes — with per-track settings | Yes — with per-track settings | Yes — frequency and pitch displays |
| Frequency-bounded selection | Yes | Yes | Yes — marquee and lasso |
| Spectral brush | Yes | Yes | Yes — paintbrush and spot healing |
| Delete or amplify a spectral region | Yes — both as direct actions | Yes — both as direct actions | Partial — apply an effect to the selection |
| Repair short damage | Yes — Repair | Yes — Repair | Yes — Auto Heal and Spot Healing Brush |
| Broadband noise reduction | Yes — with a captured profile | Yes — with a captured profile | Yes — Noise Reduction, Adaptive Noise Reduction, DeNoise |
| De-reverb | No | No | Yes — DeReverb |
| Click, hum, and sibilance tools | Partial — Click Removal only | Partial — Click Removal only | Yes — DeClicker, DeHummer, DeEsser, Click/Pop Eliminator |
| Diagnostics panel | Partial — Find Clipping as an analyser | Partial — Find Clipping as an analyser | Yes — diagnostics with per-issue repair |

## Effects and plug-ins

| Capability | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Built-in effect suite | Yes — the 30 Audacity effects, bundled Nyquist plug-ins, and first-party effects with no upstream equivalent, such as the bitcrusher | Yes — the same 30-effect built-in collection | Yes — around fifty, including multiband dynamics |
| Real-time effect rack per track | Yes — a wider real-time set than upstream | Yes | Yes — sixteen slots per clip, track, and master |
| Parametric EQ | Yes — a new parametric EQ with automatable bands | Partial — Filter Curve and Graphic EQ | Yes — parametric, graphic, and FFT filters |
| Effect presets | Yes — apply, save, import, export | Yes — apply, save, import, export | Yes |
| Macros and batch chains | Yes — saved macro library with templates | No — the pinned build comments the Macros menu out | Yes — Favorites and Batch Process |
| Third-party plug-in formats | Partial — VST3, CLAP, AU, and LV2 on desktop behind consent and containment, none in the browser | Yes — VST3, AU, LV2, and Nyquist, with a plug-in manager | Partial — VST3, and AU on macOS, no CLAP or LV2 |
| Nyquist scripting | Yes — bundled plug-ins and the Nyquist prompt | Yes — bundled plug-ins and the Nyquist prompt | No |
| Sandboxed effect packages | Partial — reviewed WebAssembly packages, one ships and external ones are fenced | No | No |
| Virtual instruments | No — after 1.0 | No | No |

## Mixing, routing, and automation

| Capability | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Mixer with channel strips | Yes | Partial — track controls and a master track | Yes |
| Buses and submixes | Yes — nested, with cycle validation | No | Yes — bus tracks |
| Sends | Yes — pre and post fader, multiple assignments | No | Yes — pre and post fader |
| VCA groups | Yes | No | No |
| Sidechain input | Yes | No | Yes — through sends |
| Cue and control-room mixes | Yes | No | No |
| Plug-in delay compensation | Yes — playback, monitoring, buses, sidechains, render, and freeze | Partial — not exposed in the pinned sources | Yes |
| Automation lanes | Yes — gain, pan, mute, sends, buses, and plug-in parameters | No — no lanes and no envelope tool in the pinned build | Yes — volume, pan, and effect parameters |
| Automation modes | Yes — read, trim, touch, latch, and write | No | Partial — read, write, latch, and touch, no trim |
| Curve shapes | Yes — line, hold, and curve | No | Yes — linear and spline |
| Track freeze | Yes — freeze, unfreeze, and commit without losing state | No | Partial — bounce to a new track |

## Metering and analysis

| Capability | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Loudness meter | Yes — EBU R 128-style, with history | No — a Loudness Normalization effect but no meter | Yes — Loudness Radar to ITU-R BS.1770 |
| Phase and correlation meter | Yes | No | Yes — phase meter and analysis |
| Surround metering | Yes | No | Partial — up to 5.1 |
| Spectrum plot | Yes — Plot Spectrum | Partial — registered, but the pinned build comments it out of the Analyze menu | Yes — Frequency Analysis |
| Clipping and RMS in the waveform | Yes — both, toggled per project | Yes — both, toggled per project | Partial — clip indicators, RMS in Amplitude Statistics |
| Speech-intelligibility contrast | Yes — Contrast analyser | Partial — registered, but the pinned build comments it out of the Analyze menu | No |

## Channels and immersive audio

| Capability | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Channels per file | Yes — up to 32 for PCM formats | Partial — mono and stereo tracks | Yes — up to 32 in the waveform editor |
| Surround mixing | Yes — beds up to 7.1.4 | No | Partial — up to 5.1 |
| Object-based audio | Yes — objects alongside beds | No | No |
| ADM authoring and passthrough | Yes — BW64/ADM with conformance checks | No | No |
| Binaural render | Yes — a named binaural model | No | Partial — binauraliser for ambisonics |
| Ambisonics | No | No | Yes — first order, with a VR panner |

## Export and delivery

| Capability | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Lossless output | Yes — WAV, AIFF, BWF, and BW64 written natively | Yes — WAV, AIFF, and FLAC | Yes — WAV, AIFF, FLAC, and more |
| Lossy output | Partial — MP3, AAC, Opus, Vorbis, MP2, FLAC, and WavPack, all through the FFmpeg runtime | Partial — MP3 built in, the rest through an optional FFmpeg install | Yes — built in |
| Custom encoder settings | Yes — a custom FFmpeg target | Yes — a custom FFmpeg target | Yes — per-format options |
| Export queue | Yes — pause, cancel, retry, and reorder | No — one export at a time | Partial — Batch Process without queue control |
| Stems and alternates in one pass | Yes — queued together with the mix | No | Partial — one mixdown per stem |
| Region-by-region delivery | Yes — mastering sequences with per-region metadata, gaps, and fades | Partial — export labels, no multiple-file export in the pinned build | Yes — export markers to separate files |
| Loudness normalisation on export | Yes — part of the delivery plan | Partial — run the effect first | Yes — Match Loudness |
| Dither and channel mapping | Yes — explicit controls | Partial — dither in preferences | Yes — explicit controls |
| Delivery report | Yes — itemised per job | No | No |
| Render queue survives a restart | Yes — on desktop, restarting from byte zero with a crash journal | No | No |

## Interchange with other tools

| Capability | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Audacity projects | Yes — AUP4 in and out, with an omission report | Yes — native | No |
| EDL | Partial — CMX3600-class export, no import | No | No |
| OpenTimelineIO | Partial — export only | No | No |
| FCPXML | Partial — export only | No | Yes — import and export |
| DAWproject | Yes — import and export, with an exchange report | No | No |
| OMF | No | No | Partial — import and export |
| Round-trip with a video editor | Partial — hands the same project to Framescaper without copying media | No | Yes — Dynamic Link with Premiere Pro |
| Labels and markers exchange | Yes — import and export | Yes — import and export | Yes — marker lists |

## Video

| Capability | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Import video for reference | Yes — on the timeline, with linked audio | No | Partial — one video track, preview only |
| Video timeline editing | Partial — basic editing, the full surface is Framescaper | No | No |
| Video export | Yes — MP4 and WebM through the FFmpeg runtime | No | No — audio only |
| Compositing, grading, and effects | Partial — in Framescaper, on the same project | No | No |

## Machine assistance

| Capability | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Speech enhancement | Partial — desktop only, once the model payload is installed | No | Yes — Enhance Speech |
| Transcription and diarisation | Partial — desktop only, opt-in models | No | No — transcripts live in Premiere Pro |
| Source separation into stems | Partial — desktop only, opt-in models | No | No |
| Automatic ducking | Yes — Auto Duck effect | Yes — Auto Duck effect | Yes — Essential Sound ducking |
| Beat and shot detection | Partial — desktop only, opt-in models | No | Partial — Remix retimes music automatically |
| Runs entirely on your machine | Yes — inference is desktop only and offline after install | Yes — no inference at all | Partial — some features process in Adobe's cloud |
| Models are optional and removable | Yes — separately downloaded, digest-pinned, deletable | Yes — nothing to install | No — bundled with the application |

## What the differences add up to

Audacity 4 is a single-pass editor. It has no buses, no sends, no
automation lanes, and no macros in the pinned build. Soundscaper keeps that
editing model and adds the mixing, automation, and delivery layer on top of it,
plus recording, video, and interchange work that Audacity does not attempt.

Audition still leads on restoration depth, on Premiere Pro round-trips, and on
ambisonics. Where Soundscaper leads is immersive delivery, project handling, and
the fact that it runs in a browser on hardware neither of the others supports.

If you already work in Audacity, see
[project files and Audacity interchange](/projects-and-data/project-files/) for
how to move a project across.
