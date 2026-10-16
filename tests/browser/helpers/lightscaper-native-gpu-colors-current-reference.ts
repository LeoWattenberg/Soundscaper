/* SPDX-License-Identifier: AGPL-3.0-only */

import { withPixelFrameWebGl2CurrentV1 } from '../../../src/common/editor/imaging/pixel-frame-webgl2-current-v1.ts';
import { preparePixelFrameWebGl2ColorsCurrentV1 } from '../../../src/common/editor/imaging/pixel-frame-webgl2-color-current-v1.ts';
import { withImageDevelopGpuCurrentV1 } from '../../../src/common/editor/imaging/image-develop-gpu-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../../../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../../../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 } from '../../../src/common/editor/photo-library-develop-linear-port-v1.ts';
import type { LinearWorkingPixelFrameV1 } from '../../../src/common/editor/imaging/image-develop-linear-frame-v1.ts';
import { nativeColorReferenceCurrentV1, startGpuPreviewObservationCurrentV1, readGpuPreviewObservationCurrentV1,
	stopGpuPreviewObservationCurrentV1 } from './lightscaper-develop-gpu-colors-current-reference.ts';

interface Request { readonly values: readonly number[]; readonly effects: readonly unknown[]; readonly broker?: boolean }
const bits = (values: Float32Array<ArrayBuffer>) => [...new Uint32Array(values.buffer, values.byteOffset, values.length)];

/** Repetition fills a real32² native input, so the transparent UI observer can
 * record the complete float delivery without enlarging its fixed capture cap. */
export async function qualifyNativeGpuColorsCurrentV1(value: Request) {
	if (!value.values.length || value.values.length % 4 !== 0 || value.values.length > 4096 || value.values.some(n => !Number.isFinite(n))) {
		throw new RangeError('The color corpus requires1..1024 finite RGBA pixels.');
	}
	const pixels = Float32Array.from({ length: 4096 }, (_, at) => value.values[at % value.values.length]!);
	const frame = Object.freeze({ descriptor: Object.freeze({ schemaVersion: 1 as const, width: 32, height: 32,
		sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const }), pixels });
	const before = bits(pixels), expected = nativeColorReferenceCurrentV1([...pixels], value.effects);
	let callbacks = 0, backing: ArrayBuffer | undefined;
	startGpuPreviewObservationCurrentV1();
	try {
		const capture = (output: Readonly<LinearWorkingPixelFrameV1>, backend: 'webgl2' | 'cpu', reason: string | null) => {
			callbacks++; backing = output.pixels.buffer;
			return { backend, reason, descriptor: output.descriptor, values: [...output.pixels], bits: bits(output.pixels), dedicated: backing !== pixels.buffer };
		};
		const result = value.broker
			? await withImageDevelopGpuCurrentV1({ frame, develop: normalizeImageDevelopStateCurrentV1({ ...defaultImageDevelopStateV2(), effects: value.effects }) },
				(output, execution) => capture(output, execution.backend, execution.reason ?? null), PHOTO_DEVELOP_LINEAR_LIMITS_V1)
			: await withPixelFrameWebGl2CurrentV1({ frame, passes: preparePixelFrameWebGl2ColorsCurrentV1(value.effects) },
				view => capture(view.backend === 'webgl2' ? view.frame : view.source, view.backend, view.backend === 'cpu' ? view.reason : null));
		return { ...result, callbacks, before, sourceBits: bits(pixels), expected,
			expectedBits: [...new Uint32Array(Float32Array.from(expected).buffer)],
			outputRetired: backing !== undefined && new Uint8Array(backing).every(n => n === 0), observation: readGpuPreviewObservationCurrentV1() };
	} finally { stopGpuPreviewObservationCurrentV1(); pixels.fill(0); }
}
