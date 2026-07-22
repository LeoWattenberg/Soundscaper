# Soundscaper

[Soundscaper](https://soundscaper.org) is a re-implementation of Audacity 4 on the web. It aims to be fully compatible to Audacity 4, keeping layout, design and features closely aligned, while also introducing a range of new features, such as basic video editing capabilities. 

The repository now builds two focused products from the same local-first mixed-media editor and canonical project schema. Soundscaper provides the complete audio/DAW surface at `/<locale>/`; Framescaper provides video effects and compositing at `/framescaper/<locale>/`. On the web, both routes deliberately share the same origin, IndexedDB/OPFS library, and project locks. Either product can preserve, render, and hand a project to the other without copying its media.

`.scape` is the lossless portable project format for both products. Audacity `.aup4` remains an explicitly audio-only interchange format.

## Why Soundscaper

Soundscaper was created by [Leo Wattenberg](https://leo.wattenberg.dk) from [kw.media](https://kw.media). He previously worked as a designer on Audacity. Previously to this project, Leo attempted to add various features found here to Audacity itself, however, due Audacity's ancient codebase, of which only the UI and UX are getting majorly updated for Audacity 4, he found himself (and the robot) to be increasingly frustrated trying to produce inclusion-worthy features. 

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
* AUP4 import and export, so you can move your content between Soundscaper and Audacity 4 at will

## Privacy

I don't want anything to do with your data. Soundscaper works entirely locally on your machine. There is no sync and no account. 

## Credits

* @LeoWattenberg
* @DilsonsPickles for the [audacity-design-system](https://github.com/DilsonsPickles/audacity-design-system)
* The Audacity team & contributors for various features, including translations and effects, I was able to directly port over

See [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) for detailed credits
