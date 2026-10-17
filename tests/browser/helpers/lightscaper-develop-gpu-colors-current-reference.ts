/* SPDX-License-Identifier: AGPL-3.0-only */

import { prepareLinearColorEffectsV1, writeLinearColorChannelsV1 } from '../../../src/common/editor/imaging/pixel-frame-linear-color-v1.ts';
import { withImageDevelopGpuCurrentV1 } from '../../../src/common/editor/imaging/image-develop-gpu-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../../../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../../../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 } from '../../../src/common/editor/photo-library-develop-linear-port-v1.ts';

// These hooks only observe real native GL calls/results and actual saved Photo
// custody. They supply neither a renderer nor a capability or source substitute.
export { startGpuPreviewObservationCurrentV1, readGpuPreviewObservationCurrentV1,
	resetGpuPreviewObservationCurrentV1, stopGpuPreviewObservationCurrentV1,
	readGpuPreviewPhotoCustodyCurrentV1 } from './lightscaper-develop-gpu-preview-current-reference.ts';

/** The permanent native CPU color family is the normative comparison, with one
 * Float32 store per stage. Tests also carry independently calculated literals. */
export function nativeColorReferenceCurrentV1(values: readonly number[], effects: readonly unknown[]): number[] {
	if (values.length > 32 * 32 * 4 || values.length % 4 !== 0) throw new RangeError('Color reference is bounded to32² RGBA.');
	const output = Float32Array.from(values), target = { red: 0, green: 0, blue: 0 };
	try {
		for (const effect of prepareLinearColorEffectsV1(effects)) for (let at = 0; at < output.length; at += 4) {
			writeLinearColorChannelsV1(effect, output[at]!, output[at + 1]!, output[at + 2]!, target);
			output[at] = target.red; output[at + 1] = target.green; output[at + 2] = target.blue;
		}
		return [...output];
	} finally { output.fill(0); }
}

export function nativeColorWordsReferenceCurrentV1(value: Readonly<{ words: readonly number[]; effects: readonly unknown[] }>) {
	if (value.words.length !== 4096 || value.words.some(n => !Number.isInteger(n) || n < 0 || n > 65535)) throw new RangeError('A real32² native-word frame is required.');
	const values = nativeColorReferenceCurrentV1(value.words.map((n, at) => at % 4 === 3 ? 1 : Math.fround(n / 65535)), value.effects);
	return { values, bits: [...new Uint32Array(Float32Array.from(values).buffer)], display: colorDisplayReferenceCurrentV1(values) };
}

/** Qualify this exact independently observed RAW corpus through the real broker.
 * This separate scoped operation runs before the UI observer starts. It does
 * not replace an application renderer, context, source or presentation result. */
export async function qualifyGpuColorWordsCurrentV1(value: Readonly<{ words: readonly number[]; effects: readonly unknown[] }>) {
	if (value.words.length !== 4096 || value.words.some(n => !Number.isInteger(n) || n < 0 || n > 65535)) throw new RangeError('A real32² native-word frame is required.');
	const pixels = Float32Array.from(value.words, (n, at) => at % 4 === 3 ? 1 : n / 65535);
	const before = new Uint32Array(pixels.buffer).slice(), frame = Object.freeze({ descriptor: Object.freeze({ schemaVersion: 1 as const,
		width: 32, height: 32, sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const }), pixels });
	let callbacks = 0, backing: ArrayBuffer | undefined;
	try {
		const result = await withImageDevelopGpuCurrentV1({ frame, develop: normalizeImageDevelopStateCurrentV1({ ...defaultImageDevelopStateV2(), effects: value.effects }) },
			(output, execution) => {
				callbacks++; backing = output.pixels.buffer;
				return { ...execution, bits: [...new Uint32Array(backing, output.pixels.byteOffset, output.pixels.length)],
					display: colorDisplayReferenceCurrentV1([...output.pixels]) };
			}, PHOTO_DEVELOP_LINEAR_LIMITS_V1);
		return { ...result, callbacks, sourceUnchanged: new Uint32Array(pixels.buffer).every((n, at) => n === before[at]),
			outputRetired: backing !== undefined && new Uint8Array(backing).every(n => n === 0) };
	} finally { pixels.fill(0); before.fill(0); }
}

export function colorDisplayReferenceCurrentV1(values: readonly number[]): number[] {
	return values.map((sample, at) => {
		if (at % 4 === 3) return Math.round(Math.max(0, Math.min(1, sample)) * 255);
		const value = Math.max(0, Math.min(1, sample));
		return Math.round((value <= .0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - .055) * 255);
	});
}
