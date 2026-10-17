/* SPDX-License-Identifier: AGPL-3.0-only */
import { withImageDevelopGpuCurrentV1, type ImageDevelopGpuExecutionCurrentV1 } from '../../../src/common/editor/imaging/image-develop-gpu-current-v1.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 } from '../../../src/common/editor/photo-library-develop-linear-port-v1.ts';

/** Separate from the pure UI observer; called only while observation is stopped. */
export async function qualifyGpuMaskPreviewBrokerCurrentV1(value: Readonly<{ words: readonly number[]; develop: unknown }>) {
	if (value.words.length !== 4096 || !value.words.every(word => Number.isSafeInteger(word) && word >= 0 && word <= 65535)) throw new RangeError('The saved RAW witness requires32² native words.');
	const pixels = Uint16Array.from(value.words), source = pixels.buffer;
	const observed: { execution?: Readonly<ImageDevelopGpuExecutionCurrentV1>; bits: number[]; output?: ArrayBuffer; callbacks: number } = { bits: [], callbacks: 0 };
	let unchanged: boolean | undefined;
	try {
		await withImageDevelopGpuCurrentV1({ frame: { descriptor: { schemaVersion: 1, width: 32, height: 32,
			sampleFormat: 'unorm16', primaries: 'srgb', transfer: 'linear' }, pixels }, develop: value.develop }, (frame, execution) => {
			observed.callbacks++; observed.execution = Object.freeze({ ...execution }); observed.output = frame.pixels.buffer;
			observed.bits = [...new Uint32Array(frame.pixels.buffer, frame.pixels.byteOffset, frame.pixels.length)];
		}, PHOTO_DEVELOP_LINEAR_LIMITS_V1);
		unchanged = pixels.every((word, index) => word === value.words[index]);
	} finally { pixels.fill(0); }
	if (!observed.execution || !observed.output || unchanged === undefined) throw new TypeError('Saved RAW broker witness omitted joined delivery.');
	return { ...observed.execution, bits: observed.bits, callbacks: observed.callbacks, sourceUnchanged: unchanged,
		sourceRetired: new Uint8Array(source).every(byte => byte === 0), outputRetired: new Uint8Array(observed.output).every(byte => byte === 0) };
}
