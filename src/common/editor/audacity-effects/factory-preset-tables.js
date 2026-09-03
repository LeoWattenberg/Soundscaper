/*
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * Audacity's factory effect presets, transcribed column for column from the
 * upstream tables so a row here can be read against the file it came from.
 * Audacity is GPL-3.0; the individual effect files are GPL-2.0-or-later
 * unless otherwise noted. This JavaScript adaptation was created for kw.media
 * in 2026.
 *
 * `factory-presets.js` turns these rows into the editor's own parameter
 * vocabulary; nothing here is localized, because a preset's English name is
 * its stable identity and its translation is a display concern.
 */

export const AUDACITY_FACTORY_PRESET_SOURCE = Object.freeze({
	version: '4.0.0',
	commit: '4c177d436e48c1d20f231eada44035593cb26292',
	url: 'https://github.com/audacity/audacity/tree/Audacity-4.0.0',
});

export const AUDACITY_FACTORY_PRESET_UPSTREAM_FILES = deepFreeze({
	'audacity-compressor': ['au3/libraries/au3-dynamic-range-processor/DynamicRangeProcessorUtils.h'],
	'audacity-distortion': ['au3/libraries/au3-builtin-effects/DistortionBase.cpp'],
	'audacity-filter-curve-eq': ['au3/libraries/au3-builtin-effects/EqualizationBase.cpp'],
	'audacity-graphic-eq': ['au3/libraries/au3-builtin-effects/EqualizationBase.cpp'],
	'audacity-limiter': ['au3/libraries/au3-dynamic-range-processor/DynamicRangeProcessorUtils.h'],
	'audacity-reverb': ['src/effects/builtin_collection/reverb/reverbeffect.cpp'],
});

/**
 * `ReverbEffect::FactoryPresets`, in upstream column order: room size,
 * pre-delay, reverberance, HF damping, tone low, tone high, wet gain,
 * dry gain, stereo width, wet only.
 */
export const AUDACITY_REVERB_FACTORY_PRESET_ROWS = deepFreeze([
	['Acoustic', 50, 10, 75, 100, 21, 100, -14, 0, 80, false],
	['Ambience', 100, 55, 100, 50, 53, 38, 0, -10, 100, false],
	['Artificial', 81, 99, 23, 62, 16, 19, -4, 0, 100, false],
	['Clean', 50, 10, 75, 100, 55, 100, -18, 0, 75, false],
	['Modern', 50, 10, 75, 100, 55, 100, -15, 0, 75, false],
	['Vocal I', 70, 20, 40, 99, 100, 50, -12, 0, 70, false],
	['Vocal II', 50, 0, 50, 99, 50, 100, -1, -1, 70, false],
	['Dance Vocal', 90, 2, 60, 77, 30, 51, -10, 0, 100, false],
	['Modern Vocal', 66, 27, 77, 8, 0, 51, -10, 0, 68, false],
	['Voice Tail', 66, 27, 100, 8, 0, 51, -6, 0, 68, false],
	['Bathroom', 16, 8, 80, 0, 0, 100, -6, 0, 100, false],
	['Small Room Bright', 30, 10, 50, 50, 50, 100, -1, -1, 100, false],
	['Small Room Dark', 30, 10, 50, 50, 100, 0, -1, -1, 100, false],
	['Medium Room', 75, 10, 40, 50, 100, 70, -1, -1, 70, false],
	['Large Room', 85, 10, 40, 50, 100, 80, 0, -6, 90, false],
	['Church Hall', 90, 32, 60, 50, 100, 50, 0, -12, 100, false],
	['Cathedral', 90, 16, 90, 50, 100, 0, 0, -20, 100, false],
	['Big Cave', 100, 55, 100, 50, 53, 38, 5, -3, 100, false],
]);

/**
 * `DistortionBase::FactoryPresets`, in upstream column order: table type
 * index, DC block, threshold, noise floor, parameter 1, parameter 2, repeats.
 * The table index selects the same distortion curve the mode option lists in
 * `AUDACITY_DISTORTION_MODES`.
 */
