/* SPDX-License-Identifier: AGPL-3.0-only */
import type {
	ProductVideoExportEncodedOutput,
	ProductVideoExportSinkOutput,
} from '../common/editor/controller/product-video-export-strategy.ts';
import type {
	VideoKeyframeVideoEncoderResult,
	VideoKeyframeVideoSinkEncoderResult,
} from '../common/editor/video-keyframe-video-encoder.ts';
import type { FramescaperVideoVisualPlanV27 } from './video-export-visual-plan-v27.ts';

export function framescaperPictureBrowserResultV27(
	encoded: VideoKeyframeVideoEncoderResult,
	plan: FramescaperVideoVisualPlanV27,
): ProductVideoExportEncodedOutput {
	assertResult(encoded, plan);
	if (!(encoded.bytes instanceof Uint8Array) || encoded.bytes.byteLength !== encoded.byteLength) {
		throw new Error('The V27 picture-only output byte length is inconsistent.');
	}
	return Object.freeze({
		bytes: encoded.bytes, byteLength: encoded.byteLength, videoEncoder: encoded.videoEncoder,
		...(encoded.codec === undefined ? {} : { codec: encoded.codec }),
		extension: encoded.extension, mimeType: encoded.mimeType,
	});
}

export function framescaperPictureSinkResultV27<Output>(
	encoded: VideoKeyframeVideoSinkEncoderResult<Output>,
	plan: FramescaperVideoVisualPlanV27,
): ProductVideoExportSinkOutput<Output> {
	assertResult(encoded, plan);
	if (!Number.isSafeInteger(encoded.outputChunkCount) || encoded.outputChunkCount < 0) {
		throw new RangeError('The V27 picture-only output chunk count is invalid.');
	}
	return Object.freeze({
		output: encoded.output, byteLength: encoded.byteLength,
		chunkCount: encoded.outputChunkCount, videoEncoder: encoded.videoEncoder,
		...(encoded.codec === undefined ? {} : { codec: encoded.codec }),
		extension: encoded.extension, mimeType: encoded.mimeType,
	});
}

function assertResult(
	encoded: Readonly<{ byteLength: number; format: string; extension: string; mimeType: string }>,
	plan: FramescaperVideoVisualPlanV27,
): void {
	if (!Number.isSafeInteger(encoded.byteLength) || encoded.byteLength < 0
		|| encoded.format !== plan.format || encoded.extension !== `.${plan.extension}`
		|| encoded.mimeType !== plan.mimeType) {
		throw new Error('The V27 picture encoder output does not match its exact plan.');
	}
}
