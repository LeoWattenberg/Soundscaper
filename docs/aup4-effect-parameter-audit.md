# AUP4 effect parameter audit

Investigation date: 2026-09-16.

Audacity saves effect settings through `CommandParameters`, including settings
that are not audio controls or that belong to an inactive mode. Realtime XML
contains those saved entries, rather than an inventory of visible controls.
See the pinned [realtime writer](https://github.com/audacity/audacity/blob/4c177d436e48c1d20f231eada44035593cb26292/au3/libraries/au3-realtime-effects/RealtimeEffectState.cpp#L913).

## Scope and evidence

The audit compared Soundscaper's profiles with local Git source at Audacity 4
commit `4c177d436e48c1d20f231eada44035593cb26292` and, for the legacy macro
contract, Audacity 3.7.7 commit `5ef610ed23260d6d648175735bb16b32536eb30b`.
The links below point to those revisions, not the checkout's changing HEAD.

The audit covered the original 14 AUP4 profiles: Auto Duck, Bass and Treble, Click Removal,
Compressor, Distortion, Echo, Filter Curve, Graphic EQ, Invert, Limiter, Noise
Reduction, Phaser, Classic Filters, and Wahwah. "AUP4 profile" describes
Soundscaper's interchange inventory; it does not establish that each effect
can be inserted into a native Audacity realtime rack.

The audit covered the original 17 complementary selection macro profiles: Amplify, Change
Pitch, Change Speed and Pitch, Change Tempo, Fade In, Fade Out, Legacy
Compressor, Loudness Normalization, Normalize, Paulstretch, Remove DC offset,
Repair, Repeat, Reverb, Reverse, Sliding Stretch, and Truncate Silence.
Twelve have captured parameters and five have none. No additional omitted
captured parameter names were found after accounting for the dynamics display
settings and equalization's dynamically saved `fN`/`vN` curve entries.

## Corrections identified

| Finding | Consequence and required handling | Pinned source |
| --- | --- | --- |
| Bass and Treble saves `Link Sliders` as either boolean value. Soundscaper required `0`. | A valid linked setting could make the effect appear missing. Treat this as UI state: accept either value, retain the source value when rewriting opaque XML, and emit `0` for a new browser effect. The audio processor uses the three numeric values independently of the link setting. | [Captured settings](https://github.com/audacity/audacity/blob/4c177d436e48c1d20f231eada44035593cb26292/au3/libraries/au3-builtin-effects/BassTrebleBase.cpp#L14), [boolean declaration](https://github.com/audacity/audacity/blob/4c177d436e48c1d20f231eada44035593cb26292/au3/libraries/au3-builtin-effects/BassTrebleBase.h#L139), [processor](https://github.com/audacity/audacity/blob/4c177d436e48c1d20f231eada44035593cb26292/au3/libraries/au3-builtin-effects/BassTrebleBase.cpp#L123) |
| Graphic EQ shares the saved `InterpolateLin` boolean with Filter Curve. Soundscaper required `0`. | Recognize and preserve the source metadata, with `0` as the new-effect default. This closes a profile restriction; the pinned native EQ classes do not support realtime insertion, as explained below. | [Shared captured settings](https://github.com/audacity/audacity/blob/4c177d436e48c1d20f231eada44035593cb26292/au3/libraries/au3-builtin-effects/EqualizationBase.cpp#L7), [boolean declaration](https://github.com/audacity/audacity/blob/4c177d436e48c1d20f231eada44035593cb26292/au3/libraries/au3-builtin-effects/EqualizationParameters.h#L59) |
| AUP4 compared declared parameter names with serialized names without applying Audacity's normalization. | Bass and Treble, Distortion, and Noise Reduction have names containing spaces. Audacity writes `Link_Sliders`, `Threshold_dB`, `Noise_Floor`, `Parameter_1`, `Parameter_2`, `Frequency_Smoothing_Bands`, `Noise_Gain`, and `Noise_Reduction_Choice`. Normalize on encode, decode, validation, and opaque merge; retain compatibility with earlier spaced browser output. This is a serialization mismatch, separate from hidden controls. | [Normalization](https://github.com/audacity/audacity/blob/4c177d436e48c1d20f231eada44035593cb26292/au3/libraries/au3-components/EffectAutomationParameters.h#L301), [Distortion declarations](https://github.com/audacity/audacity/blob/4c177d436e48c1d20f231eada44035593cb26292/au3/libraries/au3-builtin-effects/DistortionBase.h#L216), [Noise Reduction declarations](https://github.com/audacity/audacity/blob/4c177d436e48c1d20f231eada44035593cb26292/src/effects/builtin_collection/noisereduction/noisereductioneffect.h#L169) |
| The pinned Qt effects use `Click removal` and `Noise reduction` as internal symbols. | Prefer those native IDs for new output; read the uppercase symbols from earlier Audacity/browser versions too, and preserve an imported matching ID on rewrite. This is an ID mismatch, separate from saved parameters. | [Click removal symbol](https://github.com/audacity/audacity/blob/4c177d436e48c1d20f231eada44035593cb26292/src/effects/builtin_collection/clickremoval/clickremovaleffect.cpp#L51), [Noise reduction symbol](https://github.com/audacity/audacity/blob/4c177d436e48c1d20f231eada44035593cb26292/src/effects/builtin_collection/noisereduction/noisereductioneffect.cpp#L201) |

Compressor and Limiter's `showInput`, `showOutput`, `showActual`, and `showTarget`
were already corrected in the preceding change. Their captured settings include
these four graph flags alongside the processing controls:
[Compressor](https://github.com/audacity/audacity/blob/4c177d436e48c1d20f231eada44035593cb26292/src/effects/builtin_collection/dynamics/compressor/compressoreffect.cpp#L17),
[Limiter](https://github.com/audacity/audacity/blob/4c177d436e48c1d20f231eada44035593cb26292/src/effects/builtin_collection/dynamics/limiter/limitereffect.cpp#L15).

## Other saved state already represented

| Effect | Saved state beyond the currently active controls | Existing handling and source |
| --- | --- | --- |
| Loudness Normalization | Both LUFS and RMS targets are saved behind one mode-dependent field; DualMono remains saved while its control is disabled in RMS mode. | All five captured settings are mapped. [Declarations](https://github.com/audacity/audacity/blob/5ef610ed23260d6d648175735bb16b32536eb30b/libraries/lib-builtin-effects/LoudnessBase.cpp#L26), [target field](https://github.com/audacity/audacity/blob/4c177d436e48c1d20f231eada44035593cb26292/src/effects/builtin_collection/loudness/NormalizeLoudnessView.qml#L75), [DualMono control](https://github.com/audacity/audacity/blob/4c177d436e48c1d20f231eada44035593cb26292/src/effects/builtin_collection/loudness/NormalizeLoudnessView.qml#L116) |
| Truncate Silence | Both truncate duration and compression percentage are saved behind one action-dependent field. | Both values and all other captured settings are mapped. [Declarations](https://github.com/audacity/audacity/blob/5ef610ed23260d6d648175735bb16b32536eb30b/libraries/lib-builtin-effects/TruncSilenceBase.cpp#L73), [field](https://github.com/audacity/audacity/blob/4c177d436e48c1d20f231eada44035593cb26292/src/effects/builtin_collection/truncatesilence/TruncateSilenceView.qml#L236) |
| Normalize | Peak target and stereo independence remain saved while volume application disables those controls. | All four captured settings are mapped, including the earlier `ApplyGain` alias for `ApplyVolume`. [Declarations](https://github.com/audacity/audacity/blob/5ef610ed23260d6d648175735bb16b32536eb30b/libraries/lib-builtin-effects/NormalizeBase.cpp#L18), [disabled controls](https://github.com/audacity/audacity/blob/4c177d436e48c1d20f231eada44035593cb26292/src/effects/builtin_collection/normalize/NormalizeView.qml#L83) |
| Sliding Stretch | Pitch endpoints are saved twice, in semitones and percentage. | All six keys are recognized; percentage takes precedence in declaration order. [Captured settings](https://github.com/audacity/audacity/blob/5ef610ed23260d6d648175735bb16b32536eb30b/libraries/lib-builtin-effects/TimeScaleBase.cpp#L22) |
| Change Pitch / Change Tempo | The legacy `SBSMS` engine selector is saved even when that build cannot use it. | The key is recognized, but is not mapped to a browser setting. Imported `SBSMS=1` uses Soundscaper's engine; this is an algorithm interchange limitation. [Pitch contract](https://github.com/audacity/audacity/blob/5ef610ed23260d6d648175735bb16b32536eb30b/libraries/lib-builtin-effects/ChangePitchBase.cpp#L31), [tempo contract](https://github.com/audacity/audacity/blob/5ef610ed23260d6d648175735bb16b32536eb30b/libraries/lib-builtin-effects/ChangeTempoBase.cpp#L25) |
| Amplify | Macro mode omits `AllowClipping` and forces it true. | An absent flag receives that macro default. [Batch contract](https://github.com/audacity/audacity/blob/5ef610ed23260d6d648175735bb16b32536eb30b/libraries/lib-builtin-effects/AmplifyBase.cpp#L16) |

## Reverb realtime correction

Native Reverb supports realtime processing. Soundscaper now exposes its browser
adaptation in the existing rack effect menu as `Reverb (Audacity)`, using the
same ten controls and factory presets as the selection effect. Realtime and
offline rack rendering retain processor state across blocks. Native AUP4 Reverb
settings are mapped to an editable rack effect and exported with Audacity's
captured parameter names; native and browser DSP audio equivalence is not claimed.
Moving this shared contract into the AUP4 profiles leaves 15 AUP4 profiles and
16 complementary selection macro profiles. No new always-visible UI is added.
See [native support](https://github.com/audacity/audacity/blob/4c177d436e48c1d20f231eada44035593cb26292/src/effects/builtin_collection/reverb/reverbeffect.cpp#L135)
and [captured settings](https://github.com/audacity/audacity/blob/4c177d436e48c1d20f231eada44035593cb26292/src/effects/builtin_collection/reverb/reverbeffect.cpp#L48).

Soundscaper preserves its existing Reverb gain range of -60 to +12 dB. Native
Audacity accepts only -20 to +10 dB for wet and dry gain. Effects outside those
native limits export as a browser extension that Soundscaper reopens exactly;
native Audacity retains the extension as an unavailable effect. See the
[native gain limits](https://github.com/audacity/audacity/blob/4c177d436e48c1d20f231eada44035593cb26292/src/effects/builtin_collection/reverb/reverbeffect.h#L169).

## Separate limitations

Graphic EQ saves a variable-length curve, not necessarily 31 slider gains.
Soundscaper's AUP4 decoder only materializes gains for exactly 31 point pairs;
other valid curves can leave default gains, and point frequencies are not used
to reconstruct the sliders. This curve-to-slider ingestion issue needs separate
work. Native Audacity explicitly reconstructs sliders from the curve:
[curve serialization](https://github.com/audacity/audacity/blob/4c177d436e48c1d20f231eada44035593cb26292/au3/libraries/au3-builtin-effects/EqualizationBase.cpp#L102),
[slider reconstruction](https://github.com/audacity/audacity/blob/4c177d436e48c1d20f231eada44035593cb26292/src/effects/builtin_collection/graphiceq/graphiceqbandsmodel.cpp#L59).
The pinned Graphic EQ and Filter Curve classes inherit `RealtimeSince::Never`
from [Effect](https://github.com/audacity/audacity/blob/4c177d436e48c1d20f231eada44035593cb26292/au3/libraries/au3-effects/Effect.cpp#L85);
the metadata finding above is not evidence of a native realtime EQ import case.

## Validation boundary

This is a source audit supported by literal serialization fixtures, interchange
regression tests, and a fixture-based audio gate. Those checks exercise
Soundscaper and its declared contract. Reverb browser checks cover the existing
menu, ten controls, presets, saved edits, playback, wet-only WAV rendering, and
native AUP4 parameter import/export/reopen with zero missing effects.
No pinned native Audacity runner was used,
so they do not establish native runtime conformance or audio equivalence.
Unknown future processing parameters must still preserve an unavailable effect
opaquely rather than silently discard settings that may change its sound.
