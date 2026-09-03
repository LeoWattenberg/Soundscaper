/*
 * Bitcrusher catalogue entry.
 *
 * Kept out of effects.js so the catalogue stays a list rather than a place
 * effects are written. This module is the contract, and owns the parameter
 * vocabulary: the catalogue reaches it during startup, so it must not pull the
 * DSP in behind it. dsp.js depends on this file, never the other way round.
 */

export const BITCRUSHER_EFFECT_TYPE = 'bitcrusher';

export const BITCRUSHER_DITHER_MODES = Object.freeze([
	'none',
	'rectangular',
	'triangular',
	'triangular-highpass',
	'shaped',
]);

export const BITCRUSHER_INTERPOLATION_MODES = Object.freeze([
	'sample-hold',
	'linear',
	'cubic',
	'smooth',
]);

export const BITCRUSHER_MINIMUM_BITS = 1;
export const BITCRUSHER_MAXIMUM_BITS = 16;
export const BITCRUSHER_MAXIMUM_DOWNSAMPLING = 64;

const TOPOLOGY_REASON = 'Changing the reconstruction or dither mode rebuilds the processor state.';

export const BITCRUSHER_EFFECT_DEFINITION = Object.freeze({
	defaults: Object.freeze({
		bitDepth: 8,
		downsampling: 1,
		dither: 'none',
		interpolation: 'sample-hold',
		mix: 100,
	}),
	ranges: Object.freeze({
		bitDepth: [BITCRUSHER_MINIMUM_BITS, BITCRUSHER_MAXIMUM_BITS, {
			unit: 'bits', step: 1, taper: 'linear', integer: true,
		}],
		downsampling: [1, BITCRUSHER_MAXIMUM_DOWNSAMPLING, {
			unit: 'x', step: 0.01, taper: 'logarithmic',
		}],
		mix: [0, 100, { unit: '%', step: 1, taper: 'linear' }],
	}),
	choices: Object.freeze({
		dither: Object.freeze({
			options: BITCRUSHER_DITHER_MODES,
			automatable: false,
			automationBlockReason: TOPOLOGY_REASON,
		}),
		interpolation: Object.freeze({
			options: BITCRUSHER_INTERPOLATION_MODES,
			automatable: false,
			automationBlockReason: TOPOLOGY_REASON,
		}),
	}),
});
