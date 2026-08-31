/*
 * SPDX-License-Identifier: GPL-3.0-only
 */

const LIVE_EFFECT_TYPES = new Set([
	'audacity-auto-duck',
	'audacity-bass-treble',
	'audacity-click-removal',
	'audacity-compressor',
	'audacity-distortion',
	'audacity-echo',
	'audacity-filter-curve-eq',
	'audacity-graphic-eq',
	'audacity-invert',
	'audacity-limiter',
	'audacity-noise-reduction',
	'audacity-phaser',
	'audacity-classic-filters',
	'audacity-wahwah',
]);

const SELECTION_ONLY_REASONS = Object.freeze({
	'audacity-amplify': 'The no-clipping gain depends on the complete selection peak.',
	'audacity-fade-in': 'The gain curve depends on selection position and length.',
	'audacity-fade-out': 'The gain curve depends on the future selection boundary.',
	'audacity-legacy-compressor': 'The algorithm performs whole-selection and backwards passes.',
	'audacity-loudness-normalization': 'The gain depends on complete-program loudness.',
	'audacity-normalize': 'DC offset and peak gain depend on complete-selection statistics.',
	'audacity-paulstretch': 'The effect changes duration and cannot be a one-in/one-out insert.',
	'audacity-repair': 'Repair requires an explicitly marked short damaged selection and surrounding context.',
	'audacity-repeat': 'The effect changes duration and cannot be a one-in/one-out insert.',
	'audacity-reverse': 'The first output sample depends on the end of the complete selection.',
	'audacity-truncate-silence': 'The effect removes time and cannot be a one-in/one-out insert.',
});

export function isAudacityEffectLiveCapable(type) {
	return LIVE_EFFECT_TYPES.has(type);
}

export function audacitySelectionOnlyReason(type) {
	return SELECTION_ONLY_REASONS[type];
}
