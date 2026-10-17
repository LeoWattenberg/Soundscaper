/* SPDX-License-Identifier: AGPL-3.0-only */

import { qualifyNativeGpuOpticsCurrentV1, referenceNativeGpuOpticsCurrentV1, startGpuOpticsObservationCurrentV1,
	readGpuOpticsObservationCurrentV1, resetGpuOpticsObservationCurrentV1, stopGpuOpticsObservationCurrentV1 } from './lightscaper-native-gpu-optics-current-reference.ts';
export { readRawImportCustodyCurrentV1 as readGpuOpticsPhotoCustodyCurrentV1 } from './lightscaper-raw-import-current-reference.ts';

export function startGpuOpticsUiObservationCurrentV1(): void { startGpuOpticsObservationCurrentV1({ width: 32, height: 32 }); }
export function readGpuOpticsUiObservationCurrentV1() { return readGpuOpticsObservationCurrentV1(); }
export function resetGpuOpticsUiObservationCurrentV1(): void { resetGpuOpticsObservationCurrentV1({ width: 32, height: 32 }); }
export function stopGpuOpticsUiObservationCurrentV1(): void { stopGpuOpticsObservationCurrentV1(); }
export function gpuOpticsAuthoredEffectsCurrentV1() {
	return [
		{ id: 'lens', type: 'lens-distortion-v1', enabled: true, params: { amount: -100 } },
		{ id: 'ca', type: 'chromatic-aberration-v1', enabled: true, params: { red: -100, blue: -100 } },
		{ id: 'fringe', type: 'defringe-v1', enabled: true, params: { purple: 75, green: 50, edgeThreshold: 0 } },
		{ id: 'optical', type: 'optical-vignette-v1', enabled: true, params: { amount: 50 } },
	];
}

/** This independent diagnostic input is the actual pinned Original words.
 * The application keeps its own Original reader and real renderer; none of
 * this oracle's planes or callbacks become application authority. */
export async function gpuOpticsWordsReferenceCurrentV1(words: readonly number[]) {
	const source = native(words);
	try {
		const expected = await referenceNativeGpuOpticsCurrentV1({ width: 32, height: 32, values: [...source], effects: gpuOpticsAuthoredEffectsCurrentV1() });
		return { ...expected, before: display([...source]), after: display(expected.values), sourceBits: [...new Uint32Array(source.buffer)] };
	} finally { source.fill(0); }
}
export async function qualifyGpuOpticsWordsCurrentV1(value: Readonly<{ words: readonly number[]; develop: unknown }>) {
	const pixels = native(value.words);
	try { return await qualifyNativeGpuOpticsCurrentV1({ width: 32, height: 32, values: [...pixels], develop: value.develop }); }
	finally { pixels.fill(0); }
}
function native(words: readonly number[]): Float32Array<ArrayBuffer> {
	if (words.length !== 4096 || words.some(n => !Number.isInteger(n) || n < 0 || n > 65535)) throw new RangeError('Optics UI requires actual32² native words.');
	return Float32Array.from(words, (n, at) => at % 4 === 3 ? 1 : n / 65535);
}
function display(values: readonly number[]): number[] {
	return values.map((n, at) => { if (at % 4 === 3) return Math.round(n * 255);
		const value = Math.max(0, Math.min(1, n)); return Math.round((value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055) * 255); });
}