export const AUDACITY_DISTORTION_FACTORY_PRESET_ROWS = deepFreeze([
	['Hard clip -12dB, 80% make-up gain', 0, 0, -12, -70, 0, 80, 0],
	['Soft clip -12dB, 80% make-up gain', 1, 0, -12, -70, 50, 80, 0],
	['Fuzz Box', 1, 0, -30, -70, 80, 80, 0],
	['Walkie-talkie', 1, 0, -50, -70, 60, 80, 0],
	['Blues drive sustain', 2, 0, -6, -70, 30, 80, 0],
	['Light Crunch Overdrive', 3, 0, -6, -70, 20, 80, 0],
	['Heavy Overdrive', 4, 0, -6, -70, 90, 80, 0],
	['3rd Harmonic (Perfect Fifth)', 5, 0, -6, -70, 100, 60, 0],
	['Valve Overdrive', 6, 1, -6, -70, 30, 40, 0],
	['2nd Harmonic (Octave)', 6, 1, -6, -70, 50, 0, 0],
	['Gated Expansion Distortion', 7, 0, -6, -70, 30, 80, 0],
	['Leveller, Light, -70dB noise floor', 8, 0, -6, -70, 0, 50, 1],
	['Leveller, Moderate, -70dB noise floor', 8, 0, -6, -70, 0, 50, 2],
	['Leveller, Heavy, -70dB noise floor', 8, 0, -6, -70, 0, 50, 3],
	['Leveller, Heavier, -70dB noise floor', 8, 0, -6, -70, 0, 50, 4],
	['Leveller, Heaviest, -70dB noise floor', 8, 0, -6, -70, 0, 50, 5],
	['Half-wave Rectifier', 9, 0, -6, -70, 50, 50, 0],
	['Full-wave Rectifier', 9, 0, -6, -70, 100, 50, 0],
	['Full-wave Rectifier (DC blocked)', 9, 1, -6, -70, 100, 50, 0],
	['Percussion Limiter', 10, 0, -12, -70, 100, 30, 0],
]);

/** The `mode` option values, in the order of upstream's table type index. */
export const AUDACITY_DISTORTION_MODES = Object.freeze([
	'hard-clipping', 'soft-clipping', 'soft-overdrive', 'medium-overdrive',
	'hard-overdrive', 'cubic', 'even-harmonics', 'expand-compress', 'leveller',
	'rectifier', 'hard-limiter',
]);

/**
 * `DynamicRangeProcessorUtils::serializedCompressorPresets`: threshold,
 * make-up gain, knee width, ratio, lookahead, attack, release. Upstream also
 * serializes which meters the dynamics view shows; that is dialog furniture
 * rather than processing, so it is left behind.
 */
export const AUDACITY_COMPRESSOR_FACTORY_PRESET_ROWS = deepFreeze([
	['Modern', -14, 0, 18, 4, 1, 0.2, 210],
	['Glue Compressor', -22, 2.5, 12, 1.2, 1, 20, 1_000],
	['Gentle', -18, 0, 6, 1.5, 1, 1, 100],
	['Beat Booster', -18, 3, 1, 4, 1, 14, 9],
	['Deep Dive Master', -23.5, 1.6, 1, 1.2, 33.2, 52.2, 12.2],
	['Beefy Master', -16.8, 2.5, 4.9, 1.2, 100, 49.6, 17.9],
	['Make It Right Master', -6.5, 1.6, 1, 1.4, 10, 1, 1],
	['Brick Wall Master', -10, 3, 2, 100, 1, 0, 2],
	['Lead Vocals', -14, 0, 5.5, 5.2, 1, 1, 60],
	['Fat Vocals', -32, 2.5, 5, 1.7, 1, 86.9, 15.2],
	['Power Vocals', -16.8, 3, 19.6, 1.5, 46.2, 2.8, 356.3],
	['Vocal Control', -15, 4.5, 23.5, 3, 1, 0, 196],
	['Vocal Touch-Up', -22, 3.6, 30, 1.5, 0, 2, 450],
	['Voice Memos Balancer', -22.3, 4.5, 5.8, 10.1, 1, 6.5, 3.6],
	['Podcast/Radio', -15, 1, 24, 3, 1, 15, 40],
	['Piano', -16, 1, 18, 2, 1, 0.2, 150],
	['Acoustic Guitar', -15, 1.5, 8, 2.5, 1, 15, 225],
	['Bass Guitar', -13, 0, 2, 3, 40, 1, 50],
	['Strings', -15, 2.5, 14.3, 1.8, 1, 30, 400],
	['Kick Drums', -14, 2, 0.5, 4, 1, 30, 120],
	['Drums Control', -12, 1, 29, 2, 1, 2, 40],
	['Climax Impulser SFX', -55.1, 0, 27.4, 23.4, 0, 172, 813.4],
	['Engine Breathing SFX', -37.7, 0, 3.5, 4.7, 2.3, 190.2, 0.2],
	['Great Impact SFX', -49.3, 8.3, 5, 24.6, 0.6, 172, 562.6],
	['Great Body SFX', -32.8, 8.6, 0.3, 2.4, 29.3, 74.6, 204.8],
	['Great Tail SFX', -55.4, 23.9, 0.3, 2.4, 0, 1.4, 199.6],
	['Smack Explosion SFX', -32.5, 7.1, 24.4, 5.9, 1.3, 155.5, 1.7],
]);

