/* SPDX-License-Identifier: AGPL-3.0-only */

/** Logarithmic and exponential approximate fast and slow fades in the powered-sine family. */
export const END_FADE_SHAPE_PRESETS = [
	{ id: 'linear', shape: undefined },
	{ id: 'logarithmic', shape: 0.5 },
	{ id: 'exponential', shape: 3 },
	{ id: 's-curve', shape: 2 },
	{ id: 'constant-power', shape: 1 },
] as const;

/** Paired sine/cosine exponents preserve squared power at 1 and summed volume at 2. */
export const CROSSFADE_SHAPE_PRESETS = [
	{ id: 'constant-power', shape: 1 },
	{ id: 'constant-volume', shape: 2 },
] as const;

export type EndFadeShapePresetId = typeof END_FADE_SHAPE_PRESETS[number]['id'];
export type CrossfadeShapePresetId = typeof CROSSFADE_SHAPE_PRESETS[number]['id'];

const PRESET_SHAPE_EPSILON = 1e-9;

function matchesShape(shape: number | undefined, preset: number | undefined): boolean {
	if (shape === undefined || preset === undefined) return shape === preset;
	return Math.abs(shape - preset) <= PRESET_SHAPE_EPSILON;
}

/** Linear remains an absent shape so old linear ramps retain their exact gain. */
export function selectedEndFadeShapePreset(shape: number | undefined): EndFadeShapePresetId | null {
	return END_FADE_SHAPE_PRESETS.find(preset => matchesShape(shape, preset.shape))?.id ?? null;
}

export function selectedCrossfadeShapePreset(
	outShape: number | undefined,
	inShape: number | undefined,
): CrossfadeShapePresetId | null {
	return CROSSFADE_SHAPE_PRESETS.find(preset => (
		matchesShape(outShape ?? 1, preset.shape) && matchesShape(inShape ?? 1, preset.shape)
	))?.id ?? null;
}
