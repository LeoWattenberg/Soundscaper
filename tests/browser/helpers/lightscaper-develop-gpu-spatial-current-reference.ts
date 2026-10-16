/* SPDX-License-Identifier: AGPL-3.0-only */

import { qualifyNativeGpuSpatialCurrentV1, referenceNativeGpuSpatialCurrentV1, startGpuSpatialObservationCurrentV1,
	readGpuSpatialObservationCurrentV1, resetGpuSpatialObservationCurrentV1, stopGpuSpatialObservationCurrentV1 } from './lightscaper-native-gpu-spatial-current-reference.ts';
export { readRawImportCustodyCurrentV1 as readGpuSpatialPhotoCustodyCurrentV1 } from './lightscaper-raw-import-current-reference.ts';

export function startGpuSpatialUiObservationCurrentV1(): void { startGpuSpatialObservationCurrentV1({ width: 32, height: 32 }); }
export function readGpuSpatialUiObservationCurrentV1() { return readGpuSpatialObservationCurrentV1(); }
export function resetGpuSpatialUiObservationCurrentV1(): void { resetGpuSpatialObservationCurrentV1({ width: 32, height: 32 }); }
export function stopGpuSpatialUiObservationCurrentV1(): void { stopGpuSpatialObservationCurrentV1(); }

/** Explicit normalized defaults matter: these are the complete expected saved
 * parameter records, rather than a projection of only the controls we edit. */
export function gpuSpatialAuthoredEffectsCurrentV1() {
	return [
		{ id: 'detail', type: 'detail-sharpen-v1', enabled: true, params: { amount: 75, threshold: 2 } },
		{ id: 'vignette', type: 'post-crop-vignette-v1', enabled: true, params: { amount: -30, midpoint: 50, roundness: 0, feather: 50, highlights: 25 } },
		{ id: 'clarity', type: 'clarity-v1', enabled: true, params: { amount: 30 } },
		{ id: 'noise', type: 'noise-reduction-v1', enabled: true, params: { luminance: 25, luminanceDetail: 50, luminanceContrast: 0, color: 40, colorDetail: 50, colorSmoothness: 50 } },
		{ id: 'grain', type: 'grain-v1', enabled: true, params: { amount: 25, size: 1.5, roughness: 50, seed: 417 } },
		{ id: 'texture', type: 'texture-v1', enabled: true, params: { amount: -20 } },
		{ id: 'dehaze', type: 'dehaze-v1', enabled: true, params: { amount: 25 } },
	];
}

/** The diagnostic CPU reference receives the actual pinned Original words in
 * its own scoped plane. It never seeds a recipe, pixel or callback into the
 * application. Independent arithmetic literals live in the native corpus. */
export async function gpuSpatialWordsReferenceCurrentV1(words: readonly number[]) {
	const source = native(words);
	try {
		const expected = await referenceNativeGpuSpatialCurrentV1({ width: 32, height: 32, values: [...source], effects: gpuSpatialAuthoredEffectsCurrentV1() });
		return { ...expected, before: display([...source]), after: display(expected.values), sourceBits: [...new Uint32Array(source.buffer)] };
	} finally { source.fill(0); }
}
export async function qualifyGpuSpatialWordsCurrentV1(value: Readonly<{ words: readonly number[]; develop: unknown }>) {
	const pixels = native(value.words);
	try { return await qualifyNativeGpuSpatialCurrentV1({ width: 32, height: 32, values: [...pixels], develop: value.develop }); }
	finally { pixels.fill(0); }
}
function native(words: readonly number[]): Float32Array<ArrayBuffer> {
	if (words.length !== 4096 || words.some((n, at) => !Number.isInteger(n) || n < 0 || n > 65535 || at % 4 === 3 && n !== 65535)) {
		throw new RangeError('Spatial UI requires actual32² opaque native words.');
	}
	return Float32Array.from(words, n => n / 65535);
}
function display(values: readonly number[]): number[] {
	return values.map((n, at) => { if (at % 4 === 3) return Math.round(n * 255);
		const value = Math.max(0, Math.min(1, n)); return Math.round((value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055) * 255); });
}
