/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	ProductVideoExportEncodedOutput,
	ProductVideoExportSinkOutput,
	ProductVideoExportStrategyEncodeRequest,
} from './controller/export/product-video-export-strategy.ts';
import type { VideoKeyframeExportPlanV7 } from './video-keyframe-export-plan-v7.ts';
import type {
	VideoKeyframeVideoEncoderResult,
	VideoKeyframeVideoEditorFfmpeg,
	VideoKeyframeVideoSinkEncoderResult,
} from './video-keyframe-video-encoder.ts';

type EncodeBackend = Readonly<{
	webCodecs?: NonNullable<ProductVideoExportStrategyEncodeRequest['webCodecs']>;
	editorFfmpeg?: VideoKeyframeVideoEditorFfmpeg;
}>;

export interface VideoExportResultErrorText {
	readonly identity: string;
	readonly bytes: string;
	readonly chunks: string;
}

export interface VideoExportEncodeErrorText extends VideoExportResultErrorText {
	readonly sourceSet: string;
	readonly sourceMissing: (sourceId: string) => string;
	readonly audioMix: string;
}

type ResultPlanIdentity = Readonly<{
	format: string;
	extension: string;
	mimeType: string;
}>;

/** Bind only the plan's active video source IDs to authenticated Blobs. */
function exactSources(
	plan: VideoKeyframeExportPlanV7,
	videoBlobs: ReadonlyMap<string, Blob>,
	errors: VideoExportEncodeErrorText,
): readonly Readonly<{ sourceId: string; blob: Blob }>[] {
	if (!(videoBlobs instanceof Map) || videoBlobs.size !== plan.activeSourceIds.length) {
		throw new TypeError(errors.sourceSet);
	}
	return Object.freeze(plan.activeSourceIds.map((sourceId) => {
		const blob = videoBlobs.get(sourceId);
		if (!(blob instanceof Blob)) throw new TypeError(errors.sourceMissing(sourceId));
		return Object.freeze({ sourceId, blob });
	}));
}

/** Construct the common offline request without choosing a product's encoder adapter. */
export function createVideoExportOfflineRequest(
	request: ProductVideoExportStrategyEncodeRequest,
	plan: VideoKeyframeExportPlanV7,
	backend: EncodeBackend,
	errors: VideoExportEncodeErrorText,
) {
	const sources = exactSources(plan, request.videoBlobs, errors);
	const includesAudio = plan.inputs.some((input) => input.kind === 'staged-audio-mix');
	if (includesAudio !== (request.audioMix instanceof Blob)) {
		throw new TypeError(errors.audioMix);
	}
	return Object.freeze({
		project: request.exportProject,
		timingBySourceId: request.timingBySourceId,
		sources,
		canvas: Object.freeze({
			width: plan.canvas.width, height: plan.canvas.height,
			frameRate: plan.canvas.frameRate, fit: plan.canvas.fit,
			backgroundColor: plan.canvas.backgroundColor,
		}),
		startFrame: plan.range.startFrame,
		endFrame: plan.range.endFrame,
		format: plan.format,
		quality: plan.quality,
		...(Object.hasOwn(backend, 'webCodecs') ? { webCodecs: backend.webCodecs } : {}),
		...(Object.hasOwn(backend, 'editorFfmpeg') ? { editorFfmpeg: backend.editorFfmpeg } : {}),
		...(request.audioMix instanceof Blob ? { audioMix: request.audioMix } : {}),
		...(request.maximumOutputBytes === undefined ? {} : {
			maximumOutputBytes: request.maximumOutputBytes as number,
		}),
		...(request.rgbaPostprocessor === undefined ? {} : { rgbaPostprocessor: request.rgbaPostprocessor }),
		...(request.rgbaCompositor === undefined ? {} : { rgbaCompositor: request.rgbaCompositor }),
		signal: request.signal,
		assertCurrent: request.assertCurrent,
	});
}

function assertResultIdentity(
	encoded: Readonly<{
		byteLength: number; format: string; extension: string; mimeType: string;
	}>,
	plan: ResultPlanIdentity,
	errors: VideoExportResultErrorText,
): void {
	if (!Number.isSafeInteger(encoded.byteLength) || encoded.byteLength < 0
		|| encoded.format !== plan.format || encoded.extension !== `.${plan.extension}`
		|| encoded.mimeType !== plan.mimeType) {
		throw new Error(errors.identity);
	}
}

/** Project only bytes whose encoder identity and length agree with the detached plan. */
export function projectVideoExportBrowserResult(
	encoded: VideoKeyframeVideoEncoderResult,
	plan: ResultPlanIdentity,
	errors: VideoExportResultErrorText,
): ProductVideoExportEncodedOutput {
	assertResultIdentity(encoded, plan, errors);
	if (!(encoded.bytes instanceof Uint8Array) || encoded.bytes.byteLength !== encoded.byteLength) {
		throw new Error(errors.bytes);
	}
	return Object.freeze({
		bytes: encoded.bytes, byteLength: encoded.byteLength, videoEncoder: encoded.videoEncoder,
		...(encoded.codec === undefined ? {} : { codec: encoded.codec }),
		extension: encoded.extension, mimeType: encoded.mimeType,
	});
}

/** Project only a sink result with an exact encoder identity and finite chunk count. */
export function projectVideoExportSinkResult<Output>(
	encoded: VideoKeyframeVideoSinkEncoderResult<Output>,
	plan: ResultPlanIdentity,
	errors: VideoExportResultErrorText,
): ProductVideoExportSinkOutput<Output> {
	assertResultIdentity(encoded, plan, errors);
	if (!Number.isSafeInteger(encoded.outputChunkCount) || encoded.outputChunkCount < 0) {
		throw new RangeError(errors.chunks);
	}
	return Object.freeze({
		output: encoded.output, byteLength: encoded.byteLength, chunkCount: encoded.outputChunkCount,
		videoEncoder: encoded.videoEncoder,
		...(encoded.codec === undefined ? {} : { codec: encoded.codec }),
		extension: encoded.extension, mimeType: encoded.mimeType,
	});
}
