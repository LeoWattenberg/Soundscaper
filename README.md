# Soundscaper

[Soundscaper](https://soundscaper.org) is a re-implementation of Audacity 4 on the web. It aims to be fully compatible to Audacity 4, keeping layout, design and features closely aligned, while also introducing a range of new features, such as basic video editing capabilities. 

The repository builds three focused products over shared local-first media, storage and Scape infrastructure: Soundscaper for audio, Framescaper for video, and Lightscaper for its [photo library and develop roadmap](roadmap-lightscaper.md). Each builds independently for `/<locale>/` on its own origin: `soundscaper.org`, `framescaper.org` and `lightscaper.org`. Browser storage and locks remain origin-scoped, following the [product-origin decision](docs/decisions/product-origins.md).

Scape is the shared lossless archive container. Soundscaper saves `.sscape`, Framescaper `.fscape`, and Lightscaper catalog backups `.liscape`. The suffix is a routing hint; the archive's family and version determine editable authority. Cross-origin handoff transports authenticated media into the destination store. Audacity `.aup3` and `.aup4` exports remain explicitly audio-only interchange formats.

## Why Soundscaper

Soundscaper was created by [Leo Wattenberg](https://leo.wattenberg.dk) from [Mindscaper](https://mindscaper.org). He previously worked as a designer on Audacity. Previously to this project, Leo attempted to add various features found here to Audacity itself, however, due Audacity's ancient codebase, of which only the UI and UX are getting majorly updated for Audacity 4, he found himself (and the robot) to be increasingly frustrated trying to produce inclusion-worthy features.

Soundscaper thus exists to serve three purposes: 

1. To act as a feature prototype for Audacity 5, as with version 5 Audacity should have modernized its backend to allow for much more exciting stuff
2. To act as an independent fork of sorts of Audacity 4, in case anything bad happens to it
3. To act as a platform-agnostic replacement, as Audacity 4 significantly increases the minimum system requirements.

## New features compared to Audacity 4

Soundscaper features:

* A project bin, to organize files or use as an advanced clipboard
* Basic video editing capabilities
* An EBU R 128-style meter
* Multi-track recording (including recording desktop audio and mic at the same time, for recording of conference calls)
* A much larger suite of real-time effects
* Audio tracks which can contain both mono and stereo content
* A new parametric EQ
* Audacity AUP, AUP3, and AUP4 import, plus audio-only AUP3 and AUP4 export with compatibility reports

## Privacy

Soundscaper is local-first: projects, recordings, imported media, and media
processing stay on your device. There is no sync and no Soundscaper account.
You can optionally connect an existing Freesound account for original-quality
imports and uploads. Limited
network connections deliver the application and optional assets, check for
desktop updates, or support features you deliberately open. See the
[privacy policy](https://soundscaper.org/privacy/en/) for the complete details.

## Credits

* @LeoWattenberg
* @DilsonsPickles for the [audacity-design-system](https://github.com/DilsonsPickles/audacity-design-system)
* The Audacity team & contributors for various features, including translations and effects, I was able to directly port over

See [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) for detailed credits