/**
 * `DynamicRangeProcessorUtils::serializedLimiterPresets`: threshold, make-up
 * target, knee width, lookahead, release.
 */
export const AUDACITY_LIMITER_FACTORY_PRESET_ROWS = deepFreeze([
	['Master Limiter', -0.1, -0.1, 0.1, 0.1, 0.1],
	['SFX Limiter', -3, -1, 1, 1, 1],
	['VO Limiter', -4, -1, 0, 0.1, 10.1],
	['Modern', -1.5, -1.5, 0, 1, 5],
	['Modern Punch', -1.5, -1.5, 0, 1, 5],
	['Modern Punch 2', -1, -1.5, 1, 1, 2],
	['Play it Loud', -8.5, -2.2, 0, 1, 5],
]);

/**
 * `EqualizationBase::FactoryPresets`, as frequency and gain pairs. `graphic`
 * marks the curves upstream also offers in Graphic EQ, which is upstream's
 * `bForBoth` column; the rest belong to Filter Curve EQ alone.
 */
export const AUDACITY_EQUALIZATION_FACTORY_PRESET_CURVES = deepFreeze([
	{
		name: '100Hz Rumble', graphic: false,
		points: [[20, -80], [49.237316986327, -33.107692718506], [54.196034330446, -29.553844451904],
			[88.033573501041, -6.923076629639], [95.871851182279, -4.523078918457],
			[108.957037410504, -1.938461303711], [123.828171198057, -0.73846244812],
			[149.228077614658, -0.092308044434],
		],
	},
	{
		name: 'AM Radio', graphic: false,
		points: [[20, -63.67], [31, -33.219], [50, -3.01], [63, -0.106], [100, 0], [2_500, 0], [4_000, -0.614],
			[5_000, -8.059], [8_000, -39.981], [20_000, -103.651], [48_000, -164.485],
		],
	},
	{
		name: 'Bass Boost', graphic: true,
		points: [[100, 9], [500, 0]],
	},
	{
		name: 'Bass Cut', graphic: true,
		points: [[150, -50], [300, 0]],
	},
	{
		name: 'Low rolloff for speech', graphic: false,
		points: [[50, -120], [60, -50], [65, -24], [70, -12], [80, -4], [90, -1], [100, 0]],
	},
	{
		name: 'RIAA', graphic: true,
		points: [[20, 19.274], [25, 18.954], [31, 18.516], [40, 17.792], [50, 16.946], [63, 15.852], [80, 14.506],
			[100, 13.088], [125, 11.563], [160, 9.809], [200, 8.219], [250, 6.677], [315, 5.179], [400, 3.784],
			[500, 2.648], [630, 1.642], [800, 0.751], [1_000, 0], [1_250, -0.744], [1_600, -1.643], [2_000, -2.589],
			[2_500, -3.7], [3_150, -5.038], [4_000, -6.605], [5_000, -8.21], [6_300, -9.98], [8_000, -11.894],
			[10_000, -13.734], [12_500, -15.609], [16_000, -17.708], [20_000, -19.62], [25_000, -21.542],
			[48_000, -27.187],
		],
	},
	{
		name: 'Telephone', graphic: false,
		points: [[20, -94.087], [200, -14.254], [250, -7.243], [315, -2.245], [400, -0.414], [500, 0], [2_500, 0],
			[3_150, -0.874], [4_000, -3.992], [5_000, -9.993], [48_000, -88.117],
		],
	},
	{
		name: 'Treble Boost', graphic: true,
		points: [[4_000, 0], [5_000, 9]],
	},
	{
		name: 'Treble Cut', graphic: true,
		points: [[6_000, 0], [10_000, -110]],
	},
	{
		name: 'Walkie-talkie', graphic: false,
		points: [[100, -120], [101, 0], [2_000, 0], [2_001, -120]],
	},
]);

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
