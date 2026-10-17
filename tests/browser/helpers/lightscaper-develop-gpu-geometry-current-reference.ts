/* SPDX-License-Identifier: AGPL-3.0-only */

import { qualifyNativeGpuGeometryCurrentV1, startGpuGeometryObservationCurrentV1, readGpuGeometryObservationCurrentV1,
	resetGpuGeometryObservationCurrentV1, stopGpuGeometryObservationCurrentV1 } from './lightscaper-native-gpu-geometry-current-reference.ts';
export { readRawImportCustodyCurrentV1 as readGpuGeometryPhotoCustodyCurrentV1 } from './lightscaper-raw-import-current-reference.ts';

export function startGpuGeometryUiObservationCurrentV1(): void { startGpuGeometryObservationCurrentV1({ width: 32, height: 32 }); }
export function readGpuGeometryUiObservationCurrentV1() { return readGpuGeometryObservationCurrentV1(); }
export function resetGpuGeometryUiObservationCurrentV1(): void { resetGpuGeometryObservationCurrentV1({ width: 32, height: 32 }); }
export function stopGpuGeometryUiObservationCurrentV1(): void { stopGpuGeometryObservationCurrentV1(); }

/** Independent integer crop/permutation: source columns16..31, rows16..23;
 * clockwise90 then output-horizontal flip transposes that16×8 crop to8×16. */
export function gpuGeometryWordsReferenceCurrentV1(words: readonly number[]) {
	const source = native(words), selected = new Float32Array(8 * 16 * 4);
	try {
		for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) {
			const at = ((16 + x) * 32 + 16 + y) * 4; selected.set(source.subarray(at, at + 4), (y * 8 + x) * 4);
		}
		return { before: display(source), after: display(selected), bits: [...new Uint32Array(selected.buffer)], sourceBits: [...new Uint32Array(source.buffer)] };
	} finally { source.fill(0); selected.fill(0); }
}

/** Uses the exact saved native recipe from custody; none of this operation's
 * input/output pixels are supplied to the actual application renderer. */
export function qualifyGpuGeometryWordsCurrentV1(value: Readonly<{ words: readonly number[]; develop: unknown }>) {
	const pixels = native(value.words);
	try { return qualifyNativeGpuGeometryCurrentV1({ width: 32, height: 32, values: [...pixels], develop: value.develop }); }
	finally { pixels.fill(0); }
}
function native(words: readonly number[]): Float32Array<ArrayBuffer> {
	if (words.length !== 4096 || words.some(n => !Number.isInteger(n) || n < 0 || n > 65535)) throw new RangeError('Geometry UI requires actual32² native words.');
	return Float32Array.from(words, (n, at) => at % 4 === 3 ? 1 : n / 65535);
}
function display(values: Float32Array<ArrayBuffer>): number[] {
	return [...values].map((n, at) => { if (at % 4 === 3) return Math.round(n * 255);
		const value = Math.max(0, Math.min(1, n)); return Math.round((value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055) * 255); });
}
