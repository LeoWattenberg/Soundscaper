/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../common/editor/closed-domain-value.ts';
import type { PhotoLibraryDevelopProxyViewV3 } from '../common/editor/photo-library-develop-proxy-port-v3.ts';
import type { PhotoLibraryDevelopGpuPreviewViewCurrentV1 } from '../common/editor/photo-library-develop-gpu-preview-port-current-v1.ts';
import { preparePhotoDevelopPreviewExecutionCurrentV1 } from '../common/editor/photo-library-develop-gpu-preview-port-current-v1.ts';
import { captureImageDevelopRawRequestCurrentV1 } from '../common/editor/imaging/image-develop-raw-request-current-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from '../common/editor/imaging/pixel-frame-repair-lifetime-v1.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 } from '../common/editor/photo-library-develop-linear-port-v1.ts';
import type { ImageDevelopFrameOptionsV3 } from '../common/editor/imaging/image-develop-frame-v3.ts';
import { withLinearPixelFrameDisplayV1 } from '../common/editor/imaging/pixel-frame-linear-display-v1.ts';
import { createPixelFrameHistogramV1 } from '../common/editor/imaging/pixel-frame-histogram-v1.ts';
import { withPhotoDevelopProxyCurrentV1, PHOTO_DEVELOP_PROXY_PROFILE_CURRENT_V1 } from './photo-develop-proxy-current-v1.ts';
import { withImageDevelopGpuCurrentV1 } from '../common/editor/imaging/image-develop-gpu-current-v1.ts';
import { preparePixelFrameWebGl2ColorsCurrentV1, PIXEL_FRAME_WEBGL2_COLOR_SCRATCH_BYTES_CURRENT_V1 } from '../common/editor/imaging/pixel-frame-webgl2-color-current-v1.ts';

type CpuRender = <Result>(resolution: 'proxy' | 'full', request: unknown,
	consume: (view: PhotoLibraryDevelopProxyViewV3) => Result | Promise<Result>) => Promise<Result>;

/** This adapter adds no source authority or pixel math. GPU jobs and complete
 * fallback stay inside the shared owner; display and histogram remain joined. */
export async function withPhotoDevelopGpuPreviewCurrentV1<Result>(resolution: 'proxy' | 'full', value: unknown,
	consume: (view: Readonly<PhotoLibraryDevelopGpuPreviewViewCurrentV1>) => Result | Promise<Result>,
	options: ImageDevelopFrameOptionsV3, cpu: CpuRender): Promise<Result> {
	const signalField = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'signal') : undefined;
	if (signalField && !Object.hasOwn(signalField, 'value')) throw new TypeError('GPU preview signal must be own data.');
	const signal = captureRepairSignalV1(signalField?.value), check = () => { checkRepairSignalV1(signal); }; check();
	if (resolution !== 'proxy' && resolution !== 'full') throw new RangeError('Unknown GPU preview resolution.');
	if (typeof consume !== 'function') throw new TypeError('GPU preview requires a scoped consumer.');
	const request = captureImageDevelopRawRequestCurrentV1(value);
	const accept = (view: PhotoLibraryDevelopProxyViewV3) => {
		const input = record(view, 'GPU preview result', ['frame', 'histogram', 'maskOverlay', 'execution'], ['frame', 'histogram', 'execution']);
		const execution = preparePhotoDevelopPreviewExecutionCurrentV1(field(input, 'execution', 'GPU preview result'));
		check(); return consume(Object.freeze({ ...view, execution }));
	};
	const evaluate = async <Value>(prepared: unknown, next: (view: PhotoLibraryDevelopProxyViewV3) => Value | Promise<Value>, preferred = true): Promise<Value> => {
		const captured = captureImageDevelopRawRequestCurrentV1(prepared), raw = captured.frame;
		if (!preferred) return cpu(resolution, captured, view => next(Object.freeze({ ...view, execution: Object.freeze({ backend: 'cpu' as const, reason: 'working-set' }) })));
		if (!raw || typeof raw !== 'object') throw new TypeError('GPU preview requires a frame.');
		const descriptor = record(field(raw as Readonly<Record<string, unknown>>, 'descriptor', 'GPU preview frame'), 'GPU preview descriptor',
			['schemaVersion', 'width', 'height', 'sampleFormat', 'primaries', 'transfer']);
		if (field(descriptor, 'sampleFormat', 'GPU preview descriptor') === 'unorm8') {
			return cpu(resolution, captured, view => next(Object.freeze({ ...view, execution: Object.freeze({ backend: 'cpu' as const, reason: 'encoded-byte-source' }) })));
		}
		check();
		const profile = resolution === 'full' ? PHOTO_DEVELOP_LINEAR_LIMITS_V1 : PHOTO_DEVELOP_PROXY_PROFILE_CURRENT_V1;
		return withImageDevelopGpuCurrentV1(captured, async (frame, execution, maskOverlay) => {
			const histogram = await withLinearPixelFrameDisplayV1({ frame, ...(signal ? { signal } : {}) },
				encoded => createPixelFrameHistogramV1(encoded, { ...(signal ? { signal } : {}) }), 'full');
			check(); const result = await next(Object.freeze({ frame, histogram, execution: preparePhotoDevelopPreviewExecutionCurrentV1(execution), ...(maskOverlay ? { maskOverlay } : {}) }));
			check(); return result;
		}, profile, options);
	};
	if (resolution === 'full') return evaluate(request, accept);
	return withPhotoDevelopProxyCurrentV1(request, accept, evaluate, options, metadata => {
		if (metadata.sourcePlan.descriptor.sampleFormat === 'unorm8') return metadata.peakWorkingBytes;
		const floatBytes = metadata.descriptor.width * metadata.descriptor.height * 16;
		const outputPixels = metadata.finalDescriptor.width * metadata.finalDescriptor.height;
		const presentationBytes = outputPixels * 4 + Math.min(outputPixels, 4_194_304) * 4;
		const passes = preparePixelFrameWebGl2ColorsCurrentV1(metadata.stages.flatMap(stage => stage.kind === 'color' ? [stage.effect] : []));
		const uniformBytes = passes.some(pass => pass.kind > 2) ? PIXEL_FRAME_WEBGL2_COLOR_SCRATCH_BYTES_CURRENT_V1 : 0;
		return Math.max(metadata.sourcePlan.byteLength + 4 * floatBytes + presentationBytes + uniformBytes, metadata.peakWorkingBytes + floatBytes,
			metadata.sourcePlan.byteLength + floatBytes + 1024);
	});
}
